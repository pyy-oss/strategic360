"use strict";

/**
 * Cloud Functions (Node 20) — "Sentinel" (veille stratégique & copilote, Neurones Technologies CI).
 *
 * V0 (Socle & design): structure only — correct Cloud Functions v2 trigger signatures per
 * BUILD_KIT.md §10, bodies throw "not implemented" pending their roadmap phase. No Vertex AI
 * calls yet (that's V7). No real Firestore/Storage wiring yet (V2-V6).
 */

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { computePriorityScore } = require("./domain/scoring");
const { parsePnl } = require("./parsers/pnl");
const { parseLive } = require("./parsers/live");
const { parseFacturationDf } = require("./parsers/facturationDf");
const { parseFiche } = require("./parsers/fiche");
const { computePorterForces, computeBcg, computeCasSummary, computePipeline, computeKris, computeValueAtStake, computePipelineInfluenced, computeGranularite } = require("./domain/quanti");
const dns = require("node:dns/promises");
const { intelItemId } = require("./domain/ids");
const { isForbiddenIp, checkPublicHttpUrl } = require("./domain/netguard");
const { buildClassificationPrompt, parseClassificationResponse, deriveSourceRatingFromUrl, isHighAuthorityRating } = require("./domain/classify");
const { dedupeByTitle, isNearDuplicate, isStrongDuplicate, blocksMerge, clusterNearDuplicates } = require("./domain/dedupe");
const {
  pickOnboardingLinks,
  buildOnboardingProfilePrompt,
  parseOnboardingProfileResponse,
  buildEcosystemMapPrompt,
  parseEcosystemMapResponse,
  buildVeillePlanPrompt,
  parseVeillePlanResponse,
  buildConfigDocsFromDraft,
} = require("./domain/onboarding");
const { buildEvaluatePrompt, parseEvaluateResponse } = require("./domain/evaluate");
const { planWatchlistMonitors, MONITOR_SOURCE_TAG } = require("./domain/watchlistMonitor");
const { pickRelevant } = require("./domain/retrieve");
const { selectDigestSignals, buildDigestPayload, hasDigestContent, DEFAULT_MIN_SCORE } = require("./domain/digest");
const { buildBriefingPrompt, buildBriefingCritiquePrompt, parseBriefingResponse } = require("./domain/briefing");
const { buildBriefingPdf } = require("./domain/pdf");
const { generateJson, DEFAULT_MODEL } = require("./domain/vertex");
const { TENDER_ENRICH_SUBTYPES, buildTenderEnrichPrompt, parseTenderEnrichResponse, mergeBusinessAngle, isoDeadline } = require("./domain/tenderEnrich");
const { AGENTS: COPILOTE_AGENTS, buildChatPrompt, parseChatResponse } = require("./domain/copilote");
const { DEFAULT_BACKFILL_DAYS, dayRangeUTC, computeKpiBackfillPoints, mergeHistoryPoints } = require("./domain/kpiBackfill");
const PDFDocument = require("pdfkit");
const { v1: firestoreAdminV1, Firestore } = require("@google-cloud/firestore");

initializeApp();

/**
 * Subtype label used by the sample "Fil de veille" data (web/src/modules/veille/data.ts) for
 * tenders/AO items. NOTE: as of V2, the "Nouvelle fiche de veille" contribution form
 * (web/src/modules/veille/views/Fil.tsx) does not yet collect a `subtype` field at all, so
 * `tendersOpen` counts open tenders. The classifier canonicalises every AO subtype to `"tender"`
 * (classify.js#normalizeSubtype / VALID_SUBTYPES), so the constant MUST be the canonical token —
 * the old maquette label "Appel d'offres" never matched a classified item and `tendersOpen` read 0
 * forever (audit 2026-07).
 */
const TENDER_SUBTYPE = "tender";

/**
 * Some intelSources (SIGMAP/DGMP, ARMP, etc.) return 403 to Node's default fetch — most likely
 * bot-detection rejecting the absent/generic default User-Agent, per a real syncSources run
 * against propulse-business-87f7a (2026-07-02). A realistic browser-ish User-Agent is a low-risk
 * mitigation for that class of failure; sites with stricter anti-bot measures (Cloudflare
 * challenges, JS-rendered content) will still fail and need a different ingestion approach later.
 */
// Fiabilisation des sources (2026-07) : beaucoup de sites (portails gouv., presse) rejettent un
// User-Agent identifié « bot ». On présente un UA de navigateur réaliste + en-têtes usuels — c'est
// la parade la plus efficace au 403 anti-bot. Les sites à défi JS (Cloudflare, SPA) resteront
// hors d'atteinte d'un simple fetch et s'auto-élaguent (santé des sources).
const SOURCE_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};

/* ------------------------------------------------------------------------------------------- *
 * Rendu HEADLESS (kind "web-js") — pour les portails à défi anti-bot / rendus JavaScript
 * (SIGOMAP, ARCOP, douanes, GUCE…) qu'un simple fetch ne peut pas lire (403 / coquille SPA).
 * Chromium (@sparticuz/chromium) + puppeteer-core, chargés PARESSEUSEMENT : si le binaire n'est
 * pas disponible, la source échoue proprement (auto-curation) sans casser le reste du pipeline.
 * Un SEUL navigateur est lancé par run et réutilisé pour toutes les sources web-js, puis fermé.
 * ------------------------------------------------------------------------------------------- */
let _browserPromise = null;
let _browserLaunchFailed = false;
async function getRenderBrowser() {
  if (_browserLaunchFailed) throw new Error("headless chromium indisponible (échec de lancement précédent)");
  // Mémoïse la PROMESSE de lancement pour dédupliquer les appels concurrents (lots parallèles).
  if (!_browserPromise) {
    _browserPromise = (async () => {
      const chromium = require("@sparticuz/chromium");
      const puppeteer = require("puppeteer-core");
      return puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1280, height: 900 },
        executablePath: await chromium.executablePath(),
        headless: true,
        // Beaucoup de sites .gouv.ci ont un certificat mal configuré (ERR_CERT_COMMON_NAME_INVALID) :
        // on ignore les erreurs TLS pour pouvoir quand même lire la page (on ne fait que lire du contenu public).
        acceptInsecureCerts: true,
      });
    })().catch((err) => {
      _browserLaunchFailed = true;
      _browserPromise = null;
      throw new Error(`headless chromium launch failed: ${err.message}`);
    });
  }
  return _browserPromise;
}
async function closeRenderBrowser() {
  if (_browserPromise) {
    const p = _browserPromise;
    _browserPromise = null;
    try { const b = await p; await b.close(); } catch { /* ignore */ }
  }
}
/** Rend une page JS et renvoie son HTML final (après exécution du script). Timeout dur 30 s.
 * `domcontentloaded` (et non `networkidle2`) : les SPA gardent des connexions ouvertes en
 * permanence et n'atteignent jamais l'inactivité réseau → on attend le DOM puis un court délai
 * pour laisser le JS peupler la page.
 * `opts.raw` (audit sources 2026-07) : renvoie le CORPS BRUT de la réponse principale au lieu du DOM
 * rendu — utilisé comme repli pour les FLUX RSS/XML bloqués en 403 anti-bot (le navigateur, avec un
 * vrai UA, franchit les 403 simples que le fetch HTTP prend ; on récupère le XML brut, sans le
 * wrapper « XML viewer » que Chromium ajoute autour d'un flux). */
async function fetchRendered(url, opts = {}) {
  await assertSafePublicUrl(url);
  const browser = await getRenderBrowser();
  const page = await browser.newPage();
  // Garde anti-SSRF COMPLÈTE (audit 2026-07, M1) : sans interception, le navigateur suivait
  // lui-même les redirections 3xx du frame principal et chargeait les sous-ressources sans
  // repasser par assertSafePublicUrl → une page publique redirigeant vers une IP interne
  // exfiltrait son contenu. On intercepte CHAQUE requête réseau et on refuse tout hôte qui
  // résout vers une adresse interne (redirections + sous-requêtes comprises). Cache DNS par page
  // pour ne pas multiplier les lookups.
  const dnsCache = new Map();
  try {
    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      try {
        let u;
        try { u = new URL(req.url()); } catch { await req.abort(); return; }
        // Schémas locaux (data:/blob:/about:) : pas de réseau, on laisse passer.
        if (u.protocol !== "http:" && u.protocol !== "https:") { await req.continue(); return; }
        const checked = checkPublicHttpUrl(req.url());
        if (!checked.ok) { await req.abort(); return; }
        const host = checked.url.hostname.replace(/^\[|\]$/g, "");
        if (/^[\d.]+$/.test(host) || host.includes(":")) { await req.continue(); return; } // IP littérale déjà validée
        let internal = dnsCache.get(host);
        if (internal === undefined) {
          try {
            const addrs = await dns.lookup(host, { all: true, verbatim: true });
            internal = addrs.some((a) => isForbiddenIp(a.address));
          } catch { internal = true; } // DNS en échec → on refuse par défaut
          dnsCache.set(host, internal);
        }
        if (internal) await req.abort(); else await req.continue();
      } catch { try { await req.abort(); } catch { /* déjà géré */ } }
    });
    await page.setUserAgent(SOURCE_FETCH_HEADERS["User-Agent"]);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Re-validation de l'URL FINALE après la chaîne de redirections du frame principal.
    await assertSafePublicUrl(page.url());
    if (opts.raw) {
      // Corps brut de la réponse principale (flux RSS/XML) — pas d'attente de rendu JS.
      return response ? await response.text() : "";
    }
    // Laisse le JS rendre le contenu (listes d'AO, actualités) après le DOMContentLoaded.
    await new Promise((r) => setTimeout(r, 3500));
    return await page.content();
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

/**
 * Garde anti-SSRF (audit pré-lancement 2026-07, B1) : toute URL fetchée par l'app (source
 * configurée, URL d'onboarding, source candidate proposée par l'IA, redirection d'un site tiers)
 * doit viser un hôte PUBLIC. Validation de forme (domain/netguard, pur) + résolution DNS ici :
 * chaque adresse résolue est refusée si privée/link-local/loopback/metadata. Limite connue
 * (documentée) : la résolution de contrôle et celle du fetch sont deux lookups distincts (fenêtre
 * de DNS-rebinding théorique) — acceptable pour de la lecture de contenu public, ce garde bloque
 * les canaux réalistes (URL directe, redirection, URL issue de l'IA).
 */
async function assertSafePublicUrl(urlString) {
  const checked = checkPublicHttpUrl(urlString);
  if (!checked.ok) throw new Error(`URL refusée (SSRF) : ${checked.reason}`);
  const host = checked.url.hostname.replace(/^\[|\]$/g, "");
  // IP littérale : déjà validée par checkPublicHttpUrl, pas de DNS à faire.
  if (/^[\d.]+$/.test(host) || host.includes(":")) return checked.url;
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`fetch failed: DNS introuvable (${host})`);
  }
  for (const { address } of addrs) {
    if (isForbiddenIp(address)) throw new Error(`URL refusée (SSRF) : ${host} résout vers une adresse interne`);
  }
  return checked.url;
}

/**
 * fetchSource(url) — récupère une source avec robustesse : UA navigateur, timeout dur (20 s) pour
 * ne pas bloquer un lot tout en laissant répondre les sites lents (gov/AO régionaux), et 1 nouvelle
 * tentative sur erreur réseau transitoire. Lève une erreur
 * explicite sur statut HTTP non-2xx (comptée comme échec de santé). Les redirections sont suivies
 * MANUELLEMENT (max 5) pour re-passer chaque saut par la garde anti-SSRF — un site public qui
 * répond 302 vers une adresse interne est refusé.
 */
async function fetchSource(url) {
  const attempt = async () => {
    let current = String(url);
    for (let hop = 0; hop < 5; hop++) {
      await assertSafePublicUrl(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(current, { headers: SOURCE_FETCH_HEADERS, redirect: "manual", signal: controller.signal });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) throw new Error(`fetch failed: HTTP ${res.status} sans Location`);
          current = new URL(loc, current).toString();
          continue;
        }
        if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("fetch failed: trop de redirections");
  };
  try {
    return await attempt();
  } catch (err) {
    // Jamais de retry sur un refus SSRF (déterministe) ; retente une fois uniquement sur erreur
    // réseau/timeout (pas sur un 4xx déterministe).
    if (/URL refusée/.test(String(err.message))) throw err;
    if (/HTTP [45]\d\d/.test(String(err.message)) && !/HTTP 429|HTTP 5\d\d/.test(String(err.message))) throw err;
    return await attempt();
  }
}

/** Source health: auto-deactivate a source after this many consecutive fetch failures. */
const MAX_CONSECUTIVE_FAILURES = 5;

// Hôtes d'agrégateurs RSS fiables où un 403/429 est un rate-limit (pas un défi anti-bot JS) : inutile
// (et coûteux) d'y retenter en rendu headless — le navigateur reçoit la même réponse (audit final
// pré-prod 2026-07). Concerne surtout news.google.com (jusqu'à MAX_MONITORS sources de surveillance).
const AGGREGATOR_RSS_HOSTS = ["news.google.com"];
function isAggregatorRssHost(url) {
  try {
    const h = new URL(String(url)).hostname.replace(/^www\./, "").toLowerCase();
    return AGGREGATOR_RSS_HOSTS.some((a) => h === a || h.endsWith("." + a));
  } catch { return false; }
}

// Modèle RBAC (13 profils ESN × 7 modules) — SOURCE UNIQUE dans domain/rbac.js, partagée avec
// seed.js et le front (web/src/lib/rbac.ts, tenu en miroir). Voir ce fichier pour la matrice.
const {
  ROLES: VALID_ROLES,
  EXEC_ROLES,
  COMMERCIAL_ROLES,
  COPILOTE_UNSCOPED_ROLES,
  sanitizePermissionsMatrix,
} = require("./domain/rbac");

/** Mirrors `exec()` in firestore.rules: direction/strategie/innovation. */
function isExecCaller(request) {
  const role = request.auth?.token?.role;
  return request.auth != null && EXEC_ROLES.includes(role);
}
function requireExecCaller(request, action) {
  if (!isExecCaller(request)) {
    throw new HttpsError("permission-denied", `Seuls les profils exécutifs (direction/strategie/innovation) peuvent ${action}.`);
  }
}

/** Copilote Commercial : rôles commerciaux + exécutifs (le copilote est un outil de vente). */
function requireCommercialCaller(request, action) {
  const role = request.auth?.token?.role;
  if (!request.auth || !COMMERCIAL_ROLES.includes(role)) {
    throw new HttpsError("permission-denied", `Seuls les profils commerciaux/exécutifs peuvent ${action}.`);
  }
}

/**
 * App Check enforcement (V8 Durcissement, BUILD_KIT.md §3 "App Check" / §13). App Check itself
 * must be configured in the Firebase Console (register the web app, enable a reCAPTCHA v3
 * provider, and — for a smooth rollout — set enforcement to "monitor" before "enforce") AND the
 * client must be initializing it (see web/src/lib/firebase.ts, VITE_FIREBASE_APPCHECK_SITE_KEY)
 * BEFORE these callables reject unattested requests. Turning `enforceAppCheck: true` on for a
 * callable that real clients aren't sending App Check tokens to yet is a well-known App Check
 * footgun — every call from that client instantly starts failing with 401 UNAUTHENTICATED.
 *
 * Kept OPT-IN via an env/Functions-config flag rather than hardcoded `true`, so the safe rollout
 * order is: 1) deploy with App Check console-side "monitoring" + client-side initializeAppCheck
 * live for a while, 2) confirm real traffic is carrying valid App Check tokens (Console >
 * App Check > Requests metrics), 3) THEN set `APPCHECK_ENFORCE=true` (Functions config/env var,
 * e.g. `firebase functions:config:set appcheck.enforce=true` or a `.env` for gen2) and redeploy.
 * Defaults to `false` (not enforced) so this ships without accidentally locking anyone out.
 */
const ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === "true";
/** Shared `onCall` options for the exec-gated callables (setUserRole, classifyAI,
 * generateBriefing, exportPdf) — region + conditional App Check enforcement, applied
 * consistently across all four so none of them is accidentally left unprotected once enforcement
 * is switched on project-wide. */
const CALLABLE_OPTS = { region: "europe-west1", enforceAppCheck: ENFORCE_APP_CHECK };

/** Options « lourdes » pour les traitements qui enchaînent de nombreux appels IA (Vertex) ou lisent
 * de gros lots Firestore (sync sources, enrichissement, briefing, sync interne). Le timeout v2 par
 * défaut (60 s) était largement dépassé → les dernières sources n'étaient jamais synchronisées
 * (audit 2026-07, C4). 540 s = plafond des fonctions event/scheduled ; 512 MiB pour tenir les lots. */
const HEAVY_OPTS = { region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" };
const HEAVY_CALLABLE_OPTS = { ...CALLABLE_OPTS, timeoutSeconds: 540, memory: "512MiB" };
/** Concurrence max des appels IA en parallèle (lots) — borne la charge Vertex tout en évitant la
 * boucle strictement séquentielle qui faisait exploser la durée. */
const AI_CONCURRENCY = 5;

/**
 * Limiteur GLOBAL de concurrence (audit pré-lancement 2026-07, M6). runInBatches borne le nombre
 * de SOURCES traitées en parallèle, mais chaque source classifiait ses items via un
 * Promise.allSettled non borné → concurrence Vertex réelle ≈ 5 sources × 8 items = 40 appels
 * simultanés (pics 429). Ce sémaphore borne les appels de CLASSIFICATION eux-mêmes, quelle que
 * soit la structure des lots au-dessus.
 */
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  return async (task) => {
    if (active >= max) await new Promise((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const wake = queue.shift();
      if (wake) wake();
    }
  };
}
const vertexLimit = makeLimiter(AI_CONCURRENCY);

/** Plafond de sources par run de sync (audit M7) : borne le coût IA d'un run quel que soit le
 * nombre de sources actives configurées. Au-delà, rotation quotidienne pour ne pas affamer la
 * queue de liste (les sources excédentaires passent aux runs suivants). */
const MAX_SOURCES_PER_RUN = 80;
/** Verrou de run (audit M9/M2) : un run est considéré mort (verrou périmé) au-delà de ce délai —
 * légèrement supérieur au timeout dur des fonctions (540 s). */
const SYNC_LOCK_TTL_MS = 12 * 60 * 1000;

/**
 * acquireRunLock(db, path, ttlMs) -> bool — verrou transactionnel générique (audit intégral 2026-07,
 * M2/m6) pour empêcher deux runs coûteux (enrichissement, évaluation) de tourner en parallèle
 * (manuel + planifié) : double facturation Vertex sur un projet PARTAGÉ et écritures concurrentes
 * last-writer-wins. Écrit `{ running:true, startedAt }` si aucun run vivant. Un verrou plus vieux
 * que ttlMs est réputé périmé (run tué au timeout) et repris. Best-effort : si la transaction
 * échoue (émulateur, indisponibilité), on autorise le run (mieux vaut un run que pas de run).
 */
async function acquireRunLock(db, path, ttlMs = SYNC_LOCK_TTL_MS) {
  const ref = db.doc(path);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? snap.data() : {};
      const startedMs = cur.startedAt && typeof cur.startedAt.toMillis === "function" ? cur.startedAt.toMillis() : 0;
      if (cur.running === true && startedMs && Date.now() - startedMs < ttlMs) return false;
      tx.set(ref, { running: true, startedAt: FieldValue.serverTimestamp(), finishedAt: null }, { merge: true });
      return true;
    });
  } catch (e) {
    logger.warn(`acquireRunLock(${path}): transaction indisponible (${e.message}) — run sans verrou`);
    return true;
  }
}
/** Libère un verrou de run (best-effort). */
async function releaseRunLock(db, path, patch = {}) {
  try {
    await db.doc(path).set({ running: false, finishedAt: FieldValue.serverTimestamp(), ...patch }, { merge: true });
  } catch { /* best-effort */ }
}

/** Statuts « PUBLIÉS » (visibles du fil/radar et comptés dans les agrégats). `pending` (en attente
 * d'évaluation) et `rejected` (écarté par l'évaluateur) et `archived` (doublon/clos) en sont exclus. */
const PUBLISHED_STATUSES = new Set(["new", "reviewed", "actioned"]);

/** Exécute `worker` sur chaque élément de `items` par lots de `size`, en tolérant les échecs
 * (allSettled). Remplace les boucles `for … await` séquentielles sur les sources/artefacts. */
async function runInBatches(items, size, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const settled = await Promise.allSettled(batch.map((it, j) => worker(it, i + j)));
    results.push(...settled);
  }
  return results;
}

/**
 * Shared-project isolation (this Firebase project — e.g. "propulse-business-87f7a" — hosts
 * OTHER apps too). To never read/write/overwrite their data:
 *  - FIRESTORE_DATABASE_ID: a dedicated NAMED Firestore database (e.g. "strategic360"), entirely
 *    separate from "(default)" (and from any other named database other apps use). Set via the
 *    functions/.env(.<project-id>) file — see functions/.env.example.
 *  - STORAGE_BUCKET_NAME: a dedicated Cloud Storage bucket (e.g. "strategic360"), separate from
 *    the project's default bucket other apps may already be using. Falls back to the default
 *    bucket (`getStorage().bucket()` with no args) when unset.
 * See docs/BUILD_KIT.md / README.md "Checklist de déploiement" for the full multi-app rationale.
 *
 * FAIL-FAST (audit pré-lancement 2026-07, M2 — corrigé post-déploiement) : plus AUCUN repli
 * silencieux vers "(default)". Un oubli de la variable au déploiement faisait écrire toute l'app
 * dans la base par défaut du projet partagé — c.-à-d. potentiellement la base d'une AUTRE app.
 * Le throw au chargement du module n'est armé QUE dans le vrai runtime déployé (K_SERVICE, posé
 * par Cloud Run) : la phase d'ANALYSE du CLI Firebase (`firebase deploy` → discovery) charge ce
 * module SANS les .env et échouait systématiquement (run 28955481403). Hors runtime, la garde est
 * paresseuse : firestoreDb() refuse tout accès si la base n'est pas configurée — dans tous les cas,
 * pas une seule écriture ne peut partir vers "(default)". Un déploiement mono-app qui VEUT la base
 * par défaut doit le dire explicitement (ALLOW_DEFAULT_DATABASE=true).
 */
/**
 * Rechargement des .env quand ils manquent (bug découvert par le run 28955481403) : la phase de
 * DÉCOUVERTE du CLI Firebase charge ce module sans les .env. Or certaines options de fonctions
 * sont évaluées À CE MOMENT-LÀ et figées dans le déploiement : la `database` de onDocumentWritten
 * (onIntelItemWrite se liait à "(default)" — la base d'une autre app ! — au lieu de la nôtre) et
 * la timeZone des onSchedule. Parser minimal (KEY=value, commentaires #), aucune dépendance ;
 * ne remplace JAMAIS une variable déjà présente dans l'environnement.
 */
function loadEnvFileFallback() {
  if (process.env.FIRESTORE_DATABASE_ID) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  for (const name of [project && `.env.${project}`, ".env"].filter(Boolean)) {
    let txt;
    try { txt = fs.readFileSync(path.join(__dirname, name), "utf8"); } catch { continue; }
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !m[2].startsWith("#") && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnvFileFallback();

const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  (process.env.ALLOW_DEFAULT_DATABASE === "true" ? "(default)" : null);
const MISSING_DB_MSG =
  "FIRESTORE_DATABASE_ID manquant : ce projet Firebase est PARTAGÉ — configurer la base nommée de l'app " +
  "(functions/.env.<project-id>) ou poser explicitement ALLOW_DEFAULT_DATABASE=true pour un projet mono-app.";
if (!FIRESTORE_DATABASE_ID && process.env.K_SERVICE) {
  throw new Error(MISSING_DB_MSG);
}
const STORAGE_BUCKET_NAME = process.env.STORAGE_BUCKET_NAME || undefined;
// Fuseau des schedulers (Phase 0 produit) : paramétrable par déploiement client (les onSchedule sont
// statiques au déploiement — c'est le bon niveau). Défaut = Neurones (Côte d'Ivoire).
const TENANT_TIMEZONE = process.env.TENANT_TIMEZONE || "Africa/Abidjan";

// Plafond d'instances Cloud Run (maîtrise des coûts) : sans plafond, chaque fonction peut monter à
// 100 instances par défaut — une facture qui s'emballe sur un pic. On borne globalement (défaut 10,
// paramétrable MAX_INSTANCES). Aucun minInstances : les fonctions restent à scale-to-zéro (pas
// d'instance chaude facturée 24/7). Chaque fonction peut toujours surcharger ce défaut.
const MAX_INSTANCES = Math.max(1, Number(process.env.MAX_INSTANCES) || 10);

// CPU par fonction (maîtrise du quota Cloud Run « Total CPU allocation, per project per region »).
// Par défaut firebase-functions alloue 1 vCPU/fonction (<=2Go RAM) : sur un projet NEUF plafonné à
// 20 vCPU/région (non augmentable en self-service), les ~39 fonctions x 1 vCPU ne rentrent pas.
// FUNCTION_CPU (ex. 0.25 sur sentinel-360) abaisse le CPU par défaut pour tenir sous le plafond. Non
// défini (ancien projet) => aucun changement (défaut Cloud Run = 1). cpu<1 impose concurrency=1
// (contrainte firebase-functions), pose sans effet notable pour un outil interne à faible trafic.
const FUNCTION_CPU = process.env.FUNCTION_CPU ? Number(process.env.FUNCTION_CPU) : undefined;
// cpuAtLeast(floor) : quand FUNCTION_CPU est défini, renvoie max(FUNCTION_CPU, floor) — le plancher
// couvre la contrainte Cloud Run « mémoire élevée => CPU minimal » (1Go≈0.5, 2Go≈1 vCPU). Sinon
// undefined (défaut Cloud Run). À poser en `cpu` sur les fonctions à forte mémoire (1Go/2Go).
const cpuAtLeast = (floor) => (FUNCTION_CPU === undefined ? undefined : Math.max(FUNCTION_CPU, floor));
setGlobalOptions({
  maxInstances: MAX_INSTANCES,
  ...(FUNCTION_CPU === undefined ? {} : { cpu: FUNCTION_CPU, concurrency: 1 }),
});

// Cadence des pipelines planifiés (maîtrise des coûts Vertex/Cloud Run — réglable EN DIRECT depuis
// l'app, sans redéploiement). La config vit dans `config/runtime` ({ paused, intervals{key:minutes},
// lastRun{key} }), éditée par les exécutifs via le callable setPipelineConfig. Chaque cron coûteux
// consulte gateScheduledPipeline() AVANT tout appel Vertex et se court-circuite s'il a tourné il y a
// moins de `intervals[key]` minutes — l'appel coûteux n'a alors jamais lieu. Défaut : aucun
// intervalle (cadence native inchangée), donc zéro changement de comportement tant que rien n'est réglé.
const { PIPELINE_KEYS, pipelineThrottleDecision, sanitizePipelineIntervals } = require("./domain/pipeline");

/**
 * gateScheduledPipeline(db, key) → true si le cron doit s'exécuter, false s'il est en pause ou
 * throttlé. Estampille `config/runtime.lastRun[key]` (transaction) quand il autorise le run.
 * Fail-open : toute erreur de lecture de la config laisse le pipeline s'exécuter (on ne fige jamais
 * un pipeline sur un hoquet Firestore). À appeler tout en HAUT d'un cron, avant le moindre appel IA.
 */
async function gateScheduledPipeline(db, key) {
  try {
    const ref = db.doc("config/runtime");
    const nowMs = Date.now();
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const lastRunMs = {};
      for (const k of PIPELINE_KEYS) lastRunMs[k] = toMillis((data.lastRun || {})[k]);
      const decision = pipelineThrottleDecision({ cfg: { ...data, lastRunMs }, key, nowMs });
      if (!decision.run) {
        logger.info(`pipeline ${key}: saut (${decision.reason}${decision.reason === "throttled" ? ` — ${decision.elapsedMin}min < ${decision.minMin}min` : ""}).`);
        return false;
      }
      tx.set(ref, { lastRun: { [key]: FieldValue.serverTimestamp() } }, { merge: true });
      return true;
    });
  } catch (err) {
    logger.warn(`gateScheduledPipeline(${key}): config illisible, exécution par défaut — ${err.message}`);
    return true;
  }
}

/** Firestore handle scoped to FIRESTORE_DATABASE_ID — use this everywhere instead of a bare
 * `getFirestore()` call, so every read/write in this codebase stays confined to this app's
 * dedicated database and never touches another app's "(default)" (or other named) database. */
function firestoreDb() {
  if (!FIRESTORE_DATABASE_ID) throw new Error(MISSING_DB_MSG); // garde paresseuse (hors runtime déployé)
  return FIRESTORE_DATABASE_ID === "(default)" ? getFirestore() : getFirestore(FIRESTORE_DATABASE_ID);
}

/** Storage bucket handle scoped to STORAGE_BUCKET_NAME — same rationale as db() above. */
function defaultBucket() {
  return STORAGE_BUCKET_NAME ? getStorage().bucket(STORAGE_BUCKET_NAME) : getStorage().bucket();
}

/* ------------------------------------------------------------------------------------------- *
 * WEBHOOKS — intégrations tierces (sortants + entrants). Module PUR domain/webhooks.js pour la
 * signature HMAC + les validateurs ; ici l'implémentation (Firestore + réseau). Collections :
 *   webhookEndpoints/{id}        — endpoints SORTANTS (url, events[], secret, active, …)
 *   webhookInboundSources/{id}   — sources ENTRANTES (label, actions[], secret, active, …)
 *   webhookDeliveries/{auto}     — journal des livraisons sortantes (succès/échec, statut, essais)
 *   webhookInboundLog/{auto}     — journal des requêtes entrantes (action, source, résultat)
 * Toutes réservées à la Direction (règles Firestore) ; JAMAIS d'écriture cliente directe — tout
 * passe par les callables webhookAdmin/userAdmin. Les secrets ne quittent le serveur qu'UNE fois,
 * à la création/rotation (jamais relus en clair ensuite : maskSecret).
 * ------------------------------------------------------------------------------------------- */
const nodeCrypto = require("node:crypto");
const {
  OUTBOUND_EVENTS: WH_OUTBOUND_EVENTS,
  INBOUND_ACTIONS: WH_INBOUND_ACTIONS,
  SIGNATURE_HEADER: WH_SIG_HEADER,
  TIMESTAMP_HEADER: WH_TS_HEADER,
  EVENT_HEADER: WH_EVENT_HEADER,
  signPayload: whSign,
  verifySignature: whVerify,
  generateSecret: whGenerateSecret,
  maskSecret: whMaskSecret,
  sanitizeEndpoint: whSanitizeEndpoint,
  sanitizeInboundSource: whSanitizeInboundSource,
  endpointMatchesEvent: whEndpointMatchesEvent,
  buildEventEnvelope: whBuildEnvelope,
} = require("./domain/webhooks");

/** Seuil de score à partir duquel un signal de veille déclenche l'événement sortant `intel.signal`. */
const WEBHOOK_SIGNAL_MIN_SCORE = Number(process.env.WEBHOOK_SIGNAL_MIN_SCORE) || 70;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 8000;
const WEBHOOK_MAX_ATTEMPTS = 3;

/** POST signé vers un endpoint, avec réessais bornés (backoff court). Best-effort, ne lève jamais. */
async function deliverToEndpoint(endpoint, envelope) {
  const body = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const signature = whSign(body, endpoint.secret, ts);
  let lastError = null;
  let status = 0;
  let attempts = 0;
  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_DELIVERY_TIMEOUT_MS);
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [WH_SIG_HEADER]: signature,
          [WH_TS_HEADER]: String(ts),
          [WH_EVENT_HEADER]: envelope.type,
        },
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      status = res.status;
      if (res.ok) { lastError = null; break; }
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
    if (attempt < WEBHOOK_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: !lastError, status, error: lastError, attempts };
}

/**
 * dispatchWebhookEvent(db, eventType, data) — fan-out d'un événement vers tous les endpoints actifs
 * abonnés. Garde SSRF : l'URL de chaque endpoint est revérifiée (checkPublicHttpUrl) au moment de
 * l'envoi — un endpoint pointant vers une IP interne est bloqué et journalisé. Best-effort : ne
 * lève jamais (un webhook cassé ne doit pas faire échouer l'écriture métier qui l'a déclenché).
 */
async function dispatchWebhookEvent(db, eventType, data) {
  try {
    const snap = await db.collection("webhookEndpoints").where("active", "==", true).get();
    const targets = [];
    snap.forEach((d) => {
      const ep = { id: d.id, ...d.data() };
      if (whEndpointMatchesEvent(ep, eventType) && ep.url && ep.secret) targets.push(ep);
    });
    if (!targets.length) return;
    const envelope = whBuildEnvelope(eventType, data, {
      id: `evt_${nodeCrypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    });
    await Promise.allSettled(
      targets.map(async (ep) => {
        const guard = checkPublicHttpUrl(ep.url);
        const result = guard.ok
          ? await deliverToEndpoint(ep, envelope)
          : { ok: false, status: 0, error: `URL bloquée: ${guard.reason}`, attempts: 0 };
        await db.collection("webhookDeliveries").add({
          endpointId: ep.id,
          event: eventType,
          url: ep.url,
          ok: result.ok,
          status: result.status,
          error: result.error || null,
          attempts: result.attempts,
          ts: FieldValue.serverTimestamp(),
        });
        await db
          .doc(`webhookEndpoints/${ep.id}`)
          .set({ lastDeliveryOk: result.ok, lastDeliveryAt: FieldValue.serverTimestamp(), lastError: result.error || null }, { merge: true })
          .catch(() => {});
      })
    );
    logger.info(`dispatchWebhookEvent: ${eventType} → ${targets.length} endpoint(s)`);
  } catch (e) {
    logger.error(`dispatchWebhookEvent(${eventType}) FAILED: ${e.message}`);
  }
}

/* ------------------------------------------------------------------------------------------- *
 * Contexte entreprise DYNAMIQUE (décision 2026-07 : « le contexte est aussi censé être
 * dynamique »). La vérité vit dans frameworks/companyContext (versionné, éditable Direction,
 * rafraîchi par l'enrichissement hebdo avec la garde anti-écrasement humain de
 * writeFrameworkDoc) ; domain/companyContext.js n'est plus que le seed initial + le repli.
 * Cache en mémoire d'instance (TTL 10 min) pour ne pas relire le doc à chaque classification.
 * ------------------------------------------------------------------------------------------- */
const { COMPANY_CONTEXT: STATIC_COMPANY_CONTEXT } = require("./domain/companyContext");
const COMPANY_CONTEXT_TTL_MS = 10 * 60 * 1000;
let companyContextCache = { text: null, ts: 0 };

async function getCompanyContext() {
  const now = Date.now();
  if (companyContextCache.text && now - companyContextCache.ts < COMPANY_CONTEXT_TTL_MS) {
    return companyContextCache.text;
  }
  try {
    const snap = await firestoreDb().doc("frameworks/companyContext").get();
    const text = snap.exists ? snap.data()?.content?.text : null;
    companyContextCache = { text: typeof text === "string" && text.trim() ? text : STATIC_COMPANY_CONTEXT, ts: now };
  } catch (err) {
    logger.warn(`getCompanyContext: lecture frameworks/companyContext échouée (${err.message}) — repli sur le contexte statique`);
    companyContextCache = { text: STATIC_COMPANY_CONTEXT, ts: now };
  }
  return companyContextCache.text;
}

/** Invalide le cache après une écriture du contexte (rafraîchissement IA) pour que les étapes
 * suivantes du même run utilisent immédiatement la nouvelle version. */
function invalidateCompanyContextCache() {
  companyContextCache = { text: null, ts: 0 };
  clientProfileCache = { profile: null, ts: 0 };
}

/* ------------------------------------------------------------------------------------------- *
 * PROFIL CLIENT (Phase 0 « produit agnostique ») — surcouche de config lisible depuis Firestore
 * pour rendre l'outil paramétrable/agnostique à l'entreprise (déploiement par client). Cette PR
 * établit le CHARGEMENT et le FALLBACK ; aucun prompt ni scoring ne le consomme encore (les PR
 * suivantes câbleront). Tant qu'aucun doc `config/*` n'existe, le profil résolu == DEFAULT_PROFILE
 * (= comportement Neurones actuel). Même patron de cache que getCompanyContext (TTL 10 min).
 * ------------------------------------------------------------------------------------------- */
const { buildClientProfile, scoringConfig } = require("./domain/profile");
// Docs Firestore surchargeant le profil par défaut (clé profil ← chemin doc / champ lu).
const PROFILE_CONFIG_DOCS = [
  ["profile", "config/profile", (d) => d],
  ["taxonomy", "config/veilleTaxonomy", (d) => d],
  ["scoring", "config/scoring", (d) => d],
  ["offerMapping", "config/offerMapping", (d) => d],
  ["sourceAuthority", "config/sourceAuthority", (d) => d],
  ["internalData", "config/internalData", (d) => d],
];
let clientProfileCache = { profile: null, ts: 0 };

/**
 * loadClientProfile(db?) -> profil résolu (DEFAULT_PROFILE + surcharges Firestore). Lit les docs
 * `config/*` + le contexte (frameworks/companyContext, déjà géré par getCompanyContext) et fusionne.
 * Best-effort : toute lecture échouée retombe sur le défaut, jamais d'exception propagée.
 */
async function loadClientProfile(db) {
  const now = Date.now();
  if (clientProfileCache.profile && now - clientProfileCache.ts < COMPANY_CONTEXT_TTL_MS) {
    return clientProfileCache.profile;
  }
  const database = db || firestoreDb();
  const overrides = {};
  try {
    const snaps = await Promise.all(PROFILE_CONFIG_DOCS.map(([, path]) => database.doc(path).get().catch(() => null)));
    PROFILE_CONFIG_DOCS.forEach(([key, , pick], i) => {
      const snap = snaps[i];
      if (snap && snap.exists) {
        const data = pick(snap.data());
        if (data && typeof data === "object") overrides[key] = data;
      }
    });
    // Le contexte réutilise le chargement/cache existant (source unique).
    overrides.contextText = await getCompanyContext();
  } catch (err) {
    logger.warn(`loadClientProfile: lecture config/* échouée (${err.message}) — profil par défaut`);
  }
  const profile = buildClientProfile(overrides);
  clientProfileCache = { profile, ts: now };
  return profile;
}

const NOT_IMPLEMENTED = (fn, phase) => {
  const msg = `${fn} not implemented — see BUILD_KIT.md roadmap ${phase}`;
  logger.warn(msg);
  throw new Error(msg);
};

/**
 * Path convention (chosen here — not spelled out verbatim in BUILD_KIT.md/DELTA_01 beyond
 * "Storage onFinalize (imports/*.xlsx)"): `imports/{kind}/{filename}.xlsx`, where `kind` is one
 * of the 4 internal sources below. `kind` is inferred from the path segment right after
 * `imports/`. Files uploaded to any other `imports/...` shape (or an unknown kind) are ignored
 * with a warning log rather than throwing — Storage triggers can't reject the upload after the
 * fact, so a no-op is the only sane response to a misplaced file.
 */
const INGEST_KINDS = {
  pnl: { parse: parsePnl, resultKey: "orders", stateField: "orders" },
  live: { parse: parseLive, resultKey: "opportunities", stateField: "opportunities" },
  facturation: { parse: parseFacturationDf, resultKey: "invoices", stateField: "invoices" },
  fiche: { parse: parseFiche, resultKey: "bcLines", stateField: "bcLines" },
};

/**
 * Recomputes `summaries/quanti` (BUILD_KIT.md §6) from whatever `imports_state/{kind}` docs
 * currently exist. The 4 internal sources are uploaded independently/asynchronously (DELTA_01
 * §3bis.E: different frequencies — P&L/LIVE "à chaque import", Facturation "hebdo", etc.), so this
 * recomputes from a PARTIAL combination on every ingest: whichever domain function's required
 * source(s) are missing simply yields null/[] for that section (same graceful-null pattern as
 * V3's aggregateVeilleExec/computeVeilleExecSummary) rather than blocking the whole summary on
 * having all 4 files present at once.
 *
 * Not computed here (documented, out of V4 scope / not derivable from these 4 sources alone):
 *   - `ge9`: GE-McKinsey 9-box needs a market-attractiveness axis with no internal-data proxy
 *     (see web/src/modules/veille/views/Portefeuille.tsx comment) — left null.
 *   - `marginAvg`: BUILD_KIT.md §6 lists this field but doesn't specify a formula distinct from
 *     BCG's per-BU `marge`; left null here rather than inventing an aggregation. A future phase
 *     can define it (e.g. Σ mb / Σ cas across all orders) once real P&L units are confirmed.
 *   - `recurrentShare`: same prerequisite gap as the "Part de récurrent" KRI (DELTA_01 §3bis.F) —
 *     left null.
 */
async function computeSummaryQuanti(db) {
  const [pnlSnap, liveSnap, facturationSnap, ficheSnap] = await Promise.all([
    db.doc("imports_state/pnl").get(),
    db.doc("imports_state/live").get(),
    db.doc("imports_state/facturation").get(),
    db.doc("imports_state/fiche").get(),
  ]);

  const orders = pnlSnap.exists ? pnlSnap.data().orders : undefined;
  const opportunities = liveSnap.exists ? liveSnap.data().opportunities : undefined;
  const invoices = facturationSnap.exists ? facturationSnap.data().invoices : undefined;
  // bcLines (ficheSnap) intentionally unused — see functions/parsers/fiche.js note: not consumed
  // by any domain/quanti.js function in V4's scope.
  void ficheSnap;

  const porterForces = computePorterForces({ orders, opportunities });
  const bcg = computeBcg({ orders });
  const { casTotal, casN1Total } = computeCasSummary({ orders });
  const { pipelinePondere, realise: pipelineRealise, winRate } = computePipeline({ opportunities });
  const kris = computeKris({ orders, opportunities, invoices });
  const valueAtStake = computeValueAtStake({ opportunities });
  const granularite = computeGranularite({ orders });

  return {
    porterForces,
    bcg,
    granularite,
    ge9: null, // not derivable from internal data alone — see comment above
    // casTotal/casN1Total: portfolio-wide CAS (current/prior year), from P&L `orders` — feeds the
    // Simulateur's SIM_BASE.cas calibration (BUILD_KIT.md §8.2/§11, web/.../views/Simulateur.tsx).
    casTotal,
    casN1Total,
    pipelinePondere,
    pipelineRealise, // CA déjà gagné (Gagné) — exposé à part du pondéré (prévision = affaires ouvertes)
    winRate,
    marginAvg: null, // not specified beyond BCG's per-BU marge — see comment above
    supplierSaturation: porterForces.pouvoirFournisseurs, // reuse Top-3 fournisseur concentration
    recurrentShare: null, // prerequisite tag missing — DELTA_01 §3bis.F
    kris,
    valueAtStake,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * ingestInternal — Storage onFinalize (imports/{kind}/*.xlsx)
 * SheetJS: parse P&L / LIVE / Facturation DF / fiche affaire → summaries/quanti
 * (Porter, BCG/GE, pipeline pondéré, win rate, marge, saturation, KRIs, value-at-stake).
 *
 * Persists each source's freshly-parsed rows into `imports_state/{kind}` (admin-only working
 * docs, not part of the public schema in BUILD_KIT.md §6 — an internal staging area) so that
 * `computeSummaryQuanti` can be recomputed from any combination of sources ingested so far
 * (sources arrive independently, not all at once — see computeSummaryQuanti's doc comment).
 * Also writes an `imports/{id}` audit doc per BUILD_KIT.md §6 shape `{uid, kind, filename,
 * rowsIn, rowsOk, report, ts}` — `uid` is null because Storage triggers are system-triggered, not
 * tied to a calling user (no `request.auth` exists in this trigger type). `firestore.rules`
 * restricts `imports/{id}` reads to `exec()` and all writes to `false`; the Admin SDK used here
 * bypasses Security Rules entirely, which is the intended/documented behavior (BUILD_KIT.md §7
 * note: "Imports & agrégats écrits par l'Admin SDK (Functions) contournent les rules").
 * Roadmap: V4 Quanti interne.
 */
exports.ingestInternal = onObjectFinalized(
  {
    region: "europe-west1",
    // Watch the dedicated bucket (STORAGE_BUCKET_NAME) when set — otherwise this trigger defaults
    // to the project's default bucket, which in a shared project may belong to another app.
    ...(STORAGE_BUCKET_NAME ? { bucket: STORAGE_BUCKET_NAME } : {}),
  },
  async (event) => {
    const filePath = event.data?.name;
    if (!filePath || !filePath.startsWith("imports/")) return;

  const segments = filePath.split("/");
  const kind = segments[1];
  const config = INGEST_KINDS[kind];
  if (!config) {
    logger.warn(`ingestInternal: unrecognized kind "${kind}" for ${filePath} — expected one of ${Object.keys(INGEST_KINDS).join(", ")}`);
    return;
  }

  const filename = segments[segments.length - 1];
  const db = firestoreDb();

  try {
    const bucket = getStorage().bucket(event.data.bucket);
    const [buffer] = await bucket.file(filePath).download();

    const parsed = await config.parse(buffer); // parseurs xlsx→exceljs désormais asynchrones (M4)
    const rows = parsed[config.resultKey] || [];
    const { rowsIn, rowsOk, warnings } = parsed;

    await db.doc(`imports_state/${kind}`).set({
      [config.stateField]: rows,
      filename,
      rowsIn,
      rowsOk,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection("imports").add({
      uid: null, // system-triggered (Storage onFinalize) — no calling user
      kind,
      filename,
      rowsIn,
      rowsOk,
      report: { warnings },
      ts: FieldValue.serverTimestamp(),
    });

    // SOURCE DE VÉRITÉ (m4 audit 2026-07) : depuis le branchement nt360, `summaries/quanti` est
    // alimenté EXCLUSIVEMENT par runInternalQuantiSync (données internes live). L'import Excel
    // (chemin legacy/manuel) écrit dans un doc DISTINCT `summaries/quanti_excel` pour ne plus
    // entrer en conflit d'écrivains sur le même document (« dernier écrivain gagne » ambigu).
    const summary = await computeSummaryQuanti(db);
    await db.doc("summaries/quanti_excel").set({ ...summary, source: `excel:${kind}` });

    logger.info(`ingestInternal: kind=${kind} file=${filePath} rowsIn=${rowsIn} rowsOk=${rowsOk} warnings=${warnings.length} → summaries/quanti_excel`);
  } catch (err) {
    // Observability (V8): a parse/Firestore failure here must be loud — nothing downstream
    // (aggregates, UI) will otherwise explain why summaries/quanti didn't update.
    logger.error(`ingestInternal: kind=${kind} file=${filePath} FAILED — ${err.message}`, { err });
    throw err; // let Cloud Functions mark the invocation as failed (retries/alerting rely on this)
  }
});

/**
 * Minimal, intentionally-simplified RSS `<item>` extractor (regex/string based, NOT a real XML
 * parser — documented simplification per the V7 task brief). Pulls `<title>`, `<description>`
 * and `<link>` out of each `<item>...</item>` block, unescapes the handful of XML entities RSS
 * feeds commonly use, and strips any CDATA wrapper. Good enough to feed short raw text into the
 * classification prompt; NOT a substitute for a real feed parser (no namespace/Atom support, no
 * malformed-XML recovery).
 */
function extractRssItems(xml, maxItems = 5) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const block = m[1];
    const grab = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const mm = re.exec(block);
      if (!mm) return "";
      return mm[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/i, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, "")
        .trim();
    };
    // pubDate (ou dc:date) normalisé en YYYY-MM-DD → date d'événement (m3 audit) : évite qu'un
    // article RSS sans lien change d'ID chaque jour (ID = titre|date d'ingestion).
    let pubDate = "";
    const rawDate = grab("pubDate") || grab("dc:date") || grab("published") || grab("updated");
    if (rawDate) {
      const d = new Date(rawDate);
      if (!Number.isNaN(d.getTime())) pubDate = d.toISOString().slice(0, 10);
    }
    items.push({ title: grab("title"), description: grab("description"), link: grab("link"), pubDate });
  }
  return items;
}

/**
 * Minimal HTML→text extraction for `kind: "web"` sources (documented simplification — NOT a real
 * readability/HTML-to-text pipeline, just strips tags/scripts/styles and truncates). Good enough
 * as raw material for the classification prompt.
 */
function extractWebText(html, maxChars = 4000) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/**
 * Résout une URL relative (`/avis/123`) en absolue à partir de l'URL de base de la source.
 * Renvoie null si le href n'est pas exploitable (ancre interne, javascript:, mailto:).
 */
function absolutizeUrl(href, base) {
  if (!href || typeof href !== "string") return null;
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(javascript:|mailto:|tel:)/i.test(h)) return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

/**
 * crawlSite(url, {maxPages}) — ONBOARDING (Phase 1) : aspire le texte du site d'un client pour en
 * déduire son profil/écosystème. Fetch la home (fallback rendu headless si dégradé) puis suit jusqu'à
 * `maxPages-1` liens internes prioritaires (pickOnboardingLinks : à-propos/offres/clients/contact),
 * concatène le texte nettoyé. FAIL-SOFT : une page en échec est simplement ignorée, jamais d'exception.
 * Borné en taille. I/O — non testé unitairement (réseau).
 */
async function crawlSite(url, { maxPages = 5 } = {}) {
  const texts = [];
  let homeHtml = "";
  try {
    homeHtml = await fetchSource(url);
    if (isDegradedWebPage(extractWebText(homeHtml))) homeHtml = await fetchRendered(url);
  } catch (e) {
    try { homeHtml = await fetchRendered(url); } catch { homeHtml = ""; }
  }
  if (homeHtml) texts.push(extractWebText(homeHtml, 6000));
  const links = homeHtml ? pickOnboardingLinks(homeHtml, url).slice(0, Math.max(0, maxPages - 1)) : [];
  for (const link of links) {
    try {
      const html = await fetchSource(link);
      const t = extractWebText(html, 3000);
      if (t && !isDegradedWebPage(t)) texts.push(t);
    } catch { /* fail-soft : page ignorée */ }
  }
  return texts.join("\n\n").slice(0, 16000);
}

/**
 * validateCandidateSource(url, kind) -> { ok, itemCount, reason } — ONBOARDING (Phase 1) : vérifie
 * qu'une source proposée par l'IA renvoie RÉELLEMENT des items exploitables avant de la retenir (on
 * ne persiste jamais une URL non fetchable/vide). Ne throw JAMAIS. I/O.
 */
async function validateCandidateSource(url, kind) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    return { ok: false, itemCount: 0, reason: "URL invalide" };
  }
  try {
    if (kind === "rss" || kind === "newsletter") {
      const xml = await fetchSource(url);
      const items = extractRssItems(xml, 10);
      return { ok: items.length > 0, itemCount: items.length, reason: items.length ? "" : "aucun item RSS" };
    }
    const html = kind === "web-js" ? await fetchRendered(url) : await fetchSource(url);
    const items = extractWebItems(html, url, 8);
    if (items.length) return { ok: true, itemCount: items.length, reason: "" };
    const text = extractWebText(html);
    const usable = !!text && text.length > 200 && !isDegradedWebPage(text);
    return { ok: usable, itemCount: 0, reason: usable ? "" : "page vide/dégradée" };
  } catch (e) {
    return { ok: false, itemCount: 0, reason: (e && e.message) || "échec du fetch" };
  }
}

/**
 * Extraction MULTI-ITEMS pour les portails `kind:"web"` (avis d'AO, actualités). Corrige C5
 * (audit 2026-07) : sans ça, chaque page web s'effondrait en UN seul intelItem figé sur l'URL du
 * portail. Heuristique regex (pas un vrai parseur DOM) : on récupère les liens et titres porteurs
 * de texte substantiel, on déduplique par intitulé, et on renvoie jusqu'à `max` entrées
 * {title, link, description}. Chaque entrée aura ainsi un ID déterministe distinct.
 */
function extractWebItems(html, base, max = 8) {
  const seen = new Set();
  const items = [];
  const push = (rawTitle, href) => {
    const title = String(rawTitle || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (title.length < 25 || title.length > 220) return; // trop court = menu/nav ; trop long = paragraphe
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ title, link: absolutizeUrl(href, base) || base, description: "" });
  };
  // 1) Ancres avec texte porteur (avis d'AO listés comme liens).
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html)) !== null && items.length < max * 3) {
    push(m[2], m[1]);
  }
  // 2) Titres h1-h3 (actualités structurées) si on manque d'items.
  if (items.length < max) {
    const hRe = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
    while ((m = hRe.exec(html)) !== null && items.length < max * 3) {
      push(m[1], null);
    }
  }
  // Dédoublonnage INTELLIGENT (Vague C) : au-delà de la clé exacte (seen), on écarte les quasi-
  // doublons de titre (même actu listée sous 2 formulations proches sur la même page).
  return dedupeByTitle(items).slice(0, max);
}

/** Détecte une page « coquille » (SPA JS non rendue) : très peu de texte utile → source dégradée
 * (M1 audit). Renvoie true si le contenu extrait est trop maigre pour être du renseignement. */
function isDegradedWebPage(text) {
  return !text || text.replace(/\s+/g, " ").trim().length < 200;
}

/**
 * Classifies one raw text extract via Vertex AI (buildClassificationPrompt → generateJson →
 * parseClassificationResponse) and returns the parsed IntelItem fields, or `null` if the AI
 * response was unusable (mirrors `parseClassificationResponse`'s contract).
 */
async function classifyRawText(rawText, watchlistEntities, context, profile) {
  const companyContext = await getCompanyContext();
  // Repères temporels : date de publication de la source (context.defaultDate) → le classifieur
  // juge passé/à-venir sur des dates réelles plutôt que sur le ton du texte (anti-obsolescence).
  const prompt = buildClassificationPrompt(rawText, watchlistEntities, companyContext, {
    pubDate: context && context.defaultDate ? context.defaultDate : undefined,
    profile, // profil client (Phase 0) : blocs client-spécifiques + taxonomie ; absent → défauts Neurones
  });
  // Sémaphore global (M6) : borne la concurrence Vertex réelle à AI_CONCURRENCY, y compris quand
  // plusieurs sources classifient leurs items en parallèle.
  // Extraction : température 0 (déterministe) + modèle d'extraction configurable (coûts) — GEMINI_MODEL_EXTRACTION
  // permet un flash-lite moins cher pour ce gros volume ; non défini → modèle par défaut (inchangé).
  const response = await vertexLimit(() => generateJson(prompt, { temperature: 0, model: process.env.GEMINI_MODEL_EXTRACTION }));
  // La taxonomie du profil sert AUSSI à valider/normaliser la sortie (axes/subtypes custom). La
  // watchlist est passée pour contraindre `ent` aux entités connues (anti faux-rattachement).
  return parseClassificationResponse(response, {
    ...(context || {}),
    taxonomy: profile && profile.taxonomy,
    watchlist: watchlistEntities,
  });
}

/**
 * Writes (or idempotently re-merges) a classified item into `intelItems`, computing the SAME
 * deterministic id the client would (`functions/domain/ids.js#intelItemId`, mirrors
 * `web/src/modules/veille/lib/intel.ts`). NEVER clobbers a human-reviewed doc: if a doc already
 * exists at that id with `status !== 'new'` (i.e. a human has already reviewed/actioned/archived
 * it), the AI-sourced update is skipped entirely rather than merged — the human decision stands.
 * Roadmap: V7 IA & sync — BUILD_KIT.md §1 "Rien n'est publié par l'IA sans revue humaine".
 */
async function upsertClassifiedItem(db, classified, dedupeIndex) {
  const id = intelItemId({ url: classified.url, title: classified.title, date: classified.date });
  const ref = db.doc(`intelItems/${id}`);
  const existing = await ref.get();
  if (existing.exists && existing.data().status !== "new") {
    logger.info(`syncSources: skip ${id} — already reviewed/actioned/archived (human decision stands)`);
    return { id, written: false };
  }
  // Anti-QUASI-doublon (bug « doublons dans les signaux ») : le même événement vu par deux sources aux
  // URLs différentes a un id déterministe différent. Avant de créer un NOUVEAU signal, on écarte s'il
  // recoupe un signal récent du MÊME axe déjà présent (titre quasi identique). L'id exact reste la garde
  // primaire (re-merge idempotent d'une même source) ; ceci couvre le cross-source.
  if (!existing.exists && Array.isArray(dedupeIndex)) {
    const axis = classified.axis || "";
    const title = classified.title || "";
    // Même axe + quasi-doublon standard, OU fort recouvrement quel que soit l'axe (même événement vu
    // par deux sources et classé sur des axes différents) — audit pertinence 2026-07. Garde M3 : un
    // discriminant fort divergent (référence d'AO/acheteur/entité) empêche la fusion d'AO distincts.
    const dup = dedupeIndex.find((e) =>
      !blocksMerge(e.item, classified) &&
      (((e.axis || "") === axis && isNearDuplicate(e.title, title)) || isStrongDuplicate(e.title, title))
    );
    if (dup) {
      logger.info(`syncSources: skip near-duplicate « ${String(classified.title).slice(0, 60)} » ~ « ${String(dup.title).slice(0, 60)} »`);
      return { id, written: false, duplicate: true };
    }
    dedupeIndex.push({ title: classified.title || "", axis, item: classified });
  }
  const { status: _classifiedStatus, ...rest } = classified;
  await ref.set(
    {
      ...rest,
      // PORTE DE QUALITÉ (audit « insights manquent de pertinence ») : un NOUVEAU signal IA reste EN
      // ATTENTE d'évaluation (`pending`) — invisible du fil/radar jusqu'à ce que l'évaluateur le publie
      // (`new`) ou l'écarte (`rejected`). Un signal déjà présent conserve son statut (jamais re-gaté).
      status: existing.exists ? (existing.data().status || "new") : "pending",
      createdBy: "system:syncSources",
      createdAt: existing.exists ? existing.data().createdAt : FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { id, written: true };
}

/**
 * runSyncSources — shared implementation for `syncSources` (scheduled) and `syncSourcesNow`
 * (manual on-demand trigger, added so this can be tested/run without waiting for 06:00
 * Africa/Abidjan). Fetches active `intelSources` (RSS/web/portails) → classifyAI → creates
 * `intelItems{status:new}`.
 *
 * `kind: 'manual'` sources are skipped (nothing to fetch — they're fed by human submissions via
 * the Fil.tsx contribution form). `kind: 'rss'`/`'web'` are fetched with Node 20's built-in
 * `fetch`. EACH source is wrapped in its own try/catch so one failing source (dead URL, malformed
 * feed, Vertex AI hiccup) never aborts the whole run — logged and skipped, next source continues.
 * Roadmap: V7 IA & sync.
 */
/**
 * ensureWatchlistMonitorSources(db) — SURVEILLANCE ACTIVE des entités (2026-07) : met en phase des
 * sources RSS de recherche Google News avec la watchlist, pour que chaque entité PRIORITAIRE
 * (Haute/Moyenne) soit réellement cherchée (et pas seulement étiquetée si un flux généraliste la cite).
 * Idempotent : ids déterministes `wlmon-<slug>`, upsert en merge (préserve lastStatus/échecs), et
 * désactivation (jamais suppression) des sources d'entités devenues non prioritaires/inactives.
 * Best-effort : une erreur ici ne doit pas casser la synchro.
 */
async function ensureWatchlistMonitorSources(db) {
  try {
    const [wlSnap, monSnap] = await Promise.all([
      db.collection("intelWatchlist").get(),
      db.collection("intelSources").where("source", "==", MONITOR_SOURCE_TAG).get(),
    ]);
    const entities = wlSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Etat existant des sources monitor (active/echecs/contenu) : indispensable pour NE PAS ressusciter
    // un flux auto-desactive pour echecs, ni reecrire des docs inchanges (audit final pre-prod 2026-07).
    const existingById = {};
    for (const d of monSnap.docs) {
      const x = d.data() || {};
      existingById[d.id] = { active: x.active, consecutiveFailures: x.consecutiveFailures, url: x.url, name: x.name, axis: x.axis };
    }
    const { upserts, deactivateIds } = planWatchlistMonitors(entities, existingById, { failureThreshold: MAX_CONSECUTIVE_FAILURES });
    if (!upserts.length && !deactivateIds.length) return;
    const batch = db.batch();
    for (const s of upserts) {
      // `active:true` n'est ecrit QUE pour une source nouvelle ou une reactivation legitime (activate) :
      // on ne force jamais active sur une source auto-desactivee pour echecs (elle reste inactive).
      const set = { name: s.name, url: s.url, kind: s.kind, axis: s.axis || null, source: MONITOR_SOURCE_TAG, watchlistEntity: s.watchlistEntity };
      if (s.activate) set.active = true;
      batch.set(db.doc(`intelSources/${s.id}`), set, { merge: true });
    }
    for (const id of deactivateIds) {
      batch.set(db.doc(`intelSources/${id}`), { active: false }, { merge: true });
    }
    await batch.commit();
    logger.info(`ensureWatchlistMonitorSources: ${upserts.length} source(s) d'entite en phase, ${deactivateIds.length} desactivee(s).`);
  } catch (err) {
    logger.warn(`ensureWatchlistMonitorSources: echec (non bloquant) — ${err.message}`);
  }
}

async function runSyncSources(db) {
  const statusRef = db.doc("summaries/syncStatus");
  const writeSyncStatus = (patch) => statusRef.set(patch, { merge: true }).catch(() => {});

  // VERROU EN TÊTE (audit final pré-prod 2026-07 + M9) : on acquiert le verrou de run AVANT toute
  // écriture de sources monitor et AVANT la lecture full-collection intelItems, pour ne PAS payer O(N)
  // reads/writes sur un run concurrent rejeté (sync manuelle pendant le cron). Si un run est marqué
  // running depuis moins de SYNC_LOCK_TTL_MS, on refuse de démarrer ; au-delà du TTL le verrou est
  // périmé (run tué au timeout) et repris. `total` est inconnu ici (sources pas encore chargées) → 0,
  // mis à jour plus bas une fois la liste connue.
  let lockAcquired = false;
  try {
    lockAcquired = await db.runTransaction(async (tx) => {
      const snap = await tx.get(statusRef);
      const cur = snap.exists ? snap.data() : {};
      const startedMs = cur.startedAt && typeof cur.startedAt.toMillis === "function" ? cur.startedAt.toMillis() : 0;
      if (cur.running === true && startedMs && Date.now() - startedMs < SYNC_LOCK_TTL_MS) return false;
      tx.set(statusRef, { running: true, startedAt: FieldValue.serverTimestamp(), finishedAt: null, total: 0, processed: 0, created: 0, phase: "ingestion" }, { merge: true });
      return true;
    });
  } catch (e) {
    // Transaction indisponible → on continue SANS verrou (mieux vaut une sync que pas de sync).
    logger.warn(`syncSources: verrou indisponible (${e.message}) — run sans verrou`);
    lockAcquired = true;
    await writeSyncStatus({ running: true, startedAt: FieldValue.serverTimestamp(), finishedAt: null, total: 0, processed: 0, created: 0, phase: "ingestion" });
  }
  if (!lockAcquired) {
    logger.warn("syncSources: un run est déjà en cours (verrou actif) — démarrage refusé");
    return { sourcesTotal: 0, sourcesProcessed: 0, itemsCreated: 0, deduped: 0, evaluated: 0, rejected: 0, skipped: true };
  }

  // Verrou tenu : on peut engager les opérations coûteuses. Génère/met à jour les sources de
  // surveillance des entités watchlist AVANT de charger la liste, pour qu'elles soient crawlées dès ce run.
  await ensureWatchlistMonitorSources(db);

  const [sourcesSnap, watchlistSnap] = await Promise.all([
    db.collection("intelSources").where("active", "==", true).get(),
    db.collection("intelWatchlist").where("active", "==", true).get(),
  ]);
  const watchlistEntities = watchlistSnap.docs.map((d) => ({ name: d.data().name, type: d.data().type }));

  // Plafond de coût par run (audit M7) : le nombre de sources actives n'était pas borné — 200
  // sources × 8 items = ~1600 appels Vertex/run. Au-delà du plafond, ROTATION quotidienne (le point
  // de départ avance chaque jour) pour que toutes les sources finissent par passer sans affamer la
  // fin de liste.
  let sourceDocs = sourcesSnap.docs;
  if (sourceDocs.length > MAX_SOURCES_PER_RUN) {
    const start = (new Date().getDate() * MAX_SOURCES_PER_RUN) % sourceDocs.length;
    sourceDocs = [...sourceDocs.slice(start), ...sourceDocs.slice(0, start)].slice(0, MAX_SOURCES_PER_RUN);
    logger.warn(`syncSources: ${sourcesSnap.size} sources actives > plafond ${MAX_SOURCES_PER_RUN}/run — rotation quotidienne (départ index ${start})`);
  }

  // Profil client (Phase 0 produit) : surcharge éventuelle de la notation des sources par domaine.
  // Absent → défaut Neurones (aucun changement de comportement).
  const clientProfile = await loadClientProfile(db);

  // Index anti-quasi-doublon (bug « doublons dans les signaux ») : titres+axes des signaux NON archivés
  // déjà présents. Partagé (mutable) entre les sources d'un même run pour aussi capter les doublons
  // intra-run (best-effort : les lots parallèles peuvent se croiser, l'id exact reste la garde dure).
  let dedupeIndex = [];
  // Set des IDs déjà ingérés (maîtrise des coûts, 2026-07) : les flux RSS/portails re-servent les MÊMES
  // items à chaque passe. L'ID est déterministe (hash de l'URL) : on peut donc le calculer AVANT
  // l'appel Vertex et SAUTER la classification d'un item déjà connu — item identique, déjà classé, la
  // dédup post-classification l'aurait de toute façon écarté. Zéro perte de qualité, coupe la dépense IA
  // redondante (le gros de la facture). Ne s'applique qu'aux items portant une URL propre (ID stable).
  const existingIds = new Set();
  let skippedKnown = 0;
  try {
    const existingSnap = await db.collection("intelItems").get();
    for (const d of existingSnap.docs) existingIds.add(d.id);
    dedupeIndex = existingSnap.docs
      .map((d) => d.data())
      .filter((x) => x && (x.status || "new") !== "archived" && x.title)
      .map((x) => ({ title: x.title, axis: x.axis || "", item: x }));
  } catch (e) {
    logger.warn(`syncSources: index anti-doublon indisponible (${e.message}) — dédup par id seulement`);
  }

  let sourcesProcessed = 0;
  let itemsCreated = 0;

  // Suivi de PROGRESSION (UX 2026-07) : on publie l'avancement dans summaries/syncStatus pour que le
  // front affiche « X/Y sources · N signaux · phase » en direct. Le verrou (posé en tête avec total=0)
  // est déjà tenu ; on met à jour `total` maintenant que la liste des sources est connue.
  const total = sourceDocs.length;
  await writeSyncStatus({ total });

  // Traite UNE source : fetch + extraction + classification. Renvoie le nombre d'items créés.
  // Isolé pour être exécuté en LOTS PARALLÈLES (runInBatches) — la boucle séquentielle précédente
  // dépassait le timeout avant d'avoir traité toutes les sources (C4 audit 2026-07).
  const processSource = async (sourceDoc) => {
    const source = { id: sourceDoc.id, ...sourceDoc.data() };
    try {
      if (source.kind === "manual") return 0;
      if (!source.url) {
        logger.warn(`syncSources: skip ${source.id} — no url configured for kind=${source.kind}`);
        return 0;
      }

      // Cotation : celle configurée sur la source prime ; sinon on la dérive du domaine d'URL
      // (officiel/réputé/agrégateur) plutôt que de retomber sur un C3 uniforme non discriminant.
      const context = { sourceName: source.name, defaultSourceRating: source.sourceRating || deriveSourceRatingFromUrl(source.url, clientProfile.sourceAuthority) };
      let created = 0;
      let degraded = false;
      let kindUpgrade = null; // "web-js" si une source `web` s'est avérée anti-bot/JS (mémorisé après succès)

      if (source.kind === "rss" || source.kind === "newsletter" || source.kind === "portal") {
        // Repli anti-bot pour les FLUX (audit sources 2026-07) : un flux bloqué en 403 (Cloudflare)
        // est retenté UNE fois via le navigateur headless en mode RAW (corps brut du flux, UA réel),
        // qui franchit les 403 simples que le fetch HTTP prend. Les flux restent en kind "rss" (pas
        // d'upgrade web-js : le parsing RSS a besoin du XML brut, pas du DOM rendu).
        let xml;
        try {
          xml = await fetchSource(source.url);
        } catch (fetchErr) {
          const msg = String(fetchErr && fetchErr.message);
          // On ne retente PAS un refus SSRF déterministe (URL interne) — inutile et trompeur.
          if (/URL refusée/.test(msg)) throw fetchErr;
          // Agrégateur RSS fiable (audit final pré-prod 2026-07) : sur news.google.com un 403/429 est un
          // RATE-LIMIT, pas un défi anti-bot JS que Chromium résout. Rendre en headless donnerait la même
          // réponse tout en gaspillant navigations/mémoire (jusqu'à MAX_SOURCES_PER_RUN sources same-host
          // via la surveillance d'entités). On propage donc l'échec sans repli headless.
          if (isAggregatorRssHost(source.url)) throw fetchErr;
          const rendered = await fetchRendered(source.url, { raw: true }); // échec du rendu aussi → remonte au catch global
          // Le rendu doit ramener un flux EXPLOITABLE (racine rss/feed/rdf) ; sinon on conserve l'échec
          // d'origine (pas de faux « ok » sur un flux toujours bloqué / réponse 403 en HTML).
          if (!rendered || !/<(rss|feed|rdf)[\s>]/i.test(rendered)) throw fetchErr;
          xml = rendered;
        }
        // Rééquilibrage du fil : les flux tech/cyber MONDIAUX sont prolifiques et noyaient les
        // signaux locaux — plafond réduit à 2 items/run pour l'axe tech, 5 pour les axes locaux.
        const rssItems = extractRssItems(xml, source.axis === "tech" ? 2 : 5);
        // Classification des items d'une même source en parallèle (chaque appel Vertex est indep.).
        const settled = await Promise.allSettled(
          rssItems.map(async (rssItem) => {
            const rawText = `${rssItem.title}\n${rssItem.description}`.trim();
            if (!rawText) return false;
            // Item déjà ingéré (URL connue) → on saute l'appel Vertex (coût évité, aucune perte : item identique).
            if (rssItem.link && existingIds.has(intelItemId({ url: rssItem.link }))) { skippedKnown += 1; return false; }
            const classified = await classifyRawText(rawText, watchlistEntities, {
              ...context,
              url: rssItem.link || source.url,
              // Date d'événement = pubDate du flux si dispo (m3 audit) → ID stable, pas de doublon quotidien.
              defaultDate: rssItem.pubDate || undefined,
            }, clientProfile);
            if (!classified) return false;
            const { written } = await upsertClassifiedItem(db, classified, dedupeIndex);
            return written;
          })
        );
        created = settled.filter((s) => s.status === "fulfilled" && s.value).length;
      } else if (source.kind === "web" || source.kind === "web-js") {
        // kind "web-js" : portail à défi anti-bot / rendu JavaScript → rendu headless (Chromium).
        // kind "web" : fetch HTTP simple, AVEC repli headless automatique (audit sources 2026-07) : une
        // source `web` bloquée (403 anti-bot / échec réseau) ou renvoyant une coquille JS est retentée
        // UNE fois en rendu Chromium avant d'être marquée en échec/dégradée ; le passage en "web-js" est
        // ensuite MÉMORISÉ (kindUpgrade) pour éviter le double fetch aux runs suivants.
        const cap = source.axis === "tech" ? 2 : 8;
        let usedRender = source.kind === "web-js";
        let html;
        try {
          html = usedRender ? await fetchRendered(source.url) : await fetchSource(source.url);
        } catch (fetchErr) {
          if (source.kind !== "web") throw fetchErr;
          html = await fetchRendered(source.url); // si le rendu échoue aussi, l'erreur remonte au catch global
          usedRender = true;
        }
        // C5 : extraction MULTI-ITEMS — chaque avis/actualité devient un intelItem à ID distinct
        // (lien de l'item, sinon titre+date), au lieu d'UN doc figé sur l'URL du portail.
        let webItems = extractWebItems(html, source.url, cap);
        // Repli JS : page `web` sans items ET coquille (SPA) → on retente en rendu headless avant de conclure.
        if (!webItems.length && source.kind === "web" && !usedRender && isDegradedWebPage(extractWebText(html))) {
          try {
            const renderedHtml = await fetchRendered(source.url);
            const renderedItems = extractWebItems(renderedHtml, source.url, cap);
            const renderedText = extractWebText(renderedHtml);
            if (renderedItems.length || (renderedText && !isDegradedWebPage(renderedText))) {
              html = renderedHtml; webItems = renderedItems; usedRender = true;
            }
          } catch { /* rendu indisponible → on garde la page d'origine (marquée dégradée plus bas) */ }
        }
        if (usedRender && source.kind === "web") kindUpgrade = "web-js";
        if (webItems.length) {
          const settled = await Promise.allSettled(
            webItems.map(async (wi) => {
              const perItemLink = wi.link && wi.link !== source.url ? wi.link : undefined;
              // Item déjà ingéré (URL propre connue) → saut de l'appel Vertex (coût évité, item identique).
              if (perItemLink && existingIds.has(intelItemId({ url: perItemLink }))) { skippedKnown += 1; return false; }
              const classified = await classifyRawText(wi.title, watchlistEntities, {
                ...context,
                // Pas de lien propre → on N'ANCRE PAS sur l'URL du portail (sinon collapse) : ID = titre+date.
                url: perItemLink,
              }, clientProfile);
              if (!classified) return false;
              const { written } = await upsertClassifiedItem(db, classified, dedupeIndex);
              return written;
            })
          );
          created = settled.filter((s) => s.status === "fulfilled" && s.value).length;
        } else {
          // Repli : page sans items structurés → texte global, ancré sur titre+date (pas l'URL).
          const rawText = extractWebText(html);
          degraded = isDegradedWebPage(rawText); // M1 : page coquille (SPA) = source dégradée
          if (rawText && !degraded) {
            const classified = await classifyRawText(rawText, watchlistEntities, { ...context }, clientProfile);
            if (classified) {
              const { written } = await upsertClassifiedItem(db, classified, dedupeIndex);
              if (written) created = 1;
            }
          }
        }
      } else {
        logger.warn(`syncSources: skip ${source.id} — unrecognized kind "${source.kind}"`);
        return 0;
      }

      await sourceDoc.ref.update({
        lastFetch: FieldValue.serverTimestamp(),
        lastStatus: degraded ? "degraded: contenu insuffisant (page probablement JS)" : "ok",
        consecutiveFailures: 0,
        // Mémorise le passage réussi en rendu headless : une source `web` anti-bot/JS devient "web-js"
        // (les runs suivants rendent directement, sans repayer un 403/coquille).
        ...(kindUpgrade ? { kind: kindUpgrade } : {}),
      });
      return created;
    } catch (err) {
      logger.error(`syncSources: source ${source.id} (${source.kind}) failed — ${err.message}`);
      // Santé des sources (pipeline auto-curatif) : après MAX_CONSECUTIVE_FAILURES échecs, la
      // source est auto-désactivée pour ne plus gaspiller de cycles fetch/IA.
      try {
        const failures = (source.consecutiveFailures || 0) + 1;
        const deactivate = failures >= MAX_CONSECUTIVE_FAILURES;
        await sourceDoc.ref.update({
          lastFetch: FieldValue.serverTimestamp(),
          lastStatus: `error: ${String(err.message).slice(0, 200)}`,
          consecutiveFailures: failures,
          ...(deactivate ? { active: false } : {}),
        });
        if (deactivate) {
          logger.warn(`syncSources: source ${source.id} auto-deactivated after ${failures} consecutive failures`);
        }
      } catch (updateErr) {
        logger.error(`syncSources: failed to record failure on source ${source.id} — ${updateErr.message}`);
      }
      throw err; // propagé à allSettled → compté comme échec, sans abattre le run
    }
  };

  // Compteurs LIVE (progression) — incrémentés au fil de l'eau dans un wrapper, écrits par source.
  let doneCount = 0;
  let createdCount = 0;
  const trackedSource = async (doc) => {
    let n = 0;
    try { n = await processSource(doc); return n; }
    finally { doneCount += 1; createdCount += n || 0; void writeSyncStatus({ processed: doneCount, created: createdCount }); }
  };

  // M8 : quoi qu'il arrive après l'acquisition du verrou, une exception ne doit JAMAIS laisser
  // summaries/syncStatus figé à running:true (spinner infini côté front). Le catch libère le
  // verrou en phase "error" puis propage. (Le kill dur au timeout 540 s reste couvert par le TTL
  // du verrou + l'ignorance des runs périmés côté front.)
  try {
  let settled;
  try {
    settled = await runInBatches(sourceDocs, AI_CONCURRENCY, trackedSource);
  } finally {
    // Toujours refermer le navigateur headless (s'il a été lancé) pour libérer la mémoire du run.
    await closeRenderBrowser();
  }
  for (const s of settled) {
    if (s.status === "fulfilled") {
      sourcesProcessed += 1;
      itemsCreated += s.value || 0;
    }
  }

  // Auto-nettoyage des quasi-doublons résiduels (le même événement vu par plusieurs sources) : rendu
  // AUTOMATIQUE à chaque synchro — plus besoin d'action manuelle. Best-effort (n'échoue jamais la synchro).
  let deduped = { clusters: 0, archived: 0 };
  await writeSyncStatus({ phase: "dedup" });
  try {
    deduped = await runDedupeIntelItems(db);
  } catch (e) {
    logger.warn(`syncSources: auto-dédoublonnage ignoré (${e.message})`);
  }

  // PORTE DE QUALITÉ : on évalue les nouveaux signaux (pending) dans la foulée — ils passent en `new`
  // (publiés) ou `rejected`. Best-effort ; fail-open par item (une panne IA publie au lieu de retenir).
  let evaluated = { evaluated: 0, published: 0, rejected: 0 };
  await writeSyncStatus({ phase: "evaluation" });
  try {
    evaluated = await runEvaluateIntelItems(db);
  } catch (e) {
    logger.warn(`syncSources: évaluation ignorée (${e.message})`);
  }
  // Statut final : synchro terminée (le front repasse le bouton en état normal).
  await writeSyncStatus({ running: false, finishedAt: FieldValue.serverTimestamp(), processed: doneCount, created: createdCount, evaluated: evaluated.published, phase: "done" });

  logger.info(`syncSources: done — sourcesProcessed=${sourcesProcessed}/${sourceDocs.length} itemsCreated=${itemsCreated} skippedKnown=${skippedKnown} (classification IA évitée) deduped=${deduped.archived} évalués=${evaluated.evaluated} (pub ${evaluated.published}/rej ${evaluated.rejected})`);
  return { sourcesTotal: sourcesSnap.size, sourcesProcessed, itemsCreated, skippedKnown, deduped: deduped.archived, evaluated: evaluated.published, rejected: evaluated.rejected };
  } catch (err) {
    // Libération du verrou en échec (M8) : le front sort du spinner et le prochain run peut démarrer.
    await writeSyncStatus({ running: false, finishedAt: FieldValue.serverTimestamp(), phase: "error" });
    throw err;
  }
}

/**
 * syncSources — Scheduler (quotidien 06:00 Africa/Abidjan). Thin wrapper around runSyncSources().
 * Roadmap: V7 IA & sync.
 */
// 2 GiB : le rendu headless (kind "web-js") lance Chromium, gourmand en mémoire. Les sources
// web-js sont peu nombreuses (portails anti-bot) mais le navigateur doit tenir dans l'instance.
exports.syncSources = onSchedule({ schedule: "0 6 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "2GiB", cpu: cpuAtLeast(1) }, async () => {
  const db = firestoreDb();
  if (!(await gateScheduledPipeline(db, "sync"))) return; // pause/throttle (config/runtime) — avant tout appel Vertex
  await runSyncSources(db);
});

/**
 * syncSourcesNow — callable (manual on-demand trigger). Same runSyncSources() logic as the
 * schedule, exposed so a run can be tested/forced without waiting for the daily 06:00 slot.
 * Exec-gated, same pattern as classifyAI/generateBriefing/exportPdf.
 * Roadmap: V7 IA & sync (added post-deploy for real-data onboarding).
 */
exports.syncSourcesNow = onCall({ ...HEAVY_CALLABLE_OPTS, memory: "2GiB", cpu: cpuAtLeast(1) }, async (request) => {
  requireExecCaller(request, "lancer une synchronisation de la veille");
  const result = await runSyncSources(firestoreDb());
  return result;
});

/**
 * runDedupeIntelItems — NETTOIE les quasi-doublons déjà présents (le même événement vu par deux
 * sources aux URLs différentes). Regroupe les signaux NON archivés par titre+axe (clusterNearDuplicates)
 * et ARCHIVE les doublons en gardant le meilleur de chaque grappe. Prudence : on ne garde JAMAIS un
 * signal en écartant une revue humaine — dans une grappe, on préfère garder un item déjà revu, et on
 * n'archive QUE les doublons encore « new » (jamais un item actionné/archivé par un humain).
 */
async function runDedupeIntelItems(db) {
  const snap = await db.collection("intelItems").get();
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((x) => (x.status || "new") !== "archived");
  const clusters = clusterNearDuplicates(items);
  // Ordre de préférence pour le « gardé » : revu par un humain d'abord, puis meilleur score, puis le
  // plus ancien (premier vu). Les doublons « new » restants sont archivés (mergés vers le gardé).
  const rank = (x) => (x.status && x.status !== "new" ? 1 : 0);
  // On collecte d'abord les doublons à archiver, puis on ÉCRIT PAR LOTS (≤ 400/commit) au lieu d'un
  // await séquentiel par doublon — sinon, sur un gros portefeuille, le dédoublonnage à chaque synchro
  // allongeait la passe au point de faire expirer l'appel côté client (« deadline-exceeded »).
  const toArchive = [];
  for (const cluster of clusters) {
    const sorted = [...cluster].sort(
      (a, b) => rank(b) - rank(a) ||
        (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0) ||
        String(a.date || "").localeCompare(String(b.date || ""))
    );
    const keep = sorted[0];
    for (const dup of sorted.slice(1)) {
      if ((dup.status || "new") !== "new") continue; // ne jamais toucher une décision humaine
      toArchive.push({ id: dup.id, keepId: keep.id });
    }
  }
  const CHUNK = 400;
  for (let i = 0; i < toArchive.length; i += CHUNK) {
    const batch = db.batch();
    for (const { id, keepId } of toArchive.slice(i, i + CHUNK)) {
      batch.update(db.doc(`intelItems/${id}`), { status: "archived", dedupedInto: keepId, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  const archived = toArchive.length;
  logger.info(`runDedupeIntelItems: ${clusters.length} grappes de doublons, ${archived} signaux archivés`);
  return { clusters: clusters.length, archived };
}

/** dedupeIntelItemsNow — callable exec-gated : nettoie à la demande les quasi-doublons existants. */
exports.dedupeIntelItemsNow = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "dédoublonner les signaux de veille");
  const result = await runDedupeIntelItems(firestoreDb());
  logger.info(`dedupeIntelItemsNow: caller=${request.auth.uid} result=${JSON.stringify(result)}`);
  return result;
});

/** Nombre d'échecs d'évaluation tolérés avant publication en dernier recours (fail-closed borné). */
const MAX_EVAL_ATTEMPTS = 3;
/**
 * handleEvalUnusable — réponse du juge inexploitable/en panne. FAIL-CLOSED BORNÉ (audit 2026-07) :
 * on garde l'item `pending` (non publié → pas de bruit non revu, non perdu → ré-évalué au prochain
 * tick) tant que le nombre de tentatives < MAX_EVAL_ATTEMPTS ; au-delà, publication marquée en dernier
 * recours (jamais masqué indéfiniment, ni boucle de coût IA infinie). Retourne 1 si publié, 0 sinon.
 */
async function handleEvalUnusable(db, it, stamp, reason) {
  const attempts = (Number(it.evalAttempts) || 0) + 1;
  if (attempts < MAX_EVAL_ATTEMPTS) {
    await db.doc(`intelItems/${it.id}`).update({
      status: "pending", evalFailed: true, evalAttempts: attempts,
      evalReason: `${reason} — en attente de ré-évaluation (${attempts}/${MAX_EVAL_ATTEMPTS})`, updatedAt: stamp(),
    });
    return 0;
  }
  await db.doc(`intelItems/${it.id}`).update({
    status: "new", evalScore: 50, evalFailed: true, evalAttempts: attempts,
    evalReason: `${reason} — publié par défaut après ${attempts} tentatives`, updatedAt: stamp(),
  });
  return 1;
}

/**
 * runEvaluateIntelItems — PORTE DE QUALITÉ : passe en revue les signaux EN ATTENTE (`pending`) et, via
 * un jugement LLM de PERTINENCE pour NT, les PUBLIE (`new`, avec evalScore/evalReason) ou les ÉCARTE
 * (`rejected`, corbeille exec restaurable). Réponse inexploitable → FAIL-CLOSED BORNÉ (voir
 * handleEvalUnusable) : maintenu `pending` + ré-évalué, publié en dernier recours après N échecs.
 * Borné à `limit` par passe (coût). Parallélisé (runInBatches, AI_CONCURRENCY).
 */
async function runEvaluateIntelItems(db, { limit = 150 } = {}) {
  const companyContext = await getCompanyContext();
  // Identité/marché du juge dérivés du PROFIL CLIENT (généricisation multi-tenant, audit intégral) —
  // défaut = Neurones. Best-effort : une lecture ratée retombe sur DEFAULT_PROFILE (comportement NT).
  const evalIdentity = (await loadClientProfile(db)).profile;
  const snap = await db.collection("intelItems").where("status", "==", "pending").limit(limit).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!items.length) return { evaluated: 0, published: 0, rejected: 0 };
  // Verrou anti-double-évaluation (audit intégral 2026-07, m6) : l'évaluation en fin de synchro et
  // le cron horaire pouvaient noter les MÊMES items `pending` simultanément (jusqu'à 150×2 appels
  // Vertex). Un seul évaluateur à la fois ; l'autre reprendra les restants au prochain tick.
  const EVAL_LOCK = "summaries/evalStatus";
  if (!(await acquireRunLock(db, EVAL_LOCK))) {
    logger.info("runEvaluateIntelItems: une évaluation est déjà en cours (verrou actif) — passe ignorée");
    return { evaluated: 0, published: 0, rejected: 0, locked: true };
  }
  let published = 0, rejected = 0;
  const stamp = () => FieldValue.serverTimestamp();
  try {
  await runInBatches(items, AI_CONCURRENCY, async (it) => {
    try {
      // Jugement de pertinence : température 0 (verdict reproductible) + modèle d'extraction configurable
      // (GEMINI_MODEL_EXTRACTION, coûts) — non défini → modèle par défaut (inchangé).
      const parsed = parseEvaluateResponse(await generateJson(buildEvaluatePrompt(it, companyContext, evalIdentity), { temperature: 0, model: process.env.GEMINI_MODEL_EXTRACTION }));
      if (parsed && parsed.publier === false) {
        await db.doc(`intelItems/${it.id}`).update({ status: "rejected", evalScore: parsed.pertinence, evalReason: parsed.raison || "écarté par l'évaluateur", evalFailed: false, updatedAt: stamp() });
        rejected += 1;
      } else if (parsed) {
        await db.doc(`intelItems/${it.id}`).update({ status: "new", evalScore: parsed.pertinence, evalReason: parsed.raison || "publié", evalFailed: false, updatedAt: stamp() });
        published += 1;
      } else {
        // Réponse non exploitable (parse null) : FAIL-CLOSED BORNÉ (audit 2026-07 — auparavant fail-open,
        // qui publiait du bruit non revu). On garde l'item `pending` (ni publié, ni perdu) : il sera
        // RÉ-ÉVALUÉ au prochain tick (un hoquet transitoire du juge se résout au retry). Après
        // MAX_EVAL_ATTEMPTS échecs consécutifs, on publie EN DERNIER RECOURS (marqué evalFailed) pour ne
        // pas le masquer indéfiniment ni reboucler sur le coût IA.
        published += await handleEvalUnusable(db, it, stamp, "évaluation indisponible");
      }
    } catch (err) {
      logger.warn(`runEvaluateIntelItems: éval échouée pour ${it.id} — mise en attente (${err.message})`);
      try { published += await handleEvalUnusable(db, it, stamp, "évaluation échouée"); } catch (_e) { /* ignore */ }
    }
  });
  logger.info(`runEvaluateIntelItems: ${items.length} évalués — ${published} publiés, ${rejected} écartés`);
  return { evaluated: items.length, published, rejected };
  } finally {
    await releaseRunLock(db, EVAL_LOCK);
  }
}

/** evaluateIntelItemsNow — callable exec-gated : évalue à la demande les signaux en attente. */
exports.evaluateIntelItemsNow = onCall({ ...HEAVY_CALLABLE_OPTS, memory: "1GiB", cpu: cpuAtLeast(0.5) }, async (request) => {
  requireExecCaller(request, "évaluer les signaux de veille");
  const result = await runEvaluateIntelItems(firestoreDb());
  logger.info(`evaluateIntelItemsNow: caller=${request.auth.uid} result=${JSON.stringify(result)}`);
  return result;
});

/**
 * evaluateIntelItemsScheduled — l'agent de PERTINENCE tourne PÉRIODIQUEMENT (toutes les heures) pour
 * rattraper les signaux restés `pending` (ingestion hors-sync, ou passe précédente bornée par `limit`).
 * La synchro quotidienne évalue déjà dans la foulée ; ce cron garantit qu'un signal ne stagne jamais.
 */
exports.evaluateIntelItemsScheduled = onSchedule(
  { schedule: "every 60 minutes", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "1GiB", cpu: cpuAtLeast(0.5) },
  async () => {
    const db = firestoreDb();
    if (!(await gateScheduledPipeline(db, "evaluate"))) return; // pause/throttle — avant tout appel Vertex
    const result = await runEvaluateIntelItems(db);
    logger.info(`evaluateIntelItemsScheduled: ${JSON.stringify(result)}`);
  }
);

/**
 * classifyAI — callable (manual "reclassify this item" admin action)
 * Vertex AI / Gemini : résumé, classification (axe/type/imminence/impact/posture),
 * entity resolution, so-what + action, signaux faibles.
 *
 * Auth-gated to exec roles (direction/strategie/innovation), same pattern as `setUserRole`'s
 * caller check (BUILD_KIT.md §7 "cadres/scénarios/décisions/OKR → exécutifs" — reclassification
 * is an admin action in the same family). Calls the SAME `classify.js`/`vertex.js` helpers
 * `syncSources` uses directly — no HTTP round-trip to itself.
 *
 * data: { itemId: string } — re-runs classification on an existing `intelItems/{itemId}` doc's
 * own title+summary, and merges the refreshed classification fields back in. `status` is always
 * reset to `'new'` (parseClassificationResponse's hard default) since a fresh AI classification
 * is, by definition, unreviewed output again — the reclassify action is itself a deliberate
 * exec-triggered request for new AI review, not a mass background overwrite.
 * Roadmap: V7 IA & sync.
 */
exports.classifyAI = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "reclassifier un signal");

  const { itemId } = request.data || {};
  if (typeof itemId !== "string" || !itemId) {
    throw new HttpsError("invalid-argument", "itemId (string) est requis.");
  }

  const db = firestoreDb();
  const ref = db.doc(`intelItems/${itemId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", `intelItems/${itemId} introuvable.`);
  }
  const existing = snap.data();

  const watchlistSnap = await db.collection("intelWatchlist").where("active", "==", true).get();
  const watchlistEntities = watchlistSnap.docs.map((d) => ({ name: d.data().name, type: d.data().type }));

  const clientProfile = await loadClientProfile(db);
  const rawText = `${existing.title || ""}\n${existing.summary || ""}`.trim();
  const classified = await classifyRawText(rawText, watchlistEntities, {
    sourceName: existing.sourceName,
    url: existing.url,
    defaultDate: existing.date,
    defaultSourceRating: existing.sourceRating || deriveSourceRatingFromUrl(existing.url, clientProfile.sourceAuthority),
  }, clientProfile);
  if (!classified) {
    throw new HttpsError("internal", "La réponse IA n'a pas pu être exploitée (contenu vide/incomplet).");
  }

  await ref.set(classified, { merge: true });
  logger.info(`classifyAI: reclassified ${itemId} caller=${request.auth.uid}`);
  return { id: itemId, status: classified.status };
});

/**
 * onIntelItemWrite — trigger UNIQUE onWrite intelItems (M9 audit 2026-07).
 * Fusionne les trois anciens triggers (scoreItems + aggregateVeille + aggregateVeilleExecOnWrite)
 * qui rescannaient chacun toute la collection à CHAQUE écriture, et dont l'écriture de score par
 * scoreItems re-déclenchait les deux autres → coût de lecture en O(N²). Nouveau flux :
 *   1) si le score a changé → on l'écrit et on RETURN (cette écriture nous re-déclenche) ;
 *   2) si le score est stable (ou suppression) → on recalcule les agrégats UNE fois.
 * Résultat : une écriture de contenu = une passe de scoring + une passe d'agrégats, pas davantage.
 */
/** Charge l'index de valeur commerciale par client (summaries/copiloteClientValue) — {} si absent. */
async function loadClientValueIndex(db) {
  try {
    const snap = await db.doc("summaries/copiloteClientValue").get();
    const idx = snap.exists ? snap.data().index : null;
    return idx && typeof idx === "object" ? idx : {};
  } catch {
    return {};
  }
}

/**
 * Valeur-compte d'un signal (accountValueFactor) : on rattache par `item.ent` MAIS AUSSI par
 * `businessAngle.buyer` — souvent le seul compte concret cité (« BCEAO », « Trésor public ») quand
 * l'entité watchlist (`item.ent`) est absente. On prend le meilleur des deux (audit pertinence 2026-07).
 */
function resolveItemAccountValue(item, clientValue) {
  const byEnt = nt360ResolveAccountValue(item.ent, clientValue);
  const buyer = item && item.businessAngle && item.businessAngle.buyer;
  const byBuyer = buyer ? nt360ResolveAccountValue(buyer, clientValue) : 0;
  return Math.max(byEnt, byBuyer);
}

exports.onIntelItemWrite = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1", database: FIRESTORE_DATABASE_ID }, async (event) => {
  const db = firestoreDb();
  const after = event.data && event.data.after;

  if (after && after.exists) {
    const item = after.data();
    // accountValueFactor : un signal concernant un gros compte client remonte (boucle interne → veille).
    const [clientValue, profile] = await Promise.all([loadClientValueIndex(db), loadClientProfile(db)]);
    const accountValue = resolveItemAccountValue(item, clientValue);
    const computed = computePriorityScore(item, Date.now(), { accountValue, scoring: scoringConfig(profile) });
    if (item.priorityScore !== computed) {
      // Le score a bougé : on l'écrit et on sort. La mise à jour re-déclenche ce trigger, et c'est
      // à cette passe-là (score stabilisé) que les agrégats seront recalculés — évite de les
      // recalculer sur un état intermédiaire.
      await after.ref.update({ priorityScore: computed });
      logger.info(`onIntelItemWrite: ${after.ref.path} priorityScore=${computed}`);
      // Webhook sortant : un signal FRANCHIT le seuil « fort score » vers le haut → notifier une
      // seule fois (crossing), et seulement s'il est publié (pas pending/rejected/archived).
      const prevScore = typeof item.priorityScore === "number" ? item.priorityScore : 0;
      if (
        computed >= WEBHOOK_SIGNAL_MIN_SCORE &&
        prevScore < WEBHOOK_SIGNAL_MIN_SCORE &&
        PUBLISHED_STATUSES.has(item.status)
      ) {
        await dispatchWebhookEvent(db, "intel.signal", {
          id: after.ref.id,
          title: item.title || null,
          score: computed,
          axis: item.axis || null,
          impact: item.impact || null,
          stance: item.stance || null,
          url: item.url || null,
          summary: item.summary || null,
        });
      }
      return;
    }
  }

  // Coalescing par CHAMP AGRÉGÉ (audit coûts 2026-07) : les deux agrégats ne dépendent que de
  // axis/impact/stance/status/priorityScore. Une écriture qui ne touche AUCUN de ces champs (rescore
  // no-op, evalReason/updatedAt, businessAngle…) ne change pas les agrégats → on saute les 2 lectures
  // full-collection. Création/suppression → toujours recalculer. Le cron horaire aggregateVeilleExec
  // reste le filet. Réduit l'amplification O(writes × taille-collection) sans jamais servir un agrégat
  // périmé sur un changement qui compte.
  const before = event.data && event.data.before;
  const b = before && before.exists ? before.data() : null;
  const a = after && after.exists ? after.data() : null;
  const AGG_FIELDS = ["axis", "impact", "stance", "status", "priorityScore"];
  const isCreateOrDelete = (!b && !!a) || (!!b && !a);
  const aggChanged = isCreateOrDelete || AGG_FIELDS.some((f) => (b ? b[f] : undefined) !== (a ? a[f] : undefined));
  if (!aggChanged) {
    return; // rien d'agrégé n'a bougé → pas de recalcul (coût évité)
  }

  // Champ agrégé modifié (ou création/suppression) → recalcul des deux agrégats, chacun une seule fois.
  try {
    const [veille, veilleExec] = await Promise.all([
      computeVeilleSummary(db),
      computeVeilleExecSummary(db),
    ]);
    await Promise.all([
      db.doc("summaries/veille").set(veille),
      db.doc("summaries/veille_exec").set(veilleExec),
    ]);
  } catch (err) {
    logger.error(`onIntelItemWrite: agrégats FAILED pour ${event.document} — ${err.message}`, { err });
    throw err;
  }

  // Webhook sortant : un signal est CRÉÉ directement à fort score (son score n'a pas eu à être
  // recalculé par la passe précédente, donc la branche « crossing » ne s'est pas déclenchée). On
  // notifie ici, uniquement pour une vraie création (!before) et un item publié.
  if (!b && a && typeof a.priorityScore === "number" && a.priorityScore >= WEBHOOK_SIGNAL_MIN_SCORE && PUBLISHED_STATUSES.has(a.status)) {
    await dispatchWebhookEvent(db, "intel.signal", {
      id: after.ref.id,
      title: a.title || null,
      score: a.priorityScore,
      axis: a.axis || null,
      impact: a.impact || null,
      stance: a.stance || null,
      url: a.url || null,
      summary: a.summary || null,
    });
  }
});

/**
 * rescoreDaily — Scheduler (quotidien 04:30, avant la sync de 06:00).
 * CORRIGE C6 (audit 2026-07) : `priorityScore` n'était (re)calculé qu'à l'écriture d'un document,
 * alors que la proximité dépend du temps réel (échéance d'un AO). Un appel d'offres à J-60 restait
 * figé « non-urgent » et ne remontait jamais quand il approchait de J-3. Ce job relit les signaux
 * NON archivés et réécrit le score quand il a bougé (la même garde no-op que scoreItems évite les
 * écritures inutiles). Seuls les scores dont la valeur change déclenchent une réécriture.
 */
async function runRescoreActive(db) {
  const [snap, clientValue, profile] = await Promise.all([
    db.collection("intelItems").get(),
    loadClientValueIndex(db),
    loadClientProfile(db),
  ]);
  const scoring = scoringConfig(profile);
  // Filtre en mémoire (collection de petite taille) : un `!=` Firestore exclurait les docs sans
  // champ `status`. On re-score tout ce qui n'est pas archivé.
  const active = snap.docs.filter((d) => (d.data().status || "new") !== "archived");
  const updates = active.map(async (doc) => {
    const item = doc.data();
    const accountValue = resolveItemAccountValue(item, clientValue);
    const computed = computePriorityScore(item, Date.now(), { accountValue, scoring });
    if (item.priorityScore === computed) return false;
    await doc.ref.update({ priorityScore: computed });
    return true;
  });
  const settled = await Promise.allSettled(updates);
  const rescored = settled.filter((s) => s.status === "fulfilled" && s.value).length;
  logger.info(`rescoreDaily: done — ${rescored}/${active.length} signaux re-scorés (échéances rafraîchies)`);
  return { total: active.length, rescored };
}

exports.rescoreDaily = onSchedule(
  { schedule: "30 4 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    await runRescoreActive(firestoreDb());
  }
);

/**
 * aiHealthCheck — canari de santé Vertex AI (audit doubler-CA, robustesse).
 * Toute la chaîne IA (Copilote, briefings, battlecards, enrichissement) peut tourner À VIDE si le
 * modèle Vertex renvoie un 404 « Publisher model not found » (déjà arrivé en prod, non signalé) :
 * les vues s'affichent alors vides et sont prises pour « rien à dire ». Ce canari appelle generateJson
 * sur un prompt trivial chaque matin (avant les syncs) et écrit summaries/aiHealth {ok, model,
 * lastError, ts}. Le Radar Exécutif affiche un bandeau ERROR si ok=false → panne visible, pas silencieuse.
 */
async function runAiHealthCheck(db) {
  const health = { model: DEFAULT_MODEL, checkedAt: FieldValue.serverTimestamp() };
  try {
    const res = await generateJson('Réponds STRICTEMENT avec {"ok":true}. Aucun autre texte.');
    health.ok = !!(res && (res.ok === true || res.ok === "true"));
    health.lastError = health.ok ? null : `réponse inattendue : ${JSON.stringify(res).slice(0, 200)}`;
  } catch (e) {
    health.ok = false;
    health.lastError = String((e && e.message) || e).slice(0, 300);
  }
  await db.doc("summaries/aiHealth").set(health, { merge: true });
  if (!health.ok) logger.error("aiHealthCheck: Vertex AI KO", { model: health.model, error: health.lastError });
  return health;
}

exports.aiHealthCheck = onSchedule(
  { schedule: "15 6 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 120, memory: "256MiB" },
  async () => {
    await runAiHealthCheck(firestoreDb());
  }
);

/**
 * Recomputes summaries/veille (BUILD_KIT.md §6) from the full `intelItems` collection.
 * Shared so it can be unit-tested / reused without duplicating query logic per trigger.
 */
async function computeVeilleSummary(db) {
  const snap = await db.collection("intelItems").get();
  // Les signaux archivés (doublons dédoublonnés, items clos par un humain) ne comptent PAS dans les
  // agrégats « actifs » (axes/impacts/entités) — cohérent avec le fil et le radar.
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((it) => PUBLISHED_STATUSES.has(it.status || "new"));

  const countsByAxis = {};
  const countsByImpact = {};
  const countsByGeo = {};
  const entityCounts = {};
  let tendersOpen = 0;
  const nowMs = Date.now();
  // AO réellement candidatable = subtype tender, non archivé, NON périmé (échéance future, pas stale) —
  // aligne le comptage sur freshness.ts#isPastDue côté client (audit anti-obsolescence 2026-07).
  const tenderStillOpen = (it) =>
    it.subtype === TENDER_SUBTYPE &&
    it.status !== "archived" &&
    !it.stale &&
    !(it.dueDate && !Number.isNaN(Date.parse(it.dueDate)) && Date.parse(it.dueDate) < nowMs);

  for (const it of items) {
    if (it.axis) countsByAxis[it.axis] = (countsByAxis[it.axis] || 0) + 1;
    if (it.impact) countsByImpact[it.impact] = (countsByImpact[it.impact] || 0) + 1;
    if (it.geo) countsByGeo[it.geo] = (countsByGeo[it.geo] || 0) + 1;
    if (it.ent) entityCounts[it.ent] = (entityCounts[it.ent] || 0) + 1;
    if (tenderStillOpen(it)) tendersOpen += 1;
  }

  const lightweight = (i) => ({ id: i.id, title: i.title, score: i.priorityScore ?? 0 });
  const byScoreDesc = [...items].sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const topThreats = byScoreDesc.filter((i) => i.stance === "threat").slice(0, 5).map(lightweight);
  const topOpportunities = byScoreDesc.filter((i) => i.stance === "opportunity").slice(0, 5).map(lightweight);

  const byDateDesc = [...items].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const recentItems = byDateDesc.slice(0, 10).map((i) => ({ id: i.id, title: i.title, date: i.date, axis: i.axis, impact: i.impact }));

  const entitiesMostActive = Object.entries(entityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ent, count]) => ({ ent, count }));

  return {
    countsByAxis,
    countsByImpact,
    countsByGeo,
    topThreats,
    topOpportunities,
    recentItems,
    tendersOpen,
    entitiesMostActive,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Recomputes summaries/veille_exec (BUILD_KIT.md §6 / DELTA_01B §13). Shared by the scheduled
 * trigger and the intelItems onWrite trigger below.
 *
 * Several fields depend on collections/features that don't exist yet (documented per-field):
 * decisions/winLoss/initiatives/summaries.quanti are later roadmap phases (V4/V6).
 */
async function computeVeilleExecSummary(db) {
  const [snap, watchlistSnap, quantiSnap, winLossSnap, initiativesSnap, decisionsSnap] = await Promise.all([
    db.collection("intelItems").get(),
    db.collection("intelWatchlist").get(),
    db.doc("summaries/quanti").get(),
    db.collection("winLoss").get(),
    db.collection("initiatives").get(),
    db.collection("decisions").get(),
  ]);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((it) => PUBLISHED_STATUSES.has(it.status || "new"));
  const quanti = quantiSnap.exists ? quantiSnap.data() : null;

  // Win rate par concurrent depuis winLoss (réel — C3 audit 2026-07). Même logique que
  // web/lib/execution.ts winRateByCompetitor pour cohérence front/back.
  const wlByComp = {};
  for (const d of winLossSnap.docs) {
    const e = d.data();
    if (!e || typeof e.competitor !== "string" || !e.competitor.trim()) continue;
    const b = (wlByComp[e.competitor] ??= { wins: 0, total: 0, amountWon: 0, amountLost: 0 });
    b.total += 1;
    if (e.result === "win") { b.wins += 1; if (Number.isFinite(e.amount)) b.amountWon += Number(e.amount); }
    else if (e.result === "loss" && Number.isFinite(e.amount)) b.amountLost += Number(e.amount);
  }
  const winRateByCompetitor = {};
  let winsTotal = 0;
  let dealsTotal = 0;
  for (const [c, b] of Object.entries(wlByComp)) {
    winRateByCompetitor[c] = { win: b.total ? b.wins / b.total : 0, deals: b.total, amountWon: b.amountWon, amountLost: b.amountLost };
    winsTotal += b.wins;
    dealsTotal += b.total;
  }
  const winRateGlobal = dealsTotal ? winsTotal / dealsTotal : null;

  // Avancement OKR depuis initiatives (réel — C3). Moyenne pondérée des progress, hors abandonnées.
  const initiatives = initiativesSnap.docs.map((d) => d.data()).filter((i) => i && i.status !== "abandoned");
  const okrProgress = initiatives.length
    ? Math.round((initiatives.reduce((s, i) => s + (Number.isFinite(i.progress) ? Number(i.progress) : 0), 0) / initiatives.length) * 100) / 100
    : null;

  // Décisions en attente (réel — C3). Décisions sans résolution (statut proposé/à trancher).
  const decisionsPending = decisionsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.status === "proposed" || d.status === "pending" || d.status === "open" || !d.status)
    .slice(0, 8)
    .map((d) => ({ id: d.id, title: d.title || d.decision || "—", owner: d.decidedBy || d.owner || "—" }));

  // Pipeline influencé par la veille (wired 2026-07-02, once the internal pipeline landed via
  // nt360): value-at-stake carried by clients the veille tracks (watchlist) or has produced
  // signals about (intelItems.ent). Pure matching logic in domain/quanti.js.
  const entities = [
    ...watchlistSnap.docs.map((d) => d.data().name),
    ...items.map((i) => i.ent),
  ].filter(Boolean);
  const pipelineInfluenced = computePipelineInfluenced({
    valueAtStake: quanti ? quanti.valueAtStake : null,
    entities,
  });

  // Périmètre : `items` est déjà filtré sur les statuts PUBLIÉS (ligne ~1199) — donc `archived` en
  // est absent. « Traitée » = `actioned` uniquement (audit pertinence 2026-07). On ne compte PAS
  // `archived` comme traité : l'archivage sert surtout au dédoublonnage automatique et gonflerait
  // artificiellement la couverture (l'ancienne branche `archived` était de toute façon morte
  // puisque ces items sont exclus en amont).
  const menacesTotal = items.filter((i) => i.stance === "threat").length;
  const menacesTraitees = items.filter((i) => i.stance === "threat" && i.status === "actioned").length;
  const opportunites = items.filter((i) => i.stance === "opportunity").length;
  // Nombre de menaces high-impact encore non traitées (compte, pas un montant — voir renommage
  // ci-dessous). Standing-in d'une future valorisation FCFA (summaries/quanti V4).
  const threatsHighUnactionedCount = items.filter(
    (i) => i.stance === "threat" && i.impact === "high" && i.status !== "actioned"
  ).length;

  return {
    boardKpis: {
      menacesTotal,
      menacesTraitees,
      opportunites,
      winRateGlobal, // taux de victoire global (winLoss) — null si aucun deal enregistré
    },
    decisionsPending, // décisions non tranchées (collection decisions)
    porter: quanti ? quanti.porterForces ?? null : null, // from summaries/quanti (nt360 sync)
    winRateByCompetitor, // taux de victoire par concurrent (winLoss)
    pipelineInfluenced, // veille-tracked clients' value-at-stake — see computation above
    threatsHighUnactionedCount, // compte de menaces high non traitées (renommé — ex-« threatsExposure »)
    okrProgress, // avancement moyen des initiatives (0-1) — null si aucune initiative
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * snapshotVeilleKpis — HISTORIQUE des KPIs (levier « waouh » n°1 : tendances). L'app n'avait aucun
 * store d'historique → tout était un instantané, sans « dans quel sens ça bouge ». Ce cron quotidien
 * fige les KPIs exécutifs du jour dans `summaries/kpiHistory.points[]` (tableau plafonné à 90 j) ;
 * le front en dérive les deltas semaine-sur-semaine (flèches ↑/↓). Idempotent : un point du même
 * jour est remplacé (pas de doublon si le cron rejoue). Best-effort : n'échoue jamais bruyamment.
 */
const KPI_HISTORY_CAP = 90;

/** buildTodayKpiPoint(execData, day) → point AUTHENTIQUE (backfilled:false) du jour depuis
 * summaries/veille_exec. PUR (pas d'I/O). Partagé par le cron et le callable de backfill. */
function buildTodayKpiPoint(s, day) {
  const bk = (s && s.boardKpis) || {};
  return {
    date: day,
    pipelineInfluenced: typeof s.pipelineInfluenced === "number" ? s.pipelineInfluenced : null,
    menacesTotal: bk.menacesTotal ?? null,
    menacesTraitees: bk.menacesTraitees ?? null,
    opportunites: bk.opportunites ?? null,
    winRateGlobal: bk.winRateGlobal ?? null,
    okrProgress: typeof s.okrProgress === "number" ? s.okrProgress : null,
    threatsHighUnactioned: s.threatsHighUnactionedCount ?? null,
    backfilled: false,
  };
}

/** writeTodayKpiSnapshot(db) → fige le point du jour dans summaries/kpiHistory (idempotent : un
 * point du même jour est remplacé). Renvoie le point écrit, ou null si veille_exec est absent.
 * Partagé par snapshotVeilleKpis (cron) et backfillKpiHistory (callable). */
async function writeTodayKpiSnapshot(db) {
  const execSnap = await db.doc("summaries/veille_exec").get();
  if (!execSnap.exists) return null;
  const day = new Date().toISOString().slice(0, 10);
  const point = buildTodayKpiPoint(execSnap.data() || {}, day);
  const ref = db.doc("summaries/kpiHistory");
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const points = (cur.exists && Array.isArray(cur.data().points) ? cur.data().points : []).filter((p) => p && p.date !== day);
    points.push(point);
    points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    tx.set(ref, { points: points.slice(-KPI_HISTORY_CAP), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return point;
}

exports.snapshotVeilleKpis = onSchedule(
  { schedule: "7 1 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1" },
  async () => {
    try {
      const db = firestoreDb();
      const point = await writeTodayKpiSnapshot(db);
      if (!point) { logger.info("snapshotVeilleKpis: summaries/veille_exec absent — rien à figer"); return; }
      logger.info(`snapshotVeilleKpis: point ${point.date} figé (pipeline=${point.pipelineInfluenced}).`);
    } catch (err) {
      logger.error(`snapshotVeilleKpis: FAILED — ${err.message}`, { err });
    }
  }
);

/** toMillis(v) → ms epoch depuis un champ Firestore Timestamp | Date | number, sinon null. */
function toMillis(v) {
  if (v == null) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v._seconds === "number") return v._seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/**
 * backfillKpiHistory — SEED de l'historique KPI (levier « waouh » n°1). Exec-only, sur demande.
 * Reconstruit HONNÊTEMENT les métriques dérivables de la donnée immuable `intelItems.createdAt`
 * (cumul menaces/opportunités par jour, marqué backfilled:true) sur `days` jours, SANS jamais
 * écraser un vrai snapshot déjà figé, puis capture le point authentique du jour. Idempotent :
 * rejouable sans doublon (un point reconstruit remplace un précédent reconstruit ; un vrai snapshot
 * est préservé). Les métriques à état mutable (traitées, high non traitées, win-rate, OKR, pipeline)
 * restent null sur les points reconstruits — ne PAS inventer d'historique.
 */
exports.backfillKpiHistory = onCall(CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "reconstruire l'historique des KPIs");
  const db = firestoreDb();
  const days = Math.min(Math.max(Number(request.data?.days) || DEFAULT_BACKFILL_DAYS, 1), KPI_HISTORY_CAP);

  const snap = await db.collection("intelItems").get();
  const items = snap.docs.map((d) => {
    const it = d.data() || {};
    return {
      createdMs: toMillis(it.createdAt),
      stance: it.stance,
      published: PUBLISHED_STATUSES.has(it.status || "new"),
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const backfill = computeKpiBackfillPoints({ items, days: dayRangeUTC(today, days) });

  const ref = db.doc("summaries/kpiHistory");
  const result = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const existing = cur.exists && Array.isArray(cur.data().points) ? cur.data().points : [];
    // Fusion honnête (jamais d'écrasement d'un vrai snapshot), puis point authentique du jour.
    let merged = mergeHistoryPoints(existing, backfill, KPI_HISTORY_CAP);
    const execSnap = await tx.get(db.doc("summaries/veille_exec"));
    let todayPoint = null;
    if (execSnap.exists) {
      todayPoint = buildTodayKpiPoint(execSnap.data() || {}, today);
      merged = mergeHistoryPoints(merged.filter((p) => p.date !== today), [todayPoint], KPI_HISTORY_CAP);
    }
    tx.set(ref, { points: merged, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { total: merged.length, reconstructed: backfill.length, todaySnapshot: !!todayPoint };
  });

  logger.info(`backfillKpiHistory: ${result.reconstructed} points reconstruits, historique = ${result.total} points.`);
  return { ok: true, ...result };
});

/**
 * aggregateVeilleExec — planifié (toutes les 60 min)
 * Construit summaries/veille_exec (boardKpis, decisionsPending, porter, winRateByCompetitor, ...).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeilleExec = onSchedule({ schedule: "every 60 minutes", timeZone: TENANT_TIMEZONE, region: "europe-west1" }, async () => {
  const db = firestoreDb();
  // Court-circuit pause/throttle : l'agrégat exec est aussi recalculé par onIntelItemWrite à chaque
  // écriture, donc l'espacer (voire le suspendre) ne dégrade pas la fraîcheur du cockpit.
  if (!(await gateScheduledPipeline(db, "aggregate"))) return;
  try {
    const summary = await computeVeilleExecSummary(db);
    await db.doc("summaries/veille_exec").set(summary);
  } catch (err) {
    logger.error(`aggregateVeilleExec: FAILED — ${err.message}`, { err });
    // Scheduled job: don't rethrow — a transient failure shouldn't mark the whole scheduler
    // invocation as an alert-worthy crash beyond the logged error; the hourly/onWrite companion
    // trigger will retry on the next tick/write anyway.
  }
});

/**
 * generateBriefing — callable (BUILD_KIT.md §11: "Briefing | briefings, summaries/* |
 * exécutifs (generate)"), exec-gated same as classifyAI.
 * IA : idée directrice + 3 arguments MECE + KPIs → briefings (revue humaine obligatoire).
 *
 * Reads `summaries/veille` + `summaries/veille_exec` (boardKpis, top threats/opportunities) plus
 * the top 10 highest-`priorityScore` `intelItems`, builds a Minto-pyramid prompt
 * (`briefing.js#buildBriefingPrompt`), calls Vertex AI, and parses the response
 * (`briefing.js#parseBriefingResponse`) into a new `briefings/{id}` doc. `status` always starts
 * `'draft'` / `reviewedBy: null` (hard-enforced inside `parseBriefingResponse` — human review
 * gate, BUILD_KIT.md §1).
 * Roadmap: V7 IA & sync.
 */
async function runGenerateBriefing(db, generatedBy) {
  const [veilleSnap, veilleExecSnap, topItemsSnap] = await Promise.all([
    db.doc("summaries/veille").get(),
    db.doc("summaries/veille_exec").get(),
    // On récupère un surplus (40) puis on filtre sur les statuts PUBLIÉS avant de garder le top-10 :
    // Firestore ne combine pas trivialement orderBy + where("in"), et le briefing ne doit JAMAIS
    // fonder ses recommandations sur des signaux `pending`/`rejected`/`archived` alors que ses
    // propres KPI (computeVeilleExecSummary) ne comptent que les publiés — sinon corps et chiffres
    // du même livrable se contredisent (audit pertinence 2026-07).
    db.collection("intelItems").orderBy("priorityScore", "desc").limit(40).get(),
  ]);

  const veilleSummary = veilleSnap.exists ? veilleSnap.data() : null;
  const veilleExecSummary = veilleExecSnap.exists ? veilleExecSnap.data() : null;
  const topItems = topItemsSnap.docs
    .map((d) => d.data())
    .filter((it) => PUBLISHED_STATUSES.has(it.status || "new"))
    .slice(0, 10)
    // ent/date rendus par briefing.js#itemsBlock (Action 4.3) — recommandations nominatives.
    .map((it) => ({ title: it.title, axis: it.axis, impact: it.impact, stance: it.stance, soWhat: it.soWhat, priorityScore: it.priorityScore, ent: it.ent, date: it.date }));

  const now = new Date();
  const period = `semaine du ${now.toISOString().slice(0, 10)}`;

  const companyContext = await getCompanyContext();
  const briefingInput = { veilleSummary, veilleExecSummary, topItems, period, companyContext };
  const prompt = buildBriefingPrompt(briefingInput);
  const response = await generateJson(prompt);
  const parseCtx = {
    period,
    generatedBy,
    // Nombre de signaux numérotés [1..N] fournis au prompt → borne de vérification des citations.
    citationsMax: topItems.length,
  };
  let briefing = parseBriefingResponse(response, parseCtx);
  if (!briefing) return null;

  // Self-critique OPTIONNELLE (fiabilité, flag OFF par défaut) : 2ᵉ passe qui corrige les affirmations
  // non étayées / chiffres incohérents avant publication. À activer via BRIEFING_SELF_CRITIQUE=true APRÈS
  // validation live (double le coût token sur cette sortie à fort enjeu). Toute défaillance = on garde
  // le brouillon (jamais de régression : la self-critique ne peut qu'améliorer ou être ignorée).
  if (process.env.BRIEFING_SELF_CRITIQUE === "true") {
    try {
      const refinedRaw = await generateJson(buildBriefingCritiquePrompt(briefingInput, briefing));
      const refined = parseBriefingResponse(refinedRaw, parseCtx);
      if (refined) {
        briefing = refined;
        logger.info("runGenerateBriefing: self-critique appliquée (2e passe)");
      }
    } catch (err) {
      logger.warn(`runGenerateBriefing: self-critique ignorée (${err.message}) — brouillon conservé`);
    }
  }

  const ref = await db.collection("briefings").add({ ...briefing, createdAt: FieldValue.serverTimestamp() });
  logger.info(`runGenerateBriefing: created briefings/${ref.id} generatedBy=${generatedBy}`);
  // Webhook sortant : nouveau briefing produit → notifier les apps tierces abonnées.
  await dispatchWebhookEvent(db, "briefing.created", {
    id: ref.id,
    title: briefing.title || null,
    period: briefing.period || briefing.cadence || null,
    status: briefing.status || null,
    summary: briefing.summary || briefing.tldr || null,
    generatedBy,
  });
  return { id: ref.id, status: briefing.status };
}

exports.generateBriefing = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "générer un briefing");
  const result = await runGenerateBriefing(firestoreDb(), `vertex-ai:${request.auth.uid}`);
  if (!result) {
    throw new HttpsError("internal", "La réponse IA n'a pas pu être exploitée (contenu vide/incomplet).");
  }
  return result;
});

/**
 * generateBriefingWeekly — Scheduler (hebdomadaire, vendredi 07:00 Africa/Abidjan) : le briefing
 * exécutif se génère tout seul en fin de semaine ("encore des vues vides", 2026-07-02 — la vue
 * Briefing restait vide tant que personne ne cliquait). Toujours créé en `status:'draft'` — la
 * revue humaine reste obligatoire avant toute diffusion (garde dans parseBriefingResponse).
 */
exports.generateBriefingWeekly = onSchedule(
  { schedule: "0 7 * * 5", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const db = firestoreDb();
    if (!(await gateScheduledPipeline(db, "briefing"))) return; // pause/throttle — avant tout appel Vertex
    const result = await runGenerateBriefing(db, "vertex-ai:scheduled");
    if (!result) {
      logger.error("generateBriefingWeekly: réponse IA inexploitable — aucun briefing créé cette semaine");
    }
  }
);

/**
 * sendDailyDigest — CANAL SORTANT (audit valeur CXO 2026-07). Le systeme etait 100% "pull" : un
 * signal critique attendait la connexion du DG. Chaque matin (07:00 tenant), on pousse un digest des
 * TOP signaux prioritaires NOUVEAUX depuis le dernier envoi + une alerte si un briefing hebdo attend
 * une revue. On ne pousse JAMAIS le contenu d'un briefing (draft sous garde humaine), seulement le
 * lien pour le revoir. Transport = WEBHOOK JSON (env DIGEST_WEBHOOK_URL) : aucune cle SMTP ni compte
 * tiers a livrer, l'operateur branche le relais de son choix (email, Make, Slack...). Sans webhook
 * configure, la fonction NE consomme PAS les signaux (curseur non avance) : rien n'est perdu, tout
 * partira des que le canal sera branche. Etat dans summaries/digestStatus. Best-effort, jamais bloquant.
 */
exports.sendDailyDigest = onSchedule(
  { schedule: "0 7 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 300, memory: "512MiB" },
  async () => {
    const db = firestoreDb();
    const webhook = process.env.DIGEST_WEBHOOK_URL;
    const statusRef = db.doc("summaries/digestStatus");
    const nowMs = Date.now();
    // Curseur : ne pousser que les signaux NOUVEAUX depuis le dernier envoi (anti-renvoi).
    let sinceMs = 0;
    try {
      const st = await statusRef.get();
      if (st.exists) {
        const v = st.data() || {};
        sinceMs = Number.isFinite(v.lastCutoffMs) ? v.lastCutoffMs
          : (v.lastSentAt && typeof v.lastSentAt.toMillis === "function" ? v.lastSentAt.toMillis() : 0);
      }
    } catch (e) {
      logger.warn(`sendDailyDigest: lecture digestStatus echouee (${e.message}) — curseur a 0`);
    }

    const itemsSnap = await db.collection("intelItems").get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const minScore = Number(process.env.DIGEST_MIN_SCORE) || DEFAULT_MIN_SCORE;
    const signals = selectDigestSignals(items, { sinceMs, minScore });

    // Briefing pret a revoir : dernier briefing en draft cree depuis le dernier envoi.
    let briefingReady = false;
    try {
      const bSnap = await db.collection("briefings").orderBy("createdAt", "desc").limit(1).get();
      if (!bSnap.empty) {
        const b = bSnap.docs[0].data() || {};
        const bms = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
        briefingReady = b.status === "draft" && bms > sinceMs;
      }
    } catch (e) {
      logger.warn(`sendDailyDigest: lecture du dernier briefing echouee (${e.message})`);
    }

    const prof = await loadClientProfile(db).catch(() => null);
    const title = (prof && prof.profile && prof.profile.companyName) || "Sentinel";
    const appUrl = process.env.DIGEST_APP_URL || "https://strategic360.web.app";
    const payload = buildDigestPayload({ signals, briefingReady, appUrl, asOfMs: nowMs, title });

    if (!hasDigestContent(payload)) {
      logger.info("sendDailyDigest: rien a pousser (0 signal prioritaire nouveau, aucun briefing a revoir)");
      await statusRef.set({ lastRunAt: FieldValue.serverTimestamp(), lastCutoffMs: nowMs, lastSignalCount: 0 }, { merge: true });
      return;
    }
    if (!webhook) {
      logger.warn(`sendDailyDigest: DIGEST_WEBHOOK_URL non configure — canal sortant INACTIF (${payload.signalCount} signal(aux), briefing=${payload.briefingReady} en attente). Configurez le webhook pour activer la diffusion ; les signaux ne sont pas consommes.`);
      return; // curseur NON avance : rien n'est perdu, tout partira des que le webhook sera branche
    }
    const recipients = String(process.env.DIGEST_RECIPIENTS || "").split(",").map((s) => s.trim()).filter(Boolean);
    // Durcissement du fetch sortant (audit 4 zones 2026-07) : HTTPS obligatoire (le payload porte des
    // e-mails d'execs + titres/soWhat — jamais en clair), garde anti-IP-interne (checkPublicHttpUrl),
    // et TIMEOUT dur de 15 s (sans lui, un webhook muet faisait pendre la fonction jusqu'a 300 s).
    const wcheck = checkPublicHttpUrl(webhook);
    if (!wcheck.ok || wcheck.url.protocol !== "https:") {
      logger.error(`sendDailyDigest: DIGEST_WEBHOOK_URL rejete (${wcheck.ok ? "HTTPS requis" : wcheck.reason}) — envoi annule, curseur non avance`);
      return;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let res;
      try {
        res = await fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, recipients }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
      logger.info(`sendDailyDigest: digest pousse (${payload.signalCount} signal(aux), briefing=${payload.briefingReady}) vers le webhook`);
      await statusRef.set({ lastSentAt: FieldValue.serverTimestamp(), lastCutoffMs: nowMs, lastSignalCount: payload.signalCount, lastBriefingReady: payload.briefingReady }, { merge: true });
    } catch (e) {
      // Curseur NON avance : nouvel essai au prochain run (les signaux ne sont pas perdus).
      logger.error(`sendDailyDigest: envoi webhook echoue (${e.message}) — curseur non avance, re-essai au prochain run`);
    }
  }
);

// ---------------------------------------------------------------------------------------------
// AI enrichment of strategic artifacts (SWOT/PESTEL frameworks, tech radar, battlecard moves)
// — user decision: "100% des données externes issues automatiquement de l'IA". The AI
// generates/refreshes the artifacts from the accumulated real intelItems signals; humans EDIT
// afterwards via the existing forms (they never create from scratch). Pure prompt/parse logic
// lives in domain/enrich.js (unit-tested, no network); only the orchestration below touches
// Vertex AI + Firestore.
// ---------------------------------------------------------------------------------------------
const {
  buildSwotPestelPrompt,
  parseSwotPestelResponse,
  buildTechRadarPrompt,
  parseTechRadarResponse,
  buildBattlecardMovesPrompt,
  parseBattlecardMovesResponse,
  buildOpportunitiesPrompt,
  parseOpportunitiesResponse,
  buildCanvasPrompt,
  parseCanvasResponse,
  buildDiagnosticPrompt,
  parseDiagnosticResponse,
  buildContextRefreshPrompt,
  parseContextRefreshResponse,
  buildGe9Prompt,
  parseGe9Response,
  buildInnovationBetsPrompt,
  parseInnovationBetsResponse,
  buildFullBattlecardsPrompt,
  parseFullBattlecardsResponse,
  buildHorizonsPrompt,
  parseHorizonsResponse,
  buildPorterPrompt,
  parsePorterResponse,
  buildAnsoffPrompt,
  parseAnsoffResponse,
  buildVrioPrompt,
  parseVrioResponse,
  buildValueChainPrompt,
  parseValueChainResponse,
  buildScenariosPrompt,
  parseScenariosResponse,
  pickSignalsForEnrichment,
  sourcesFromSignals,
  diversifySignals,
  slugId: enrichSlugId,
} = require("./domain/enrich");

/**
 * Writes (or refuses to write) one `frameworks/{key}` doc from an AI-generated `content`.
 *
 * HUMAN-CURATION GUARD: if the existing doc's `updatedBy` is a HUMAN (doc exists and `updatedBy`
 * does NOT start with "ai:"), the AI must NEVER clobber it — we skip and log. A human who has
 * hand-edited a framework keeps ownership until they explicitly hand it back (a UI toggle to
 * re-enable AI regeneration per framework is planned; until then the human can clear/delete the
 * doc to let the AI take over again).
 */
async function writeFrameworkDoc(db, key, content, sources) {
  const ref = db.doc(`frameworks/${key}`);
  const existing = await ref.get();
  const existingUpdatedBy = existing.exists ? existing.data()?.updatedBy : null;
  if (existing.exists && !(typeof existingUpdatedBy === "string" && existingUpdatedBy.startsWith("ai:"))) {
    logger.info(`runEnrichment: frameworks/${key} is human-curated (updatedBy=${existingUpdatedBy ?? "unknown"}) — skipping AI overwrite`);
    return "skipped-human";
  }
  await ref.set({
    key,
    content,
    // sources : table de correspondance des citations [n] → signal (levier « waouh » n°3). Persistée
    // seulement si fournie (les cadres non encore câblés gardent le comportement actuel).
    ...(Array.isArray(sources) && sources.length ? { sources } : {}),
    version: existing.exists ? (existing.data()?.version ?? 0) + 1 : 1,
    updatedBy: "ai:enrichStrategicArtifacts",
    updatedAt: FieldValue.serverTimestamp(),
  });
  return "written";
}

/**
 * Shared enrichment pipeline (called by the weekly `enrichStrategicArtifacts` schedule and the
 * exec-gated `enrichNow` callable). Reads all intelItems (fine at current collection scale),
 * distills them via `pickSignalsForEnrichment`, then runs three INDEPENDENT AI generations —
 * SWOT/PESTEL, tech radar, battlecard moves — each in its own try/catch so one failure never
 * kills the others. Returns a summary object (also logged).
 */
/**
 * Ancre la POSITION concurrentielle des segments GE-McKinsey ÉTABLIS sur les CAS internes réels
 * (M2 audit 2026-07). Pour chaque segment dont le nom recoupe une BU de `granularite`, la position
 * IA est fondue (50/50) avec un proxy interne dérivé de la part de CAS (présence établie) et de la
 * croissance (momentum). Les segments émergents (sans CAS) gardent la position estimée par l'IA.
 * Mutation en place ; ajoute `posSource: "interne+ia" | "ia"`.
 * @param {Array<{n:string, pos:number, emerging?:boolean}>} items
 * @param {Array<{seg:string, casN:number, casN1:number, delta:number}>|null} granularite
 */
function anchorGe9PositionsOnInternalCas(items, granularite) {
  if (!Array.isArray(items) || !Array.isArray(granularite) || !granularite.length) return;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  const maxCas = Math.max(...granularite.map((g) => (Number.isFinite(g.casN) ? g.casN : 0)), 1);
  for (const it of items) {
    if (it.emerging) { it.posSource = "ia"; continue; }
    const itTok = tokens(it.n);
    // Match par recouvrement de tokens (ex. "Cybersécurité & SOC" ↔ BU "Cybersécurité").
    let best = null;
    for (const g of granularite) {
      const gt = tokens(g.seg);
      const overlap = [...itTok].filter((t) => gt.has(t)).length;
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { g, overlap };
    }
    if (!best) { it.posSource = "ia"; continue; }
    const g = best.g;
    const share = maxCas > 0 ? Math.max(0, (Number(g.casN) || 0) / maxCas) : 0; // 0..1 vs plus grosse BU
    const growthAdj = (Number(g.delta) || 0) > 0 ? 10 : (Number(g.delta) || 0) < 0 ? -10 : 0;
    // Avoir un CAS réel = position déjà établie : plancher +15 ; part relative pondérée à 70.
    const internalPos = Math.max(0, Math.min(100, Math.round(15 + share * 70 + growthAdj)));
    it.pos = Math.max(0, Math.min(100, Math.round(0.5 * it.pos + 0.5 * internalPos)));
    it.posSource = "interne+ia";
  }
}

async function runEnrichment(db) {
  const itemsSnap = await db.collection("intelItems").get();
  const allItems = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const signals = pickSignalsForEnrichment(allItems);
  // Sous-ensemble FIABLE pour le rafraichissement de la verite-terrain (audit final pre-prod 2026-07,
  // anti-empoisonnement du contexte) : seuls les signaux issus de sources a haute autorite (note
  // d'amiraute A/B — officiel/reputable) peuvent piloter une reecriture du contexte de reference lu
  // par tous les agents aval. Une fausse claim d'une source quelconque (C/D/E/F) ne doit pas s'y ancrer.
  const trustedSignals = pickSignalsForEnrichment(allItems.filter((it) => isHighAuthorityRating(it.sourceRating)));
  // Échantillon ENTRELACÉ PAR AXE (audit pertinence 2026-07) : les cadres qui visent la BREADTH
  // (SWOT/PESTEL, Diagnostic, GE9, Ansoff, Horizons, paris d'innovation, scénarios) doivent voir un
  // input équilibré, pas la seule tête priorité-clusterisée. La diversité est déjà garantie dans la
  // SÉLECTION (pickSignalsForEnrichment stratifie par axe) ; ici on l'expose aussi dans l'ORDRE lu.
  const diverseSignals = diversifySignals(signals, { key: "axis" });

  if (!signals.length) {
    logger.info("runEnrichment: no non-archived intelItems — nothing to enrich, skipping");
    return { skipped: true };
  }

  // Verrou anti-runs-concurrents (audit intégral 2026-07, M2) : enrichNow (manuel) et
  // enrichStrategicArtifacts (cron hebdo) ne doivent pas tourner ensemble — ~18 générations Vertex
  // ×2 sur le projet PARTAGÉ + courses last-writer-wins sur frameworks/*.
  const ENRICH_LOCK = "summaries/enrichStatus";
  if (!(await acquireRunLock(db, ENRICH_LOCK))) {
    logger.warn("runEnrichment: un enrichissement est déjà en cours (verrou actif) — démarrage refusé");
    return { skipped: true, locked: true };
  }
  try {

  // 0. Rafraîchissement du contexte entreprise (dynamique) — AVANT les autres générations pour
  // qu'elles utilisent la version à jour. writeFrameworkDoc applique la garde humaine : un
  // contexte édité par la Direction n'est jamais réécrit par l'IA.
  let companyContext = await getCompanyContext();
  // Identité/sections attendues du contexte dérivées du PROFIL CLIENT (généricisation multi-tenant,
  // audit intégral) — défaut = Neurones. Best-effort (lecture ratée → DEFAULT_PROFILE).
  const enrichProfile = await loadClientProfile(db);
  const refreshIdentity = { ...enrichProfile.profile, contextMarkers: enrichProfile.taxonomy && enrichProfile.taxonomy.contextMarkers };
  try {
    if (!trustedSignals.length) {
      // Aucune source fiable (A/B) dans le cycle : on NE touche PAS a la verite-terrain (anti-empoisonnement).
      logger.info("runEnrichment: aucun signal a haute autorite (A/B) — rafraichissement du contexte ignore");
    } else {
      const parsed = parseContextRefreshResponse(
        await generateJson(buildContextRefreshPrompt(companyContext, trustedSignals, refreshIdentity)),
        companyContext,
        refreshIdentity.contextMarkers
      );
      if (!parsed) {
        logger.warn("runEnrichment: context refresh response rejected by guards — contexte inchangé");
      } else if (parsed.text === companyContext || parsed.changes.length === 0) {
        logger.info("runEnrichment: contexte entreprise inchangé (aucune mise à jour justifiée)");
      } else {
        const status = await writeFrameworkDoc(db, "companyContext", { text: parsed.text, changes: parsed.changes });
        if (status === "written") {
          invalidateCompanyContextCache();
          companyContext = parsed.text;
          logger.info(`runEnrichment: contexte entreprise mis à jour — ${parsed.changes.join(" ; ")}`);
        }
      }
    }
  } catch (err) {
    logger.error(`runEnrichment: context refresh FAILED — ${err.message}`, { err });
  }

  const summary = { swotPestel: "failed", techRadarBlips: 0, battlecardMoves: 0 };

  // 1. SWOT + PESTEL frameworks -----------------------------------------------------------------
  try {
    const parsed = parseSwotPestelResponse(await generateJson(buildSwotPestelPrompt(diverseSignals, companyContext)));
    if (!parsed) {
      summary.swotPestel = "parse-failed";
      logger.error("runEnrichment: SWOT/PESTEL response unusable (parse returned null)");
    } else {
      // SWOT/PESTEL sont générés à partir de `diverseSignals` : on persiste la table de sources
      // correspondante pour rendre les citations [n] cliquables côté front (levier « waouh » n°3).
      const swotPestelSources = sourcesFromSignals(diverseSignals);
      const swotStatus = await writeFrameworkDoc(db, "swot", parsed.swot, swotPestelSources);
      const pestelStatus = await writeFrameworkDoc(db, "pestel", parsed.pestel, swotPestelSources);
      summary.swotPestel = swotStatus === pestelStatus ? swotStatus : `swot=${swotStatus},pestel=${pestelStatus}`;
    }
  } catch (err) {
    logger.error(`runEnrichment: SWOT/PESTEL generation FAILED — ${err.message}`, { err });
  }

  // 2. Tech radar --------------------------------------------------------------------------------
  try {
    const techSignals = signals.filter((s) => s.axis === "tech");
    if (!techSignals.length) {
      logger.info("runEnrichment: no tech-axis signals — tech radar left untouched");
    } else {
      // CONSOLIDATION (« radar illisible », 2026-07) : la réponse REMPLACE l'ensemble des blips
      // générés par l'IA (les noms actuels sont passés au prompt pour fusion/élagage) — sans ça,
      // chaque run accumulait de nouveaux slugs et le radar devenait un nuage illisible de
      // quasi-doublons. Les blips créés par un humain (sans generatedBy:"ai") ne sont JAMAIS
      // supprimés ni renommés.
      const radarSnap = await db.collection("techRadar").get();
      const aiBlipDocs = radarSnap.docs.filter((d) => d.data()?.generatedBy === "ai");
      const parsed = parseTechRadarResponse(
        await generateJson(buildTechRadarPrompt(techSignals, companyContext, aiBlipDocs.map((d) => d.data().name)))
      );
      if (!parsed) {
        logger.error("runEnrichment: tech radar response unusable (parse returned null)");
      } else {
        const keptSlugs = new Set();
        for (const blip of parsed.blips) {
          const slug = enrichSlugId(blip.name);
          keptSlugs.add(slug);
          const ref = db.doc(`techRadar/${slug}`);
          const existing = await ref.get();
          await ref.set(
            {
              ...blip,
              generatedBy: existing.exists && existing.data()?.generatedBy !== "ai" ? existing.data().generatedBy : "ai",
              ...(existing.exists ? {} : { linkedItems: [] }),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        let pruned = 0;
        for (const doc of aiBlipDocs) {
          if (!keptSlugs.has(doc.id)) {
            await doc.ref.delete();
            pruned += 1;
          }
        }
        summary.techRadarBlips = parsed.blips.length;
        if (pruned) logger.info(`runEnrichment: tech radar consolidé — ${pruned} blip(s) IA obsolète(s) supprimé(s)`);
      }
    }
  } catch (err) {
    logger.error(`runEnrichment: tech radar generation FAILED — ${err.message}`, { err });
  }

  // 3. Battlecard recent moves -------------------------------------------------------------------
  try {
    const competitorSignals = signals.filter((s) => s.axis === "concurrents");
    if (!competitorSignals.length) {
      logger.info("runEnrichment: no concurrents-axis signals — battlecards left untouched");
    } else {
      const parsed = parseBattlecardMovesResponse(await generateJson(buildBattlecardMovesPrompt(competitorSignals, companyContext)));
      if (!parsed) {
        logger.error("runEnrichment: battlecard moves response unusable (parse returned null)");
      } else {
        for (const m of parsed.moves) {
          // Only touch `competitor` + append to `recentMoves` (arrayUnion dedupes identical
          // strings across runs) — every other battlecard field is human territory.
          await db.doc(`battlecards/${enrichSlugId(m.competitor)}`).set(
            { competitor: m.competitor, recentMoves: FieldValue.arrayUnion(`${m.date} — ${m.move}`) },
            { merge: true }
          );
        }
        summary.battlecardMoves = parsed.moves.length;
      }
    }
  } catch (err) {
    logger.error(`runEnrichment: battlecard moves generation FAILED — ${err.message}`, { err });
  }

  // 3b. Battlecards complètes — top 20 concurrents de la watchlist (« pas assez riche / top 20 »,
  // 2026-07). Positionnement/forces/faiblesses/axes de victoire générés par l'IA ; une carte éditée
  // par un humain (generatedBy absent ou ≠ "ai") n'est jamais écrasée. recentMoves reste géré par 3.
  // GÉNÉRATION PAR LOTS de 8 : 20 cartes complètes dépasseraient le plafond de 8192 tokens de
  // sortie (JSON tronqué → parse en échec) — on découpe pour fiabiliser.
  try {
    const watchSnap = await db.collection("intelWatchlist").where("type", "==", "Concurrent").get();
    const PRIO = { Haute: 0, Moyenne: 1, Basse: 2 };
    const topCompetitors = watchSnap.docs
      .map((d) => d.data())
      .filter((w) => typeof w?.name === "string" && w.name.trim())
      .sort((a, b) => (PRIO[a.priority] ?? 3) - (PRIO[b.priority] ?? 3))
      .slice(0, 20)
      .map((w) => ({ name: w.name.trim(), note: typeof w.note === "string" ? w.note : "" }));
    if (!topCompetitors.length) {
      logger.info("runEnrichment: watchlist sans concurrents — battlecards complètes ignorées");
    } else {
      const CHUNK = 8;
      let written = 0;
      let anyParsed = false;
      for (let i = 0; i < topCompetitors.length; i += CHUNK) {
        const batch = topCompetitors.slice(i, i + CHUNK);
        // Récupération légère (Vague D) : au lieu de repasser le MÊME top-60 à chaque lot, on classe
        // les signaux par pertinence aux concurrents DE CE LOT (axe concurrents + noms) → chaque
        // battlecard voit d'abord les signaux qui la concernent, moins de fabrication hors-sujet.
        const batchSignals = pickRelevant(signals, { axes: ["concurrents"], terms: batch.map((c) => c.name) }, 30);
        const parsed = parseFullBattlecardsResponse(
          await generateJson(buildFullBattlecardsPrompt(batchSignals, batch, companyContext))
        );
        if (!parsed) {
          logger.error(`runEnrichment: full battlecards lot ${i / CHUNK + 1} inutilisable (parse null)`);
          continue;
        }
        anyParsed = true;
        for (const card of parsed.cards) {
          const ref = db.doc(`battlecards/${enrichSlugId(card.competitor)}`);
          const existing = await ref.get();
          if (existing.exists && existing.data()?.generatedBy && existing.data().generatedBy !== "ai") continue;
          // recentMoves volontairement absent du payload — géré par l'étape 3 (arrayUnion).
          await ref.set(
            {
              competitor: card.competitor,
              positioning: card.positioning,
              strengths: card.strengths,
              weaknesses: card.weaknesses,
              ourWinThemes: card.ourWinThemes,
              theirLikelyMoves: card.theirLikelyMoves,
              objectionHandling: card.objectionHandling,
              generatedBy: "ai",
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          written += 1;
        }
      }
      summary.fullBattlecards = anyParsed ? written : "parse-failed";
    }
  } catch (err) {
    summary.fullBattlecards = "failed";
    logger.error(`runEnrichment: full battlecards generation FAILED — ${err.message}`, { err });
  }

  // 4. Business Model Canvas (frameworks/canvas) — added 2026-07-02 ("encore des vues vides") ----
  try {
    const parsed = parseCanvasResponse(await generateJson(buildCanvasPrompt(signals, companyContext)));
    if (!parsed) {
      summary.canvas = "parse-failed";
      logger.error("runEnrichment: canvas response unusable (parse returned null)");
    } else {
      summary.canvas = await writeFrameworkDoc(db, "canvas", parsed);
    }
  } catch (err) {
    summary.canvas = "failed";
    logger.error(`runEnrichment: canvas generation FAILED — ${err.message}`, { err });
  }

  // 5. Diagnostic (frameworks/diagnostic : arbre MECE + 7S + maturité) ---------------------------
  try {
    const parsed = parseDiagnosticResponse(await generateJson(buildDiagnosticPrompt(diverseSignals, companyContext)));
    if (!parsed) {
      summary.diagnostic = "parse-failed";
      logger.error("runEnrichment: diagnostic response unusable (parse returned null)");
    } else {
      summary.diagnostic = await writeFrameworkDoc(db, "diagnostic", parsed);
    }
  } catch (err) {
    summary.diagnostic = "failed";
    logger.error(`runEnrichment: diagnostic generation FAILED — ${err.message}`, { err });
  }

  // 7. GE-McKinsey (frameworks/ge9) — attractivité marché estimée par l'IA. La POSITION des
  // segments ÉTABLIS est désormais ANCRÉE sur les CAS internes réels (M2 audit 2026-07 : le libellé
  // « position (données internes) » était mensonger, la position venait entièrement de l'IA).
  try {
    const quantiSnap = await db.doc("summaries/quanti").get();
    const granularite = quantiSnap.exists ? quantiSnap.data()?.granularite : null;
    const ge9Currency = enrichProfile.profile && enrichProfile.profile.currency;
    const parsed = parseGe9Response(await generateJson(buildGe9Prompt(diverseSignals, granularite, companyContext, ge9Currency)));
    if (!parsed) {
      summary.ge9 = "parse-failed";
      logger.error("runEnrichment: ge9 response unusable (parse returned null)");
    } else {
      anchorGe9PositionsOnInternalCas(parsed.items, granularite);
      summary.ge9 = await writeFrameworkDoc(db, "ge9", parsed);
    }
  } catch (err) {
    summary.ge9 = "failed";
    logger.error(`runEnrichment: ge9 generation FAILED — ${err.message}`, { err });
  }

  // 7b. Porter — 3 forces qualitatives estimées par l'IA (M3 audit : rivalité, substituts,
  // nouveaux entrants ; les 2 autres forces restent quantifiées depuis les données internes).
  try {
    const parsed = parsePorterResponse(await generateJson(buildPorterPrompt(signals, companyContext)));
    if (!parsed) {
      summary.porter = "parse-failed";
      logger.error("runEnrichment: porter response unusable (parse returned null)");
    } else {
      summary.porter = await writeFrameworkDoc(db, "porter", parsed);
    }
  } catch (err) {
    summary.porter = "failed";
    logger.error(`runEnrichment: porter generation FAILED — ${err.message}`, { err });
  }

  // 7c. Cadres additionnels (audit 2026-07) : Ansoff, VRIO, Chaîne de valeur — chacun indépendant.
  // Ansoff vise la BREADTH (4 cases produit×marché) → échantillon diversifié ; VRIO/ValueChain sont
  // surtout pilotés par le contexte entreprise → lot brut suffisant.
  for (const [key, build, parse, sampleForKey] of [
    ["ansoff", buildAnsoffPrompt, parseAnsoffResponse, diverseSignals],
    ["vrio", buildVrioPrompt, parseVrioResponse, signals],
    ["valueChain", buildValueChainPrompt, parseValueChainResponse, signals],
  ]) {
    try {
      const parsed = parse(await generateJson(build(sampleForKey, companyContext)));
      if (!parsed) {
        summary[key] = "parse-failed";
        logger.error(`runEnrichment: ${key} response unusable (parse returned null)`);
      } else {
        summary[key] = await writeFrameworkDoc(db, key, parsed);
      }
    } catch (err) {
      summary[key] = "failed";
      logger.error(`runEnrichment: ${key} generation FAILED — ${err.message}`, { err });
    }
  }

  // 7d. Scénarios prospectifs — cas particulier : l'exercice était « obsédé » par le thème dominant
  // du cycle d'actu (le top-N de `signals` est monothématique car classé par priorité). On lui
  // fournit un échantillon ENTRELACÉ PAR AXE (diversifySignals) pour qu'il explore des incertitudes
  // variées et indépendantes, pas la seule actualité chaude.
  try {
    const parsed = parseScenariosResponse(await generateJson(buildScenariosPrompt(diverseSignals, companyContext)));
    if (!parsed) {
      summary.scenarios = "parse-failed";
      logger.error("runEnrichment: scenarios response unusable (parse returned null)");
    } else {
      summary.scenarios = await writeFrameworkDoc(db, "scenarios", parsed);
    }
  } catch (err) {
    summary.scenarios = "failed";
    logger.error(`runEnrichment: scenarios generation FAILED — ${err.message}`, { err });
  }

  // 8. Three Horizons — suggestions d'initiatives (frameworks/horizons). L'humain adopte une
  // suggestion en créant l'initiative réelle dans Exécution & Décisions.
  try {
    const parsed = parseHorizonsResponse(await generateJson(buildHorizonsPrompt(diverseSignals, companyContext)));
    if (!parsed) {
      summary.horizons = "parse-failed";
      logger.error("runEnrichment: horizons response unusable (parse returned null)");
    } else {
      summary.horizons = await writeFrameworkDoc(db, "horizons", parsed);
    }
  } catch (err) {
    summary.horizons = "failed";
    logger.error(`runEnrichment: horizons generation FAILED — ${err.message}`, { err });
  }

  // 9. Paris d'innovation (RICE) — suggestions IA dans innovationPortfolio. Un pari existant
  // NON généré par l'IA (créé au formulaire) n'est jamais modifié ; les paris IA sont upsertés
  // par slug (pas de suppression : le RICE humain peut évoluer après édition).
  try {
    const parsed = parseInnovationBetsResponse(await generateJson(buildInnovationBetsPrompt(diverseSignals, companyContext)));
    if (!parsed) {
      summary.innovationBets = "parse-failed";
      logger.error("runEnrichment: innovation bets response unusable (parse returned null)");
    } else {
      let written = 0;
      for (const bet of parsed.bets) {
        const ref = db.doc(`innovationPortfolio/bet-${enrichSlugId(bet.title)}`);
        const existing = await ref.get();
        if (existing.exists && existing.data()?.generatedBy !== "ai") continue; // pari humain — intouchable
        await ref.set({ ...bet, generatedBy: "ai", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        written += 1;
      }
      summary.innovationBets = written;
    }
  } catch (err) {
    summary.innovationBets = "failed";
    logger.error(`runEnrichment: innovation bets generation FAILED — ${err.message}`, { err });
  }

  // 6. Opportunités business (bizOpportunities) — Action 6.1 de l'audit 2026-07 : transformer les
  // signaux en pipeline de leads qualifiés. Upsert par slugId(name) ; statut "new" forcé à la
  // création uniquement — un statut humain (qualified/dropped) déjà posé n'est JAMAIS écrasé.
  try {
    const enrichBUs = enrichProfile.taxonomy && enrichProfile.taxonomy.businessUnits;
    const parsed = parseOpportunitiesResponse(await generateJson(buildOpportunitiesPrompt(signals, companyContext, enrichBUs)), enrichBUs);
    if (!parsed) {
      summary.bizOpportunities = "parse-failed";
      logger.error("runEnrichment: opportunities response unusable (parse returned null)");
    } else {
      for (const opp of parsed.opportunities) {
        const ref = db.doc(`bizOpportunities/${enrichSlugId(opp.name)}`);
        const existing = await ref.get();
        const payload = {
          ...opp,
          generatedBy: "ai",
          updatedAt: FieldValue.serverTimestamp(),
        };
        // Le doc existe déjà : merge:true préserve son `status` courant (revue humaine) — on
        // retire la clé du payload pour ne pas repasser un lead qualifié/écarté en "new".
        if (existing.exists) delete payload.status;
        await ref.set(payload, { merge: true });
      }
      summary.bizOpportunities = parsed.opportunities.length;
    }
  } catch (err) {
    summary.bizOpportunities = "failed";
    logger.error(`runEnrichment: opportunities generation FAILED — ${err.message}`, { err });
  }

  logger.info(`runEnrichment: done — ${JSON.stringify(summary)} (signals=${signals.length})`);
  return summary;
  } finally {
    await releaseRunLock(db, ENRICH_LOCK);
  }
}

/**
 * enrichStrategicArtifacts — Scheduler (hebdomadaire, lundi 05:00 Africa/Abidjan).
 * Regenerates the strategic artifacts from the week's accumulated signals via `runEnrichment`.
 */
exports.enrichStrategicArtifacts = onSchedule(
  { schedule: "0 5 * * 1", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const db = firestoreDb();
    if (!(await gateScheduledPipeline(db, "enrich"))) return; // pause/throttle — avant la ~15aine d'appels Vertex
    await runEnrichment(db);
  }
);

/**
 * enrichNow — callable, exec-gated (same pattern as syncSourcesNow/classifyAI): triggers the
 * enrichment pipeline on demand and returns its summary.
 */
exports.enrichNow = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "lancer l'enrichissement IA");
  const result = await runEnrichment(firestoreDb());
  logger.info(`enrichNow: caller=${request.auth.uid} result=${JSON.stringify(result)}`);
  return result;
});

/**
 * setPipelineConfig — callable exec : règle la CADENCE des pipelines planifiés (maîtrise des coûts
 * Vertex/Cloud Run) SANS redéploiement. Écrit `config/runtime` (base strategic360), lu par les crons
 * via gateScheduledPipeline(). data: { paused?: boolean, intervals?: { sync|evaluate|aggregate|
 * enrich|briefing: minutes } } — intervalle 0 = cadence native, > 0 = espacement minimum entre deux
 * runs automatiques. `lastRun` n'est jamais touché ici (réservé aux crons). config/runtime reste en
 * lecture exec-only via les règles (match /config/{d}) ; l'écriture ne passe QUE par ce callable.
 */
exports.setPipelineConfig = onCall(CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "régler la cadence des pipelines");
  const { paused, intervals } = request.data || {};
  const patch = {};
  if (typeof paused === "boolean") patch.paused = paused;
  if (intervals !== undefined) patch.intervals = sanitizePipelineIntervals(intervals);
  if (!Object.keys(patch).length) {
    throw new HttpsError("invalid-argument", "Rien à régler : fournir `paused` (booléen) et/ou `intervals` (objet).");
  }
  patch.updatedBy = request.auth.uid;
  patch.updatedAt = FieldValue.serverTimestamp();
  await firestoreDb().doc("config/runtime").set(patch, { merge: true });
  logger.info(`setPipelineConfig: caller=${request.auth.uid} patch=${JSON.stringify({ paused: patch.paused, intervals: patch.intervals })}`);
  return { ok: true };
});

/* ------------------------------------------------------------------------------------------- *
 * COPILOTE COMMERCIAL (add-on DELTA 02 / 02B) — callables server-side.
 * Reuse maximum : moteur IA = generateJson (gemini-3.5-flash) ; contexte assemblé côté serveur
 * depuis copiloteAccounts (qualitatif) + frameworks/pestel (RÉUTILISÉ, pas régénéré) +
 * bizOpportunities (signaux). Aucune donnée nt360 n'est écrite. Gate : rôles commerciaux + exec.
 * ------------------------------------------------------------------------------------------- */

/** Assemble le contexte d'un compte pour les agents, en réutilisant l'existant de la veille. */
async function assembleCopiloteContext(db, accountId) {
  const [acctSnap, pestelSnap, bizSnap, metaSnap, battlecardsSnap, winLossSnap, clientProfile] = await Promise.all([
    accountId ? db.doc(`copiloteAccounts/${accountId}`).get() : Promise.resolve(null),
    db.doc("frameworks/pestel").get(),
    db.collection("bizOpportunities").get(),
    db.doc("summaries/copiloteMeta").get(),
    db.collection("battlecards").get(),
    db.collection("winLoss").get(),
    loadClientProfile(db), // profil client (Phase 0) — fournit systemRole ; best-effort (défaut = NT)
  ]);
  const a = acctSnap && acctSnap.exists ? acctSnap.data() : {};
  // Empreinte dérivée de nt360 (additive, jamais destructive) : on fusionne l'historique/les
  // travaux en cours SAISIS par le commercial avec ceux DÉRIVÉS du pipeline réel (a.nt360).
  const nt = a.nt360 && typeof a.nt360 === "object" ? a.nt360 : {};
  const humanHisto = Array.isArray(a.historique) ? a.historique : [];
  const derivedHisto = Array.isArray(nt.historique) ? nt.historique : [];
  const histoSeen = new Set();
  // Garde `h && typeof === object` : un doc édité à la main peut contenir null / une string dans
  // historique — sans ce garde `h.offre` levait une exception → « internal » sur ce compte.
  // Dérivé D'ABORD : les entrées enrichies (CAS/années) priment sur une saisie manuelle pauvre.
  const historique = [...derivedHisto, ...humanHisto].filter((h) => {
    if (!h || typeof h !== "object" || !h.offre) return false;
    const k = `${String(h.offre).toLowerCase()}|${String(h.statut || "").toLowerCase()}`;
    if (histoSeen.has(k)) return false;
    histoSeen.add(k);
    return true;
  });
  // Coerce en chaînes non vides avant fusion : évite qu'une saisie humaine non-string ne produise
  // « [object Object] » dans le prompt, et déduplique proprement.
  const enCours = [...new Set(
    [...(Array.isArray(a.enCours) ? a.enCours : []), ...(Array.isArray(nt.enCours) ? nt.enCours : [])]
      .filter((x) => typeof x === "string" && x.trim())
      .map((x) => x.trim())
  )];
  // PESTEL réutilisé depuis la veille (frameworks/pestel content.factors = [{f, d, ...}]).
  const pestel = (pestelSnap.exists ? pestelSnap.data()?.content?.factors || [] : [])
    .filter((x) => x && typeof x === "object" && x.d)
    .map((x) => ({ axe: x.f, texte: x.d }));
  // DEALS = opportunités RÉELLES du compte (pipeline nt360), avec montant nommé — matière spécifique.
  // Enrichis (audit profondeur 2026-07) : on remonte AUSSI montant/étape/probabilité/date de closing
  // pour que les agents puissent dater et prioriser un plan sur le réel (et non sur des buckets flous).
  const deals = (Array.isArray(nt.opportunites) ? nt.opportunites : []).map((o) => ({
    titre: `${o.nom} — ${Number.isFinite(o.montant) ? new Intl.NumberFormat("fr-FR").format(o.montant) + " XOF" : "montant n.c."} (${o.etape})`,
    nom: o.nom || "",
    montant: Number.isFinite(o.montant) ? o.montant : null,
    etape: o.etape || "",
    bu: o.bu || "",
    closingDate: typeof o.closingDate === "string" ? o.closingDate : "",
    probability: Number.isFinite(o.probability) ? o.probability : null,
  }));
  // SIGNAUX = leads de veille (opportunités business dérivées de la veille). Deux usages distincts :
  //  - `signaux` : échantillon générique pour la PROSPECTION (comptes cibles) ;
  //  - `signauxCompte` : ceux qui NOMMENT ce compte → déclencheurs commerciaux rattachés au portefeuille.
  // Anti-obsolescence (audit doublement CA) : on écarte les leads de veille dont l'échéance est DÉPASSÉE —
  // présenter un AO/déclencheur périmé comme actionnable décrédibilise toute la sortie et tue l'adoption.
  const todayIso = new Date().toISOString().slice(0, 10);
  const notStale = (o) => {
    const dl = o && (o.deadline || o.dueDate || o.closingDate);
    return !(typeof dl === "string" && /^\d{4}-\d{2}-\d{2}/.test(dl) && dl < todayIso);
  };
  const bizAll = bizSnap.docs.map((d) => d.data()).filter((o) => o && o.name && notStale(o));
  // Récupération légère (Vague D) : au lieu des 10 PREMIERS leads (ordre Firestore arbitraire), on
  // classe par PERTINENCE au compte (secteur + whitespace + enjeux) — la prospection voit les leads
  // qui comptent pour CE compte, pas un échantillon aveugle.
  const prospectTerms = [a.secteur, ...(Array.isArray(a.whitespace) ? a.whitespace : []), ...(Array.isArray(a.enjeux) ? a.enjeux : [])].filter(Boolean);
  // Signaux enrichis (audit v2) : au-delà du titre nu, on joint l'angle actionnable (événement
  // déclencheur / prochaine action / offre) — matière plus riche pour la prospection ET l'agent
  // Contenu marketing au niveau marché. Champs ajoutés seulement s'ils existent (pas d'undefined).
  const signaux = pickRelevant(bizAll, { terms: prospectTerms }, 10).map((o) => {
    const sig = { titre: o.name };
    const so = o.triggerEvent || o.nextAction;
    if (typeof so === "string" && so.trim()) sig.soWhat = so.trim();
    if (typeof o.offering === "string" && o.offering.trim()) sig.offre = o.offering.trim();
    return sig;
  });
  // Déclencheurs de veille RATTACHÉS au compte : on privilégie `nt.veille.top` (persisté au sync —
  // titre + date + so-what + impact + offre déclenchée), qui porte l'actionnabilité, au lieu des
  // seuls titres de bizOpportunities. Audit pertinence 2026-07 (constat « la boucle veille→vente
  // s'arrêtait au titre nu ») : sans date/so-what/offre liée, l'IA ne pouvait produire ni timing ni
  // accroche et retombait sur du générique. Repli sur le matching bizOpportunities si aucune veille
  // dérivée n'est disponible pour ce compte.
  const ntVeille = nt.veille && typeof nt.veille === "object" ? nt.veille : {};
  const veilleTop = Array.isArray(ntVeille.top) ? ntVeille.top : [];
  const eventOffers = Array.isArray(nt.eventOffers) ? nt.eventOffers : [];
  const signauxCompteRich = veilleTop.map((t) => {
    const eo = eventOffers.find((e) => e && e.event && t.title && e.event === t.title);
    return {
      titre: t.title || "",
      date: t.date || "",
      soWhat: t.soWhat || "",
      impact: t.impact || "",
      prox: t.prox || "",
      offreLiee: eo ? eo.offre : "", // offre NT rendue opportune par cet événement (boucle veille→vente)
    };
  }).filter((s) => s.titre);
  const signauxCompte = signauxCompteRich.length
    ? signauxCompteRich
    : (a.nom ? nt360MatchSignalsToAccount(a.nom, bizAll) : []).slice(0, 5).map((o) => ({ titre: o.name }));
  // WHITESPACE RÉEL = catalogue d'offres NT (agrégé au sync, summaries/copiloteMeta.buCatalog) MOINS
  // les BU que ce compte a déjà touchées (achetées ou en cours). C'est le cross-sell concret et
  // spécifique — remplace le whitespace vide qui faisait produire des livrables génériques.
  const meta = metaSnap.exists ? metaSnap.data() : {};
  const buCatalog = Array.isArray(meta.buCatalog) ? meta.buCatalog : [];
  const affinity = meta.affinity && typeof meta.affinity === "object" ? meta.affinity : {};
  const ownedBus = [...(Array.isArray(nt.bus) ? nt.bus : []), ...historique.map((h) => h.offre), ...enCours]
    .filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  const touched = new Set(ownedBus.map((x) => x.toLowerCase()));
  // On EXCLUT les libellés fourre-tout (« AUTRE », « DIVERS »…) : ce ne sont pas des offres vendables,
  // le copilote ne doit jamais recommander « introduire l'offre AUTRE » (audit 2026-07).
  const derivedWhitespace = buCatalog.filter((bu) => typeof bu === "string" && bu.trim() && !touched.has(bu.trim().toLowerCase()) && nt360IsMeaningfulBu(bu));
  const humanWhitespace = Array.isArray(a.whitespace) ? a.whitespace.filter((x) => typeof x === "string" && x.trim() && nt360IsMeaningfulBu(x)) : [];
  const whitespace0 = [...new Set([...humanWhitespace, ...derivedWhitespace])];
  // Classement du whitespace par AFFINITÉ de cross-sell (market basket) + « next best offer ».
  const ranked = nt360RecommendNextOffers(ownedBus, whitespace0, affinity);
  const whitespace = ranked.length ? ranked.map((r) => r.offre) : whitespace0;
  let recoBase = ranked.find((r) => r.csPct > 0) || ranked[0] || null;
  // NEXT BEST OFFER PILOTÉE PAR LA VEILLE (passe finale 2026-07) : si un déclencheur de veille rattaché
  // au compte pointe une offre (offreLiee) présente dans le whitespace, on la PROMEUT en tête de reco —
  // la demande réelle (EOL, réglementaire, AO) prime sur la seule affinité statistique interne. On tague
  // `triggeredBy` pour que le libellé cite l'événement déclencheur (copilote.js).
  for (const s of signauxCompteRich) {
    const off = (s && s.offreLiee ? String(s.offreLiee) : "").trim().toLowerCase();
    if (!off) continue;
    const hit = ranked.find((r) => (r.offre || "").trim().toLowerCase() === off);
    if (hit) { recoBase = { ...hit, triggeredBy: s.titre || "" }; break; }
  }
  // Chiffrage de la next best offer : panier de référence (médiane du portefeuille) pour son offre.
  const benchmark = meta.buBenchmark && typeof meta.buBenchmark === "object" ? meta.buBenchmark : {};
  const casTotal = Number(nt.casTotal) || 0;
  // Ancre BORNÉE à l'échelle du compte (audit pertinence 2026-07) : une médiane portefeuille très
  // supérieure au CAS réalisé du compte donne un « montant d'ancrage à viser » non crédible (ex.
  // 45 M XOF pour un compte à 8 M) que le commercial ne défendra pas. On plafonne à ~1.5× l'empreinte
  // et on signale quand l'ancre brute dépassait largement.
  const ANCHOR_SCALE = 1.5;
  const recommendation = recoBase
    ? (() => {
        const rawMedian = Number(benchmark[recoBase.offre]?.medianCas) || 0;
        const cap = casTotal > 0 ? Math.round(casTotal * ANCHOR_SCALE) : rawMedian;
        const montantEstime = casTotal > 0 ? Math.min(rawMedian, cap) : rawMedian;
        return { ...recoBase, montantEstime, montantReference: rawMedian, anchorCapped: casTotal > 0 && rawMedian > cap };
      })()
    : null;
  const pipelinePondere = Number(nt.pipelinePondere) || 0;
  const wins = Number(nt.wins) || 0;
  const enjeux = Array.isArray(a.enjeux) ? a.enjeux : [];

  // --- Intelligence concurrentielle (audit profondeur 2026-07) : les battlecards existaient mais
  // n'étaient JAMAIS lues par le copilote. On les compacte et on ne garde que celles pertinentes
  // pour ce compte : concurrents cités dans le champ `concurrence` du compte (sinon top par richesse).
  const bcAll = battlecardsSnap.docs.map((d) => d.data()).filter((b) => b && b.competitor);
  const concurrenceText = String(a.concurrence || "").toLowerCase();
  const compact = (b) => ({
    competitor: String(b.competitor),
    positioning: typeof b.positioning === "string" ? b.positioning : "",
    strengths: (Array.isArray(b.strengths) ? b.strengths : []).slice(0, 3),
    weaknesses: (Array.isArray(b.weaknesses) ? b.weaknesses : []).slice(0, 3),
    ourWinThemes: (Array.isArray(b.ourWinThemes) ? b.ourWinThemes : []).slice(0, 3),
    objectionHandling: (Array.isArray(b.objectionHandling) ? b.objectionHandling : []).slice(0, 3),
    theirLikelyMoves: (Array.isArray(b.theirLikelyMoves) ? b.theirLikelyMoves : []).slice(0, 2),
  });

  // --- Win/Loss réel (audit profondeur) : taux de victoire global + par concurrent + leçons récentes.
  // Jamais injecté auparavant → aucune analyse « win-theme » data-driven n'était possible.
  const wlByComp = {};
  let winsTot = 0, dealsTot = 0;
  const lessons = [];
  for (const d of winLossSnap.docs) {
    const e = d.data();
    if (!e) continue;
    if (typeof e.competitor === "string" && e.competitor.trim()) {
      const b = (wlByComp[e.competitor] ??= { wins: 0, total: 0 });
      b.total += 1;
      if (e.result === "win") b.wins += 1;
      dealsTot += 1;
      if (e.result === "win") winsTot += 1;
    }
    if (typeof e.lesson === "string" && e.lesson.trim()) {
      lessons.push({ competitor: e.competitor || "", result: e.result || "", lesson: e.lesson.trim(), date: e.date || "" });
    }
  }
  const winStats = {
    global: dealsTot ? Math.round((winsTot / dealsTot) * 100) : null,
    dealsTotal: dealsTot,
    byCompetitor: Object.entries(wlByComp).map(([competitor, b]) => ({ competitor, winPct: b.total ? Math.round((b.wins / b.total) * 100) : 0, deals: b.total })).sort((x, y) => y.deals - x.deals).slice(0, 6),
    lessons: lessons.slice(-5).reverse(),
  };

  // Sélection des battlecards PRIORISÉE (audit doublement CA) : d'abord celles matchées au compte, puis
  // les concurrents où NT PERD LE PLUS (winPct croissant sur des deals réels) — on arme le commercial contre
  // l'adversaire qui coûte réellement des affaires, au lieu des 6 premières au hasard.
  const lossRank = new Map(winStats.byCompetitor.map((x) => [x.competitor.toLowerCase(), x.winPct]));
  const isMatched = (b) => concurrenceText.includes(String(b.competitor).toLowerCase());
  // Audit pertinence 2026-07 : on ne mélange PLUS les battlecards CONFIRMÉES sur le compte (champ
  // `concurrence`) avec le complément « loss-rank » global. Injectées ensemble, l'IA prenait un
  // concurrent absent du compte pour le « concurrent en place » et bâtissait des parades fictives.
  // Deux listes distinctes, étiquetées différemment côté prompt.
  const battlecards = bcAll.filter(isMatched).slice(0, 6).map(compact); // confirmés sur ce compte
  const bcMarketScore = (b) => {
    const key = String(b.competitor).toLowerCase();
    return lossRank.has(key) ? lossRank.get(key) : 500; // plus le winPct est BAS, plus c'est prioritaire
  };
  const battlecardsMarket = bcAll
    .filter((b) => !isMatched(b))
    .sort((a2, b2) => bcMarketScore(a2) - bcMarketScore(b2))
    .slice(0, Math.max(0, 6 - battlecards.length))
    .map(compact); // concurrents fréquents du marché (NON confirmés sur ce compte)

  // --- Modèle de valeur CHIFFRÉ en code (audit profondeur) : la trajectoire/business case ne doit plus
  // reposer sur des montants hallucinés par l'IA. On projette depuis les VRAIS paniers de référence
  // (benchmark.medianCas par offre) et l'historique du compte. L'IA n'aura qu'à narrer ces chiffres.
  const money = (n) => Math.round(Number(n) || 0);
  const nextOfferAmount = recommendation ? money(recommendation.montantEstime) : 0;
  const whitespaceValue = whitespace.slice(0, 5).map((offre) => ({ offre, montant: money(benchmark[offre]?.medianCas) })).filter((x) => x.montant > 0);
  const whitespacePotential = whitespaceValue.reduce((s, x) => s + x.montant, 0);
  const valueModel = {
    casTotal: money(casTotal),
    pipelinePondere: money(pipelinePondere),
    nextOffer: recommendation ? { offre: recommendation.offre, montant: nextOfferAmount, csPct: recommendation.csPct || 0 } : null,
    whitespaceValue, // [{offre, montant}] chiffré depuis les paniers de référence réels
    whitespacePotential, // somme du potentiel cross-sell chiffrable
  };
  return {
    compte: a.nom || "",
    secteur: a.secteur || "",
    tier: a.tier || "",
    enjeux,
    whitespace,
    enCours, // saisi + dérivé nt360
    historique, // saisi + dérivé nt360
    contacts: Array.isArray(a.contacts) ? a.contacts : [],
    // Pas de références par défaut fabriquées (audit 2026-07) : un compte sans preuves saisies →
    // liste vide → le prompt affiche « aucun » et NO_GENERIC fait proposer une action de
    // qualification (« références à confirmer ») au lieu d'un triplet BCEAO/Orange/BRVM générique.
    preuves: Array.isArray(a.preuves) ? a.preuves.filter((x) => typeof x === "string" && x.trim()) : [],
    tendances: Array.isArray(a.tendances) ? a.tendances : [],
    reglementation: a.reglementation || "",
    concurrence: a.concurrence || "",
    pestel,
    signaux, // leads de veille génériques (prospection)
    signauxCompte, // déclencheurs de veille nommant CE compte (rattachés au portefeuille — enrichis date/so-what/offre)
    eventOffers, // offres NT rendues opportunes MAINTENANT par un événement de veille (boucle veille→vente)
    deals,   // opportunités réelles du compte (CVP/triennal/plan/chat)
    recommendation, // next best offer data-driven { offre, csPct, montantEstime }
    casTotal,
    pipelinePondere,
    wins,
    battlecards,   // battlecards CONFIRMÉES sur ce compte (concurrent en place)
    battlecardsMarket, // concurrents fréquents du marché (loss-rank global) — NON confirmés sur ce compte
    winStats,      // taux de victoire réel (global + par concurrent + leçons)
    valueModel,    // modèle de valeur chiffré (paniers de référence réels) — pour le business case
    today: new Date().toISOString().slice(0, 10), // ancrage temporel des séquences/plans datés
    // Rôle système du profil client (Phase 0 produit) : injecté dans les prompts copilote via roleOf(c).
    // Absent/défaut → NT_ROLE (comportement identique pour Neurones).
    systemRole: clientProfile.profile && clientProfile.profile.systemRole,
    // Différenciateurs de marque du profil client (onboarding) : injectés dans la CVP / les angles
    // marketing via differenciateursOf(c). Absent/défaut → NT_DIFFERENCIATEURS (identique pour Neurones).
    // Rend les générateurs client-facing tenant-agnostiques (fin du contexte Neurones codé en dur).
    differenciateurs: clientProfile.profile && clientProfile.profile.differentiators,
    // Nom de l'entreprise (profil onboardé) écrit dans le corps des prompts CVP/marketing via
    // companyNameOf(c). Absent/défaut → « Neurones Technologies ». Dernier reliquat du nom en dur.
    companyName: clientProfile.profile && clientProfile.profile.companyName,
    // Devise du profil client (audit multi-tenant 2026-07, B10) : formatage des montants via xof(n,cur).
    // Absent/défaut → « XOF » (identique pour Neurones).
    currency: clientProfile.profile && clientProfile.profile.currency,
    // Marché/secteur du profil client (audit multi-tenant 2026-07, B3) : géo/secteur injectés dans le
    // CORPS des prompts (prospection/contenu) via marketOf(c). Absent/défaut → « Côte d'Ivoire / UEMOA ».
    geographies: clientProfile.profile && clientProfile.profile.geographies,
    sectorProfil: clientProfile.profile && clientProfile.profile.sector,
    account: { nom: a.nom || "", secteur: a.secteur || "", tier: a.tier || "", enjeux, historique, enCours, whitespace, casTotal, pipelinePondere, wins, deals, recommendation, signauxCompte, eventOffers, battlecards, battlecardsMarket, winStats, valueModel, today: new Date().toISOString().slice(0, 10) },
  };
}

/**
 * copiloteGenerate — callable. data: { agent, accountId?, extra? }.
 * agent ∈ {prospection, cvp, triennal, planCompte, redaction}. `extra` fusionne des champs ctx
 * fournis par l'écran (ex. redaction : {kind, canal, ton, contexte}).
 */
// Champs d'écran que le client a le droit de fournir (redaction) — tout le reste du contexte est
// assemblé côté serveur depuis nt360/veille et ne doit PAS être surchargé par le client.
const COPILOTE_EXTRA_ALLOWED = ["kind", "canal", "ton", "contexte", "compte", "objectif", "destinataire"];
function assertAccountId(accountId) {
  if (accountId == null || accountId === "") return;
  if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]+$/.test(accountId)) {
    throw new HttpsError("invalid-argument", "Identifiant de compte invalide.");
  }
}

/**
 * assertAccountInScope — CLOISONNEMENT des callables copilote (fix IDOR, audit 2026-07). copiloteGenerate
 * et copiloteChat lisaient copiloteAccounts/{accountId} via l'Admin SDK (contourne firestore.rules) SANS
 * vérifier le périmètre de l'appelant : un rôle `commercial` cloisonné pouvait exfiltrer le contexte
 * (deals, montants, historique, MEDDIC) de n'importe quel compte en énumérant les IDs. On applique ici le
 * MÊME garde que listCopiloteAccounts (nt360AccountMatchesScope + profil copiloteProfiles/{email}). Les
 * rôles non cloisonnés (exec, direction commerciale) voient tout ; sans accountId (agents niveau marché)
 * rien à cloisonner.
 */
async function assertAccountInScope(db, request, accountId) {
  if (!accountId) return;
  const role = request.auth?.token?.role;
  if (COPILOTE_UNSCOPED_ROLES.includes(role)) return;
  const accSnap = await db.doc(`copiloteAccounts/${accountId}`).get();
  if (!accSnap.exists) return; // compte inexistant → assembleCopiloteContext renverra un contexte vide (pas de fuite)
  const email = (request.auth?.token?.email || "").trim().toLowerCase();
  const profSnap = email ? await db.doc(`copiloteProfiles/${email}`).get() : null;
  const prof = profSnap && profSnap.exists ? profSnap.data() : {};
  const scope = { uid: request.auth.uid, email, ams: Array.isArray(prof.ams) ? prof.ams : [], bus: Array.isArray(prof.bus) ? prof.bus : [] };
  if (!nt360AccountMatchesScope({ id: accSnap.id, ...accSnap.data() }, scope)) {
    throw new HttpsError("permission-denied", "Ce compte n'est pas dans votre périmètre.");
  }
}

exports.copiloteGenerate = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireCommercialCaller(request, "utiliser le copilote commercial");
  const { agent, accountId, extra } = request.data || {};
  const spec = COPILOTE_AGENTS[agent];
  if (!spec) throw new HttpsError("invalid-argument", `agent inconnu : ${agent}`);
  // Agents « niveau marché » (ex. contenu marketing 1:N) : pas d'accountId requis (levier waouh n°2).
  if (!spec.accountOptional) assertAccountId(accountId);
  else if (accountId) assertAccountId(accountId); // si un compte est fourni, il doit rester valide
  const db = firestoreDb();
  await assertAccountInScope(db, request, accountId); // cloisonnement (fix IDOR) avant tout chargement de contexte
  const base = await assembleCopiloteContext(db, accountId);
  // Agents mono-deal : refuser proprement si le compte n'a aucune opportunité ouverte, plutôt que de
  // renvoyer une carte MEDDIC/analyse « à qualifier » sur tous les champs (audit pertinence 2026-07).
  if (spec.requiresDeal && !(Array.isArray(base.deals) && base.deals.some((d) => d && d.nom))) {
    throw new HttpsError(
      "failed-precondition",
      "Aucune opportunité ouverte sur ce compte — créez ou qualifiez un deal (pipeline) avant de lancer cet agent (MEDDIC / analyse de deal)."
    );
  }
  const safeExtra = {};
  if (extra && typeof extra === "object") {
    for (const k of COPILOTE_EXTRA_ALLOWED) if (k in extra) safeExtra[k] = extra[k];
  }
  const ctx = { ...base, ...safeExtra };
  let parsed;
  try {
    parsed = spec.parse(await generateJson(spec.build(ctx)), ctx);
  } catch (err) {
    logger.error(`copiloteGenerate: agent=${agent} FAILED — ${err.message}`, { err });
    throw new HttpsError("internal", "L'IA n'a pas pu générer ce livrable (réessayez dans un instant).");
  }
  if (!parsed) throw new HttpsError("failed-precondition", "Réponse IA inexploitable. Réessayez ou précisez le contexte du compte.");
  return parsed;
});

/**
 * copiloteChat — callable multi-turn. data: { accountId?, ecran?, messages: [{role, content}] }.
 * Réutilise generateJson en encapsulant la réponse dans { reply } (aucune fonction moteur ajoutée).
 */
exports.copiloteChat = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireCommercialCaller(request, "utiliser le copilote commercial");
  const { accountId, ecran, messages } = request.data || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpsError("invalid-argument", "messages (non vide) est requis.");
  }
  assertAccountId(accountId);
  const db = firestoreDb();
  await assertAccountInScope(db, request, accountId); // cloisonnement (fix IDOR) avant tout chargement de contexte
  const base = await assembleCopiloteContext(db, accountId);
  const ctx = { ecran: ecran || "Copilote", compte: base.account.nom ? base.account : null };
  let parsed;
  try {
    parsed = parseChatResponse(await generateJson(buildChatPrompt(ctx, messages)));
  } catch (err) {
    logger.error(`copiloteChat: FAILED — ${err.message}`, { err });
    throw new HttpsError("internal", "Le copilote n'a pas pu répondre (réessayez dans un instant).");
  }
  if (!parsed) throw new HttpsError("failed-precondition", "Réponse IA inexploitable.");
  return parsed;
});

/* ------------------------------------------------------------------------------------------- *
 * ONBOARDING AUTO (Phase 1 « produit agnostique », P3) — `onboardCompany` orchestre, à partir de
 * l'URL du site d'un prospect/client, la génération de sa configuration de veille : crawl du site
 * (domain/onboarding.pickOnboardingLinks + crawlSite) → 3 appels IA (profil+contexte, écosystème,
 * plan de veille) → validation technique des sources candidates (validateCandidateSource) → écriture
 * d'un BROUILLON éditable `config/onboardingDraft`. RIEN n'est activé : aucun doc `config/*` de
 * production n'est touché ici (c'est `applyOnboardingDraft`, P4, après revue humaine). Exec-gated :
 * paramétrer l'outil pour une entreprise est une opération d'administration/déploiement.
 * ------------------------------------------------------------------------------------------- */
exports.onboardCompany = onCall({ ...HEAVY_CALLABLE_OPTS, memory: "1GiB", cpu: cpuAtLeast(0.5) }, async (request) => {
  requireExecCaller(request, "générer la configuration de veille d'une entreprise (onboarding)");
  const { url, docsText, hints, maxPages, validateSources } = request.data || {};
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    throw new HttpsError("invalid-argument", "Une URL http(s) du site de l'entreprise est requise.");
  }
  const siteUrl = url.trim();
  const pages = Math.max(1, Math.min(8, Number(maxPages) || 5));

  // 1) Crawl fail-soft du site (home + liens internes prioritaires).
  let siteText = "";
  try {
    siteText = await crawlSite(siteUrl, { maxPages: pages });
  } finally {
    await closeRenderBrowser();
  }
  if (!siteText || siteText.length < 200) {
    throw new HttpsError("failed-precondition", "Impossible d'extraire assez de texte depuis ce site (page inaccessible, vide ou entièrement dynamique). Vérifiez l'URL.");
  }
  const safeDocs = typeof docsText === "string" ? docsText.slice(0, 8000) : "";
  const safeHints = hints && typeof hints === "object" ? hints : {};

  // 2) IA — profil + contexte.
  let profileOut;
  try {
    profileOut = parseOnboardingProfileResponse(await generateJson(buildOnboardingProfilePrompt(siteText, safeDocs, safeHints)));
  } catch (err) {
    logger.error(`onboardCompany: profil FAILED — ${err.message}`, { err });
    throw new HttpsError("internal", "L'IA n'a pas pu établir le profil de l'entreprise (réessayez).");
  }
  if (!profileOut) throw new HttpsError("failed-precondition", "Profil inexploitable : le site ne contient pas assez d'informations d'entreprise.");

  // 3) IA — écosystème (entités typées + axes + sous-types).
  let ecosystem = { entities: [], axes: [], subtypes: [] };
  try {
    ecosystem = parseEcosystemMapResponse(await generateJson(buildEcosystemMapPrompt(profileOut.contextText, siteText))) || ecosystem;
  } catch (err) {
    logger.warn(`onboardCompany: écosystème échoué (${err.message}) — poursuite sans`);
  }

  // 4) IA — plan de veille (axes prioritaires, guidage classifieur, mots-clés, sources candidates).
  let plan = { axes: [], classifierGuidance: "", homonymyRule: "", keywords: [], candidateSources: [] };
  try {
    plan = parseVeillePlanResponse(await generateJson(buildVeillePlanPrompt(profileOut.profile, ecosystem.entities))) || plan;
  } catch (err) {
    logger.warn(`onboardCompany: plan de veille échoué (${err.message}) — poursuite sans`);
  }

  // 5) Validation TECHNIQUE des sources candidates (on ne retient pas une URL non fetchable/vide).
  //    Désactivable via validateSources:false (mode rapide / prévisualisation).
  let candidateSources = plan.candidateSources;
  if (validateSources !== false && candidateSources.length) {
    const settled = await runInBatches(candidateSources, AI_CONCURRENCY, (s) => validateCandidateSource(s.url, s.kind));
    candidateSources = candidateSources.map((s, i) => {
      const r = settled[i];
      const v = r && r.status === "fulfilled" ? r.value : { ok: false, itemCount: 0, reason: "validation échouée" };
      return { ...s, valid: !!v.ok, itemCount: v.itemCount || 0, validationReason: v.reason || "" };
    });
  } else {
    candidateSources = candidateSources.map((s) => ({ ...s, valid: null, itemCount: 0, validationReason: "" }));
  }
  const validCount = candidateSources.filter((s) => s.valid === true).length;

  // 6) Écriture du BROUILLON (overwrite complet ; aucun doc de prod modifié).
  const draft = {
    status: "draft",
    sourceUrl: siteUrl,
    hints: safeHints,
    profile: profileOut.profile,
    contextText: profileOut.contextText,
    ecosystem,
    plan: { ...plan, candidateSources },
    stats: {
      siteTextLength: siteText.length,
      entities: ecosystem.entities.length,
      axes: (plan.axes.length || ecosystem.axes.length),
      candidateSources: candidateSources.length,
      validSources: validCount,
    },
    createdBy: request.auth?.token?.email || request.auth?.uid || null,
    createdAt: FieldValue.serverTimestamp(),
  };
  await firestoreDb().doc("config/onboardingDraft").set(draft, { merge: false });
  logger.info(`onboardCompany: brouillon écrit pour ${siteUrl} — ${ecosystem.entities.length} entités, ${candidateSources.length} sources (${validCount} valides).`);

  // serverTimestamp() n'est pas encore résolu dans l'objet local → renvoyer sans le sentinel.
  return { ...draft, createdAt: null };
});

/* ------------------------------------------------------------------------------------------- *
 * ONBOARDING AUTO (Phase 1, P4) — `applyOnboardingDraft` transforme le BROUILLON (revu/édité par un
 * humain, P5) en docs `config/*` de PRODUCTION + graines de veille, en une écriture atomique :
 *  - config/profile          ← brouillon.profile
 *  - config/veilleTaxonomy   ← axes + sous-types (omis si vides : on ne remplace pas un défaut par du vide)
 *  - frameworks/companyContext ← contexte + guidage classifieur + homonymie + concurrents cités
 *  - intelSources (graines)  ← sources candidates VALIDÉES (créées INACTIVES par défaut : revue avant sync)
 *  - intelWatchlist (graines) ← entités typées de l'écosystème
 * Exec-gated. Idempotent (ids de source/entité déterministes). Le front (P5) peut passer un brouillon
 * édité via data.draft ; sinon on applique le doc stocké. RIEN d'autre que ces docs n'est touché
 * (scoring/offerMapping/sourceAuthority restent aux défauts, non déductibles d'un site).
 * ------------------------------------------------------------------------------------------- */
exports.applyOnboardingDraft = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "appliquer la configuration d'onboarding");
  const db = firestoreDb();
  const data = request.data || {};
  let draft = data.draft && typeof data.draft === "object" ? data.draft : null;
  if (!draft) {
    const snap = await db.doc("config/onboardingDraft").get();
    if (!snap.exists) throw new HttpsError("failed-precondition", "Aucun brouillon d'onboarding à appliquer. Lancez d'abord onboardCompany.");
    draft = snap.data();
  }
  const built = buildConfigDocsFromDraft(draft);
  if (!built) throw new HttpsError("failed-precondition", "Brouillon incomplet (profil sans nom d'entreprise) — impossible à appliquer.");

  const seedSources = data.seedSources !== false;
  const seedWatchlist = data.seedWatchlist !== false;
  // Sources créées INACTIVES par défaut : une source qui synchronise doit être revue d'abord.
  const activateSources = data.activateSources === true;

  const batch = db.batch();
  batch.set(db.doc("config/profile"), built.profileDoc, { merge: true });
  if (Object.keys(built.taxonomyDoc).length) batch.set(db.doc("config/veilleTaxonomy"), built.taxonomyDoc, { merge: true });
  // Scoring & source authority dérivés du profil (Lot 4 multi-tenant) — écrits seulement si dérivés
  // (docs partiels ; mergeProfile conserve les autres défauts). Un client hors UEMOA obtient ainsi le
  // bonus géographique sur SES zones et l'autorité de SES régulateurs, au lieu des défauts CI.
  if (built.scoringDoc && Object.keys(built.scoringDoc).length) batch.set(db.doc("config/scoring"), built.scoringDoc, { merge: true });
  if (built.sourceAuthorityDoc && Object.keys(built.sourceAuthorityDoc).length) batch.set(db.doc("config/sourceAuthority"), built.sourceAuthorityDoc, { merge: true });
  // config/offerMapping dérivé par l'IA (mapping veille -> offres du client) — écrit si non vide ;
  // mergeProfile conserve managedMarkers/placeholderBu par défaut. Fait vivre la boucle veille->vente
  // pour un client non-IT (sinon les marqueurs Neurones ne matchaient aucune de ses offres).
  if (built.offerMappingDoc && Object.keys(built.offerMappingDoc).length) batch.set(db.doc("config/offerMapping"), built.offerMappingDoc, { merge: true });
  if (built.contextText) {
    batch.set(db.doc("frameworks/companyContext"), { content: { text: built.contextText }, source: "onboarding", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  let sourcesWritten = 0;
  if (seedSources) {
    for (const s of built.sources) {
      batch.set(db.doc(`intelSources/${s.id}`), {
        name: s.name, url: s.url, kind: s.kind, axis: s.axis || null,
        active: activateSources, source: "onboarding", createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      sourcesWritten += 1;
    }
  }
  let watchlistWritten = 0;
  if (seedWatchlist) {
    for (const w of built.watchlist) {
      batch.set(db.doc(`intelWatchlist/${w.id}`), {
        name: w.name, type: w.type, geo: w.geo || null, active: true, source: "onboarding",
      }, { merge: true });
      watchlistWritten += 1;
    }
  }
  batch.set(db.doc("config/onboardingDraft"), {
    status: "applied", appliedAt: FieldValue.serverTimestamp(), appliedBy: request.auth?.token?.email || request.auth?.uid || null,
  }, { merge: true });
  await batch.commit();

  // Relecture immédiate par les prochaines synchros (profil + contexte).
  invalidateCompanyContextCache();

  logger.info(`applyOnboardingDraft: config écrite (${built.profileDoc.companyName}) — ${sourcesWritten} sources${activateSources ? " actives" : " inactives"}, ${watchlistWritten} entités.`);
  // Webhook sortant : onboarding appliqué → événement de cycle de vie.
  await dispatchWebhookEvent(db, "account.event", {
    kind: "onboarding.completed",
    companyName: built.profileDoc.companyName || null,
    sourcesWritten,
    watchlistWritten,
    sourcesActive: activateSources,
  });
  return {
    ok: true,
    companyName: built.profileDoc.companyName,
    axes: (built.taxonomyDoc.axes || []).length,
    subtypes: (built.taxonomyDoc.subtypes || []).length,
    sourcesWritten,
    watchlistWritten,
    sourcesActive: activateSources,
  };
});

/* ------------------------------------------------------------------------------------------- *
 * Sync quanti interne depuis nt360 ("données internes disponibles dans une autre application",
 * 2026-07-02) — the internal P&L/LIVE/Facturation/fiche data lives in the SIBLING app nt360's
 * named Firestore database (same shared project), already parsed from its own Excel imports.
 * This reads nt360 STRICTLY READ-ONLY, maps its rows onto domain/quanti.js's shapes
 * (domain/nt360.js) and recomputes strategic360's `summaries/quanti` — the same doc/shape that
 * ingestInternal (the Storage-upload path, kept as a fallback) writes, so the quanti views
 * (Indicateurs/Valeur/Portefeuille/Simulateur) light up with no frontend change.
 * ------------------------------------------------------------------------------------------- */

const NT360_DATABASE_ID = process.env.NT360_DATABASE_ID || "nt360";
// Projet HÔTE de la base nt360. Vide (défaut) = même projet que le runtime — comportement projet
// partagé actuel, aucune régression. Renseigné (ex. "neurones-360" après migration) = la base nt360
// vit dans un AUTRE projet Google Cloud : on lit en cross-projet via un client Firestore explicitement
// projeté (ADC — le compte de service runtime doit détenir roles/datastore.viewer sur ce projet).
const NT360_PROJECT_ID = process.env.NT360_PROJECT_ID || "";
let cachedNt360Db = null;
/**
 * nt360Firestore() -> handle Firestore de la base nt360 (LECTURE SEULE par convention — ne jamais
 * écrire au travers). Sans NT360_PROJECT_ID : la base nommée nt360 du projet courant (getFirestore).
 * Avec NT360_PROJECT_ID : un client `@google-cloud/firestore` ciblant {projectId, databaseId:"nt360"}
 * dans l'autre projet (accès cross-projet post-migration).
 */
function nt360Firestore() {
  if (!NT360_PROJECT_ID) return getFirestore(NT360_DATABASE_ID);
  if (!cachedNt360Db) {
    cachedNt360Db = new Firestore({ projectId: NT360_PROJECT_ID, databaseId: NT360_DATABASE_ID });
  }
  return cachedNt360Db;
}

const {
  mapOrders: nt360MapOrders,
  mapOpportunities: nt360MapOpportunities,
  mapInvoices: nt360MapInvoices,
  mapBcLinesToSupplierRows: nt360MapBcLines,
  pickObjectives: nt360PickObjectives,
  pickCurrentFy: nt360PickCurrentFy,
  deriveCopiloteAccounts: nt360DeriveCopiloteAccounts,
  deriveBuAffinity: nt360DeriveBuAffinity,
  recommendNextOffers: nt360RecommendNextOffers,
  deriveBuBenchmark: nt360DeriveBuBenchmark,
  deriveAccountValue: nt360DeriveAccountValue,
  deriveAccountVeille: nt360DeriveAccountVeille,
  matchOffersToEvents: nt360MatchOffersToEvents,
  armDormantSignals: nt360ArmDormantSignals,
  deriveClientValueIndex: nt360DeriveClientValueIndex,
  resolveAccountValue: nt360ResolveAccountValue,
  matchSignalsToAccount: nt360MatchSignalsToAccount,
  copiloteAccountMatchesScope: nt360AccountMatchesScope,
  isMeaningfulBu: nt360IsMeaningfulBu,
} = require("./domain/nt360");

async function runInternalQuantiSync(db) {
  const src = nt360Firestore(); // READ-ONLY — never write through this handle (cross-projet si NT360_PROJECT_ID)

  const [ordersSnap, oppsSnap, invoicesSnap, bcLinesSnap, objectivesSnap, configSnap] = await Promise.all([
    src.collection("orders").get(),
    src.collection("opportunities").get(),
    src.collection("invoices").get(),
    src.collection("bcLines").get(),
    src.collection("objectives").get(),
    src.collection("config").get(),
  ]);
  const docsOf = (snap) => snap.docs.map((d) => d.data());

  const currentFy = nt360PickCurrentFy(docsOf(configSnap), new Date().getFullYear());
  const orders = nt360MapOrders(docsOf(ordersSnap), currentFy);
  const opportunities = nt360MapOpportunities(docsOf(oppsSnap));
  const invoices = nt360MapInvoices(docsOf(invoicesSnap));
  const supplierRows = nt360MapBcLines(docsOf(bcLinesSnap));
  const objectives = nt360PickObjectives(docsOf(objectivesSnap), currentFy);

  // Same summary shape as computeSummaryQuanti (the Excel path), with two sourcing differences
  // documented here: supplier concentration comes from nt360's bcLines purchase ledger (its
  // orders' `suppliers` arrays are empty in practice), and those purchase pseudo-rows are kept
  // OUT of computeBcg/computeCasSummary (purchases are not revenue).
  const porterForces = {
    ...computePorterForces({ orders: supplierRows, opportunities }),
  };
  const bcg = computeBcg({ orders });
  const { casTotal, casN1Total } = computeCasSummary({ orders });
  const { pipelinePondere, realise: pipelineRealise, winRate } = computePipeline({ opportunities });
  const kris = computeKris({ orders: supplierRows, opportunities, invoices });
  const valueAtStake = computeValueAtStake({ opportunities });
  const granularite = computeGranularite({ orders });

  const summary = {
    porterForces,
    bcg,
    granularite,
    ge9: null, // still not derivable — needs an external market-attractiveness axis
    casTotal,
    casN1Total,
    pipelinePondere,
    pipelineRealise, // CA déjà gagné (Gagné) — exposé à part du pondéré (prévision = affaires ouvertes)
    winRate,
    marginAvg: null, // see computeSummaryQuanti's comment — formula unspecified beyond BCG's per-BU marge
    supplierSaturation: porterForces.pouvoirFournisseurs,
    recurrentShare: null, // récurrent/projet tag still absent from nt360's orders/opportunities
    kris,
    valueAtStake,
    objectives, // nt360 targets (targetCas/targetInvoiced/targetMargin) for future realized-vs-target UI
    source: `nt360 (fy=${currentFy})`,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.doc("summaries/quanti").set(summary);

  const counts = {
    orders: ordersSnap.size,
    opportunities: oppsSnap.size,
    invoices: invoicesSnap.size,
    bcLines: bcLinesSnap.size,
    casTotal,
    pipelinePondere,
    winRate,
  };
  logger.info(`runInternalQuantiSync: summaries/quanti recomputed from nt360 — ${JSON.stringify(counts)}`);
  return counts;
}

/**
 * syncInternalQuanti — Scheduler (quotidien 05:30 Africa/Abidjan, avant l'ouverture) : recalcule
 * summaries/quanti depuis la base nt360. nt360 est lui-même réalimenté par ses propres imports
 * Excel — une fraîcheur quotidienne suffit ; forçage à la demande via syncInternalQuantiNow ou le
 * workflow GHA run-quanti-now.yml.
 */
exports.syncInternalQuanti = onSchedule(
  { schedule: "30 5 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    await runInternalQuantiSync(firestoreDb());
  }
);

/** syncInternalQuantiNow — callable exec-gated (même patron que syncSourcesNow/enrichNow). */
exports.syncInternalQuantiNow = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "synchroniser les données internes (nt360)");
  const result = await runInternalQuantiSync(firestoreDb());
  logger.info(`syncInternalQuantiNow: caller=${request.auth.uid} result=${JSON.stringify(result)}`);
  return result;
});

// Émission proactive d'opportunités (Phase 4) — garde-fous contre la surcharge (risques audit) :
// plancher de matérialité (on n'émet pas un lead de cross-sell dérisoire) et plafond global (ne pas
// noyer le pipeline suivi avec ~1600 leads auto sur 800 comptes).
const AUTO_OPP_FLOOR = 5_000_000; // XOF : montant d'ancrage minimum pour émettre un lead
const AUTO_OPP_MAX = 60;          // nombre max de leads proactifs par synchro (les plus gros d'abord)

/**
 * runSyncCopiloteAccounts — pré-remplit l'empreinte des comptes du Copilote depuis nt360 (read-only).
 * ADDITIF : écrit uniquement `nom` + le sous-objet `nt360` (historique/enCours/casTotal/pipeline) par
 * merge — les champs qualitatifs saisis par le commercial (enjeux, whitespace, tier, contacts…) ne
 * sont JAMAIS touchés. Clé = slug(client) → déduplique avec les comptes créés à la main.
 */
async function runSyncCopiloteAccounts(db) {
  const src = nt360Firestore(); // READ-ONLY (cross-projet si NT360_PROJECT_ID)
  const [ordersSnap, oppsSnap] = await Promise.all([
    src.collection("orders").get(),
    src.collection("opportunities").get(),
  ]);
  const derived = nt360DeriveCopiloteAccounts(
    ordersSnap.docs.map((d) => d.data()),
    oppsSnap.docs.map((d) => d.data())
  );
  // Méta portefeuille calculée AVANT la persistance des comptes (audit doubler-CA) : on en a besoin
  // pour chiffrer et persister la réserve de valeur PAR compte (whitespace/upsell/score), plus seulement
  // à la volée dans un prompt. Catalogue d'offres = union des BU réelles ; affinité market-basket ;
  // panier de référence médian par offre.
  const buCatalog = [...new Set(derived.flatMap((acc) => Array.isArray(acc.bus) ? acc.bus : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))].sort();
  const affinity = nt360DeriveBuAffinity(derived);
  const buBenchmark = nt360DeriveBuBenchmark(derived);
  const meta = { buCatalog, affinity, buBenchmark };
  // Profil client (Phase 0 produit) : surcharge éventuelle du mapping événement de veille → famille
  // d'offre. Absent → défaut Neurones (aucun changement de comportement).
  const clientProfile = await loadClientProfile(db);
  const offerMarkers = clientProfile.offerMapping.subtypeOfferMarkers;
  const todayIso = new Date().toISOString().slice(0, 10);
  await db.doc("summaries/copiloteMeta").set(
    { buCatalog, affinity, buBenchmark, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  // BOUCLE VEILLE → ACTION (direction C, « de la veille à la vente ») : on lit les signaux de veille
  // externes du strategic360 pour les RATTACHER à chaque compte au sync. C'est ce qui rebranche les
  // moteurs commerciaux sur la veille (au lieu de tourner sur la seule donnée interne). Borné aux plus
  // prioritaires pour le coût (le matching est ensuite fait par compte).
  let intelItems = [];
  try {
    const intelSnap = await db.collection("intelItems").orderBy("priorityScore", "desc").limit(500).get();
    intelItems = intelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    logger.warn(`runSyncCopiloteAccounts: lecture intelItems impossible (${e.message}) — comptes sans déclencheurs de veille`);
  }

  // Écriture par lots (audit Copilote 2026-07) : le portefeuille réel compte ~800 comptes. Un
  // `await set()` par compte = ~800 allers-retours séquentiels (lent, et fragile à mesure que le
  // portefeuille grossit). On commit par lots de 400 (< la limite Firestore de 500 ops/commit) :
  // 2 allers-retours au lieu de 800. Merge additif inchangé (les champs qualitatifs restent intacts).
  const CHUNK = 400;
  let written = 0;
  let reserveTotale = 0; // Σ potentiel cross-sell chiffré du portefeuille (KPI « réserve »)
  let recurrentCasTot = 0;
  let casTot = 0;
  let churnCount = 0;    // comptes avec ≥1 offre dormante matérielle (récurrent qui s'éteint)
  let churnMontant = 0;  // Σ du CAS annuel des offres dormantes
  const autoOppCandidates = []; // opportunités cross-sell/upsell à émettre dans le pipeline suivi
  // Attribution par compte (audit 4 zones 2026-07) : le 1er AM connu du compte devient le proprietaire
  // par defaut de l'opportunite auto-emise — sinon elle partait sans owner ni echeance (invisible dans
  // « Mon equipe », jamais relancee). L'humain peut toujours reassigner (garde anti-ecrasement plus bas).
  const ownerBySlug = new Map();
  for (let i = 0; i < derived.length; i += CHUNK) {
    const slice = derived.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const acc of slice) {
      if (!ownerBySlug.has(acc.slug)) ownerBySlug.set(acc.slug, [...(acc.ams || [])][0] || null);
      // Réserve de valeur chiffrée et PERSISTÉE (visible sans lancer une génération IA).
      const val = nt360DeriveAccountValue(acc, meta, todayIso);
      reserveTotale += val.whitespacePotential;
      recurrentCasTot += val.recurrentCas;
      casTot += Number(acc.casTotal) || 0;
      // Boucle veille → action : rattache les signaux de veille externes au compte et les FUSIONNE
      // dans la file « à traiter » (un déclencheur externe fait remonter le compte). C'est ce qui
      // pilote la vente PAR la veille, pas seulement par la donnée interne.
      const veille = nt360DeriveAccountVeille(acc.nom, intelItems, todayIso);
      // Cross-sell/upsell DÉCLENCHÉ PAR ÉVÉNEMENT : croise les signaux de veille avec les offres de
      // réserve du compte → une offre devient « opportune maintenant » (la veille pilote la vente).
      const offersForEvents = [
        ...val.whitespaceValue.map((w) => ({ offre: w.offre, montant: w.montant, kind: "cross-sell" })),
        ...val.upsellByOffre.map((u) => ({ offre: u.offre, montant: u.montant, kind: "upsell" })),
      ];
      const eventOffers = nt360MatchOffersToEvents(veille.top, offersForEvents, offerMarkers).slice(0, 3);
      val.eventOffers = eventOffers;
      const eventByOffre = new Map(eventOffers.map((e) => [e.offre, e.event]));
      // Relance churn ARMÉE par la veille (levier RÉCURRENCE) : une offre dormante devient prioritaire
      // quand un événement rouvre sa fenêtre. On arme AVANT de tronquer/préfixer les signaux.
      val.signals = nt360ArmDormantSignals(val.signals, veille, eventOffers);
      // Le meilleur déclencheur de veille est FUSIONNÉ en tête des signaux d'action.
      if (veille.top.length) {
        const t = veille.top[0];
        val.signals = [
          { type: "veille", montant: 0, hot: veille.hot, prox: t.prox, impact: t.impact, label: `Signal de veille : ${t.title}` },
          ...val.signals,
        ].slice(0, 5);
      }
      // Agrégat de churn (dormance matérielle) pour la bannière « récurrent qui s'éteint ».
      const dormantes = (val.signals || []).filter((s) => s.type === "dormante");
      if (dormantes.length) { churnCount += 1; churnMontant += dormantes.reduce((s, x) => s + (x.montant || 0), 0); }
      // Candidats d'opportunités PROACTIVES (Phase 4) : la meilleure offre de cross-sell et le meilleur
      // upsell chiffrés du compte deviennent des leads du pipeline suivi (qualifiable → action).
      const topXs = (val.whitespaceValue || [])[0];
      if (topXs && topXs.montant >= AUTO_OPP_FLOOR) autoOppCandidates.push({ kind: "cross-sell", slug: acc.slug, client: acc.nom, offre: topXs.offre, montant: topXs.montant, event: eventByOffre.get(topXs.offre) || null });
      const topUp = (val.upsellByOffre || [])[0];
      if (topUp && topUp.montant >= AUTO_OPP_FLOOR) autoOppCandidates.push({ kind: "upsell", slug: acc.slug, client: acc.nom, offre: topUp.offre, montant: topUp.montant, event: eventByOffre.get(topUp.offre) || null });
      // Bascule vers le récurrent (levier RÉCURRENCE) : le meilleur passage managé/OPEX chiffré en ARR.
      if (val.managedReco && val.managedReco.arr >= AUTO_OPP_FLOOR) autoOppCandidates.push({ kind: "managed", slug: acc.slug, client: acc.nom, offre: val.managedReco.offre, montant: val.managedReco.arr, event: eventByOffre.get(val.managedReco.offre) || null });
      // Offres DÉCLENCHÉES par un événement de veille : émises même si ce n'est pas le plus gros montant
      // du compte (le timing externe prime). Dédupliquées à l'émission par id déterministe.
      for (const eo of eventOffers) {
        if (eo.montant >= AUTO_OPP_FLOOR) autoOppCandidates.push({ kind: eo.kind, slug: acc.slug, client: acc.nom, offre: eo.offre, montant: eo.montant, event: eo.event });
      }
      // Relance d'un récurrent dormant ARMÉE par la veille : la fenêtre est rouverte → lead de relance.
      for (const s of val.signals) {
        if (s.type === "dormante" && s.armed && s.offre && (s.montant || 0) >= AUTO_OPP_FLOOR) {
          autoOppCandidates.push({ kind: "relance", slug: acc.slug, client: acc.nom, offre: s.offre, montant: s.montant, event: s.triggerEvent || null });
        }
      }
      batch.set(
        db.doc(`copiloteAccounts/${acc.slug}`),
        {
          nom: acc.nom,
          nt360: {
            historique: acc.historique,
            enCours: acc.enCours,
            casTotal: acc.casTotal,
            pipelinePondere: acc.pipelinePondere,
            wins: acc.wins,
            opportunites: acc.opportunites,
            ams: acc.ams,
            bus: acc.bus,
            // Réserve de valeur chiffrée (audit doubler-CA — leviers PANIER/COUVERTURE) :
            whitespaceValue: val.whitespaceValue, // [{offre, montant}] cross-sell chiffré au panier fiable
            whitespacePotential: val.whitespacePotential,
            upsellHeadroom: val.upsellHeadroom, // marge d'upsell sur offres déjà détenues
            upsellByOffre: val.upsellByOffre,
            scorePotentiel: val.scorePotentiel, // classe par potentiel non capté, pas par taille
            signals: val.signals, // dormance/deal fantôme/point mort + signal de veille → file « à traiter »
            managedReco: val.managedReco ?? null, // bascule projet ponctuel → récurrent managé/OPEX
            veille, // déclencheurs de veille externes rattachés (boucle veille → action)
            eventOffers: val.eventOffers || [], // offres rendues opportunes par un événement de veille
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
    }
    await batch.commit();
    written += slice.length;
  }
  // Agrégats portefeuille exposés au dashboard (réserve cross-sell + part récurrente + churn).
  const recurrentShare = casTot > 0 ? Math.round((recurrentCasTot / casTot) * 100) : null;
  await db.doc("summaries/copiloteMeta").set(
    {
      reserveCrossSell: Math.round(reserveTotale),
      recurrentShare,
      churn: { comptes: churnCount, montant: Math.round(churnMontant) }, // récurrent en train de s'éteindre
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Index de VALEUR COMMERCIALE par client (boucle interne → veille) : le scoring des signaux de
  // veille s'en sert pour faire remonter ceux qui concernent les gros comptes (accountValueFactor).
  const clientValue = nt360DeriveClientValueIndex(derived);
  await db.doc("summaries/copiloteClientValue").set(
    { index: clientValue, count: Object.keys(clientValue).length, updatedAt: FieldValue.serverTimestamp() },
    { merge: false }
  );

  // MOTEUR PROACTIF (Phase 4) : émettre les meilleures opportunités cross-sell/upsell chiffrées dans
  // le pipeline SUIVI (bizOpportunities) → elles rejoignent la boucle qualifier → convertir en action.
  // Garde-fous (risques audit) : plafond global pour ne pas noyer le commercial ; plancher de
  // matérialité ; statut humain (qualified/dropped) JAMAIS écrasé (merge sans `status` si le doc existe).
  // Dédup par id déterministe (un événement peut repousser une offre déjà candidate) — on garde la
  // variante qui porte un événement (timing externe). Puis tri : DÉCLENCHÉ PAR LA VEILLE d'abord
  // (le timing prime sur le montant), ensuite par montant.
  const byId = new Map();
  for (const c of autoOppCandidates) {
    const offreSlug = String(c.offre).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const id = `auto-${c.kind}-${c.slug}-${offreSlug}`.slice(0, 250);
    const prev = byId.get(id);
    if (!prev || (!prev.event && c.event)) byId.set(id, { ...c, id });
  }
  const autoOpps = [...byId.values()]
    .sort((a, b) => (b.event ? 1 : 0) - (a.event ? 1 : 0) || b.montant - a.montant)
    .slice(0, AUTO_OPP_MAX);
  let oppsWritten = 0;
  for (const cand of autoOpps) {
    const ref = db.doc(`bizOpportunities/${cand.id}`);
    const existing = await ref.get();
    const kindLabel = cand.kind === "upsell" ? "Upsell" : cand.kind === "managed" ? "Passage en managé" : cand.kind === "relance" ? "Relance" : "Cross-sell";
    const baseAction = cand.kind === "upsell"
      ? `Étendre ${cand.offre} (compte sous-pénétré vs panier de référence)`
      : cand.kind === "managed"
        ? `Convertir en récurrent : proposer ${cand.offre} en managé/OPEX (ARR ≈ panier de référence)`
        : cand.kind === "relance"
          ? `Relancer ${cand.offre} (récurrent dormant, fenêtre rouverte)`
          : `Chiffrer et proposer ${cand.offre} (panier de référence réel)`;
    // Déclenchée par un événement de veille : on référence l'événement et on relève l'urgence.
    const nextAction = cand.event ? `⚡ ${cand.event} → ${baseAction}` : baseAction;
    // Échéance PROPOSÉE dérivée de l'horizon (audit 4 zones 2026-07) : événement de veille → J+7,
    // sinon J+30. Donne une date d'action des l'emission (le quadrant « Faire maintenant » et « Mon
    // equipe » deviennent alimentes) ; l'humain la reprécise à la qualification.
    const nextActionDate = new Date(Date.now() + (cand.event ? 7 : 30) * 86400000).toISOString().slice(0, 10);
    // `bu` seulement si l'offre est une BU RÉELLE du catalogue (audit 4 zones 2026-07) : sinon le badge
    // PlanAction affichait une valeur hors-type. À défaut, on garde `offering` (libellé libre) seul.
    const buReal = buCatalog.includes(cand.offre) ? cand.offre : null;
    const payload = {
      name: `${kindLabel} ${cand.offre} — ${cand.client}`,
      client: cand.client,
      offering: cand.offre,
      estAmount: String(Math.round(cand.montant)),
      horizon: cand.event ? "court" : "moyen",       // événement → fenêtre plus courte
      probability: cand.event ? "high" : "medium",    // événement → probabilité relevée (timing)
      nextAction,
      triggerEvent: cand.event || null,               // événement de veille déclencheur (traçabilité)
      source: cand.kind,       // 'cross-sell' | 'upsell' | 'managed' — origine du lead
      generatedBy: "sync",     // ni IA (enrichissement veille) ni humain : dérivé du portefeuille
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (buReal) payload.bu = buReal;
    if (existing.exists) {
      // Ne jamais écraser ce qu'un humain a qualifié : statut, propriétaire réassigné, échéance reprécisée.
      delete payload.status;
    } else {
      payload.status = "new";
      const owner = ownerBySlug.get(cand.slug);
      if (owner) payload.owner = owner;
      payload.nextActionDate = nextActionDate;
    }
    await ref.set(payload, { merge: true });
    oppsWritten += 1;
  }

  logger.info(`runSyncCopiloteAccounts: ${written} comptes (catalogue ${buCatalog.length} offres ; réserve ≈ ${Math.round(reserveTotale)} ; récurrent ${recurrentShare ?? "n.c."}% ; churn ${churnCount} comptes ; ${oppsWritten} opps proactives émises)`);
  return { accounts: written, buCatalog: buCatalog.length, reserveCrossSell: Math.round(reserveTotale), recurrentShare, autoOpportunities: oppsWritten };
}

exports.syncCopiloteAccounts = onSchedule(
  { schedule: "45 5 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    await runSyncCopiloteAccounts(firestoreDb());
  }
);

/** syncCopiloteAccountsNow — callable (rôles commerciaux + exec) pour forcer le pré-remplissage. */
exports.syncCopiloteAccountsNow = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireCommercialCaller(request, "synchroniser les comptes du copilote");
  const result = await runSyncCopiloteAccounts(firestoreDb());
  logger.info(`syncCopiloteAccountsNow: caller=${request.auth.uid} result=${JSON.stringify(result)}`);
  return result;
});

/* ------------------------------------------------------------------------------------------- *
 * Cloisonnement du portefeuille Copilote (décision 2026-07 : « mix des 3 » — override manuel /
 * account manager nt360 / BU ; exec + directeurs commerciaux voient tout, seul le rôle
 * « commercial » simple est cloisonné). La lecture passe par un callable côté serveur (Admin SDK)
 * qui applique le périmètre — impossible à contourner par une requête client directe (verrouillé
 * aussi par firestore.rules). Bonus : règle aussi le point d'audit « ne pas streamer 800 docs ».
 * ------------------------------------------------------------------------------------------- */

// COPILOTE_UNSCOPED_ROLES importé depuis domain/rbac.js (source unique) — rôles non cloisonnés.

/**
 * listCopiloteAccounts — callable. Retourne les comptes visibles par l'appelant :
 *  - exec / commercial_dir : tout le portefeuille ;
 *  - commercial : uniquement les comptes de son périmètre (owners e-mail, am, ou BU depuis son
 *    profil copiloteProfiles/{uid}).
 */
exports.listCopiloteAccounts = onCall(CALLABLE_OPTS, async (request) => {
  requireCommercialCaller(request, "consulter les comptes du copilote");
  const db = firestoreDb();
  const role = request.auth?.token?.role;
  const snap = await db.collection("copiloteAccounts").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const unscoped = COPILOTE_UNSCOPED_ROLES.includes(role);
  logger.info(`listCopiloteAccounts: uid=${request.auth.uid} role=${role} unscoped=${unscoped} totalDocs=${all.length}`);
  if (unscoped) return { accounts: all, scoped: false };
  // Périmètre du commercial : e-mail (token/owners) + am/bu de son profil (clé = e-mail : pas de
  // répertoire d'utilisateurs dans l'app, l'admin définit le périmètre par e-mail, plus simple qu'un uid).
  const email = (request.auth?.token?.email || "").trim().toLowerCase();
  const profSnap = email ? await db.doc(`copiloteProfiles/${email}`).get() : null;
  const prof = profSnap && profSnap.exists ? profSnap.data() : {};
  const scope = {
    uid: request.auth.uid,
    email,
    ams: Array.isArray(prof.ams) ? prof.ams : [],
    bus: Array.isArray(prof.bus) ? prof.bus : [],
  };
  const accounts = all.filter((a) => nt360AccountMatchesScope(a, scope));
  return { accounts, scoped: true };
});

/** Rôles autorisés à administrer le cloisonnement (profils + owners). */
function requireCopiloteAdmin(request, action) {
  const role = request.auth?.token?.role;
  const allowed = ["commercial_dir", "direction"];
  if (!request.auth || !allowed.includes(role)) {
    throw new HttpsError("permission-denied", `Seuls la Direction et les directeurs commerciaux peuvent ${action}.`);
  }
}
const coerceStrList = (v) =>
  Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))] : [];

/**
 * copiloteAdmin — callable UNIQUE (direction / commercial_dir) regroupant l'administration du
 * cloisonnement (un seul déploiement Cloud Run au lieu de deux — le projet partagé est proche de
 * son quota CPU/région). data.action :
 *  - "setScope"  : { uid, ams?, bus? }        → copiloteProfiles/{uid} (périmètre d'un commercial) ;
 *  - "setOwners" : { accountId, owners: [] }  → copiloteAccounts/{id}.owners (attribution manuelle).
 * `owners`/`copiloteProfiles` sont des champs SERVEUR (interdits d'écriture client par les règles).
 */
exports.copiloteAdmin = onCall(CALLABLE_OPTS, async (request) => {
  requireCopiloteAdmin(request, "administrer le cloisonnement du copilote");
  const { action } = request.data || {};
  const db = firestoreDb();
  if (action === "setScope") {
    const { email, ams, bus } = request.data || {};
    const key = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!key || key.includes("/")) throw new HttpsError("invalid-argument", "email (valide) requis.");
    await db.doc(`copiloteProfiles/${key}`).set(
      { email: key, ams: coerceStrList(ams), bus: coerceStrList(bus), updatedBy: request.auth.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    logger.info(`copiloteAdmin setScope: email=${key} by=${request.auth.uid}`);
    return { email: key, ams: coerceStrList(ams), bus: coerceStrList(bus) };
  }
  if (action === "setOwners") {
    const { accountId, owners } = request.data || {};
    assertAccountId(accountId);
    if (!accountId) throw new HttpsError("invalid-argument", "accountId requis.");
    const list = coerceStrList(owners).map((x) => x.toLowerCase());
    await db.doc(`copiloteAccounts/${accountId}`).set(
      { owners: list, ownersUpdatedBy: request.auth.uid, ownersUpdatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    logger.info(`copiloteAdmin setOwners: account=${accountId} owners=${list.length} by=${request.auth.uid}`);
    return { accountId, owners: list };
  }
  throw new HttpsError("invalid-argument", `action inconnue : ${action}`);
});

/**
 * exportPdf — callable (BUILD_KIT.md §10 "board pack / one-pager PDF (pdfkit) → Storage (URL
 * signée)").
 *
 * data: { briefingId?: string } — if omitted, exports the most recently created briefing. Builds
 * the PDF with `domain/pdf.js#buildBriefingPdf` (pure, unit-tested — see
 * functions/test/exportPdf.test.js), uploads the buffer to Cloud Storage under
 * `exports/{briefingId}.pdf`, and returns a signed read URL. NOT independently verifiable in this
 * sandbox (no GCS credentials/network) — the PDF *content* generation is verified for real by
 * exportPdf.test.js; only the Storage upload/signed-URL plumbing below is unverified.
 * Roadmap: V7 IA & sync.
 */
exports.exportPdf = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "exporter un briefing en PDF");

  const db = firestoreDb();
  const { briefingId } = request.data || {};

  let ref;
  let briefing;
  if (typeof briefingId === "string" && briefingId) {
    ref = db.doc(`briefings/${briefingId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", `briefings/${briefingId} introuvable.`);
    briefing = snap.data();
  } else {
    const latestSnap = await db.collection("briefings").orderBy("createdAt", "desc").limit(1).get();
    if (latestSnap.empty) {
      throw new HttpsError("failed-precondition", "Aucun briefing disponible — générez-en un d'abord (generateBriefing).");
    }
    ref = latestSnap.docs[0].ref;
    briefing = latestSnap.docs[0].data();
  }

  const buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    buildBriefingPdf(doc, briefing);
    doc.end();
  });

  const bucket = defaultBucket();
  const filePath = `exports/${ref.id}.pdf`;
  const file = bucket.file(filePath);
  await file.save(buffer, { contentType: "application/pdf" });

  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  logger.info(`exportPdf: uploaded ${filePath} caller=${request.auth.uid}`);
  return { url: signedUrl, path: filePath };
});

/**
 * scheduledFirestoreExport — Scheduler (quotidien 02:00, Africa/Abidjan) (V8 Durcissement,
 * BUILD_KIT.md §13 "export Firestore planifié").
 *
 * Uses the Firestore Admin API's managed export (`google.firestore.admin.v1.FirestoreAdminClient
 * #exportDocuments`, from `@google-cloud/firestore`'s `v1` namespace — DISTINCT from the regular
 * document-CRUD client used everywhere else) to snapshot THIS APP's database to Cloud Storage.
 *
 * ISOLATION (audit pré-lancement/intégral 2026-07, M1/M6/m8) — corrigé, ne plus décrire autrement :
 *   - la base exportée est `FIRESTORE_DATABASE_ID` (celle de CETTE app), JAMAIS "(default)" (qui
 *     appartiendrait à une autre app du projet PARTAGÉ) ;
 *   - la cible est le bucket DÉDIÉ `FIRESTORE_EXPORT_BUCKET`, JAMAIS le bucket appspot par défaut
 *     (partagé) — il n'existe AUCUN fallback ;
 *   - si `FIRESTORE_EXPORT_BUCKET` n'est pas configuré, l'export est SAUTÉ (log `error`, aucune
 *     écriture) plutôt que d'écrire dans un bucket commun. Un déploiement de prod DOIT donc poser
 *     cette variable pour avoir une sauvegarde (voir README « Checklist de déploiement »).
 * Sortie : `gs://{FIRESTORE_EXPORT_BUCKET}/scheduled-exports/{YYYY-MM-DD}/` (dossier daté par run).
 *
 * UNVERIFIABLE IN THIS SANDBOX : pas de projet GCP réel ni d'émulateur d'export managé ici — non
 * exercé de bout en bout ; implémenté selon la surface d'API documentée et défensif (toute erreur
 * est catchée/loggée en `error`, jamais throw : un job de maintenance planté ne doit pas passer
 * pour un incident utilisateur).
 *
 * Prérequis de déploiement (console/gcloud — voir README « Checklist de déploiement ») :
 *   - Firestore Admin API activée (généralement par défaut) ;
 *   - le compte de service des Functions a `roles/datastore.importExportAdmin` sur le projet ;
 *   - le bucket `FIRESTORE_EXPORT_BUCKET` existe, dédié à cette app, avec accès en écriture pour ce
 *     même compte de service.
 */
exports.scheduledFirestoreExport = onSchedule(
  { schedule: "0 2 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1" },
  async () => {
    try {
      // Audit pré-lancement 2026-07 (M1) : l'export doit viser LA base de CETTE app (jamais
      // "(default)", qui appartient potentiellement à une autre app du projet partagé) et un
      // bucket DÉDIÉ explicite (jamais le bucket appspot par défaut, lui aussi partagé). Sans
      // bucket configuré, on n'exporte PAS (mieux vaut un backup manquant signalé qu'une fuite
      // des données d'un tiers vers un bucket commun).
      const exportBucket = process.env.FIRESTORE_EXPORT_BUCKET;
      if (!exportBucket) {
        logger.error("scheduledFirestoreExport: FIRESTORE_EXPORT_BUCKET non configuré — export SAUTÉ (configurer un bucket dédié à l'app).");
        return;
      }
      const client = new firestoreAdminV1.FirestoreAdminClient();
      const projectId = await client.getProjectId();
      const dateFolder = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const outputUriPrefix = `gs://${exportBucket}/scheduled-exports/${dateFolder}`;
      const databaseName = client.databasePath(projectId, FIRESTORE_DATABASE_ID);

      const [operation] = await client.exportDocuments({
        name: databaseName,
        outputUriPrefix,
        // Empty collectionIds = export ALL collections (per API docs: omitted/empty means "all").
        collectionIds: [],
      });

      logger.info(
        `scheduledFirestoreExport: export started — operation=${operation?.name ?? "unknown"} target=${outputUriPrefix}`
      );
    } catch (err) {
      // Defensive by design: a scheduled backup job failing must never look like a production
      // incident to end users — it just means the daily export didn't happen, logged for whoever
      // monitors Cloud Logging/alerts on this function.
      logger.error(`scheduledFirestoreExport: FAILED — ${err.message}`, { err });
    }
  }
);

/**
 * purgeAuditLog — RÉTENTION des données personnelles (audit intégral 2026-07, m15). `auditLog`
 * accumule uid/e-mail/action des salariés sans limite ; la Loi ivoirienne 2013-450 (et le RGPD pour
 * un déploiement UE) imposent une durée de conservation bornée. On purge chaque semaine les entrées
 * plus vieilles que `AUDITLOG_RETENTION_DAYS` (défaut 730 j = 2 ans). Best-effort, borné par lots.
 * NB : `copiloteProfiles` (périmètres commerciaux) n'est PAS auto-purgé — ce sont des données de
 * config ACTIVES ; leur suppression est manuelle au départ d'un collaborateur (documenté README).
 */
const AUDITLOG_RETENTION_DAYS = Number(process.env.AUDITLOG_RETENTION_DAYS) || 730;
exports.purgeAuditLog = onSchedule(
  { schedule: "0 3 * * 0", timeZone: TENANT_TIMEZONE, region: "europe-west1" },
  async () => {
    try {
      const db = firestoreDb();
      const cutoff = new Date(Date.now() - AUDITLOG_RETENTION_DAYS * 24 * 3600 * 1000);
      let deleted = 0;
      // Boucle bornée : jusqu'à 20 lots de 400 (8000 docs max/run) — suffisant pour une purge
      // hebdomadaire, sans risquer le timeout.
      for (let i = 0; i < 20; i++) {
        const snap = await db.collection("auditLog").where("ts", "<", cutoff).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 400) break;
      }
      if (deleted) logger.info(`purgeAuditLog: ${deleted} entrées auditLog > ${AUDITLOG_RETENTION_DAYS} j supprimées.`);
    } catch (err) {
      logger.error(`purgeAuditLog: FAILED — ${err.message}`, { err });
    }
  }
);

/**
 * purgeArchivedIntelItems — RÉTENTION des signaux ARCHIVÉS (audit intégral 2026-07, m11). Les items
 * dédoublonnés/écartés passent en `status:"archived"` mais restent physiquement en base : chaque
 * lecture full-collection (index anti-doublon, agrégats) les relit, si bien que le coût/latence de
 * lecture croît indéfiniment avec l'historique cumulé. Cette purge hebdomadaire supprime les archivés
 * plus vieux que `INTELITEMS_ARCHIVE_RETENTION_DAYS`.
 *
 * SÉCURITÉ : DÉSACTIVÉE PAR DÉFAUT (flag à 0 = aucune suppression, comportement inchangé). L'opérateur
 * doit poser explicitement INTELITEMS_ARCHIVE_RETENTION_DAYS (>0, ex. 365) pour activer la purge —
 * suppression de données volontairement opt-in. Requête sur le seul champ `status` (index simple par
 * défaut, aucun index composite à déployer) ; filtrage de l'ancienneté en mémoire ; bornée par lots.
 * Ne touche QUE les `archived` (jamais un signal encore `new`/`pending`/`published`).
 */
const INTELITEMS_ARCHIVE_RETENTION_DAYS = Number(process.env.INTELITEMS_ARCHIVE_RETENTION_DAYS) || 0;
exports.purgeArchivedIntelItems = onSchedule(
  { schedule: "30 3 * * 0", timeZone: TENANT_TIMEZONE, region: "europe-west1" },
  async () => {
    if (!(INTELITEMS_ARCHIVE_RETENTION_DAYS > 0)) {
      logger.info("purgeArchivedIntelItems: rétention désactivée (INTELITEMS_ARCHIVE_RETENTION_DAYS non défini) — aucune suppression.");
      return;
    }
    try {
      const db = firestoreDb();
      const cutoffMs = Date.now() - INTELITEMS_ARCHIVE_RETENTION_DAYS * 24 * 3600 * 1000;
      const toMs = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : (typeof ts === "number" ? ts : null)));
      let deleted = 0;
      // PAGINATION par curseur sur l'id de document (audit final pré-prod 2026-07) : l'ancienne boucle
      // relisait toujours les 400 MÊMES archivés (tri __name__ implicite, sans curseur) et cassait dès
      // qu'un lot ne contenait aucun périmé — les vieux archivés dont l'id trie APRÈS n'étaient jamais
      // atteints, la rétention n'était pas honorée. On parcourt désormais TOUTE la collection archivée
      // page par page (startAfter), en filtrant l'ancienneté en mémoire (updatedAt sinon createdAt) pour
      // éviter un index composite status+updatedAt. Borne dure à 50 pages (~20 000 docs/run) en garde-fou.
      let lastDoc = null;
      for (let i = 0; i < 50; i++) {
        let q = db.collection("intelItems").where("status", "==", "archived").orderBy(FieldPath.documentId()).limit(400);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        if (snap.empty) break;
        const stale = snap.docs.filter((d) => {
          const data = d.data() || {};
          const ms = toMs(data.updatedAt) ?? toMs(data.createdAt);
          return ms != null && ms < cutoffMs;
        });
        if (stale.length) {
          const batch = db.batch();
          stale.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          deleted += stale.length;
        }
        lastDoc = snap.docs[snap.docs.length - 1]; // curseur = dernier doc lu (périmé ou non)
        if (snap.size < 400) break; // dernière page atteinte
      }
      if (deleted) logger.info(`purgeArchivedIntelItems: ${deleted} intelItems archivés > ${INTELITEMS_ARCHIVE_RETENTION_DAYS} j supprimés.`);
    } catch (err) {
      logger.error(`purgeArchivedIntelItems: FAILED — ${err.message}`, { err });
    }
  }
);

/**
 * setUserRole — callable (admin `direction`)
 * Pose le custom claim `role` + audit (BUILD_KIT.md §7/§10).
 *
 * Admin-only: the caller must carry the `direction` custom claim — EXCEPT for a one-time
 * bootstrap: if no `direction` user has ever been provisioned (tracked by `config/bootstrap`),
 * the very first call is allowed to create that first `direction` account, after which
 * bootstrap is marked done and every subsequent call requires an authenticated `direction` caller.
 *
 * data: { uid: string, role: Role }
 * Roadmap: V1 Auth & RBAC.
 */
exports.setUserRole = onCall(CALLABLE_OPTS, async (request) => {
  const { uid, role } = request.data || {};

  if (typeof uid !== "string" || !uid) {
    throw new HttpsError("invalid-argument", "uid (string) est requis.");
  }
  if (typeof role !== "string" || !VALID_ROLES.includes(role)) {
    throw new HttpsError(
      "invalid-argument",
      `role doit être l'un de : ${VALID_ROLES.join(", ")}.`
    );
  }

  const db = firestoreDb();
  const bootstrapRef = db.doc("config/bootstrap");
  const bootstrapSnap = await bootstrapRef.get();
  const bootstrapDone = bootstrapSnap.exists && bootstrapSnap.data()?.done === true;

  const callerRole = request.auth?.token?.role;
  const isCallerDirection = request.auth != null && callerRole === "direction";

  if (!bootstrapDone) {
    // Bootstrap VERROUILLÉ (audit pré-lancement 2026-07, M3) : l'Auth du projet est PARTAGÉE entre
    // apps — un chemin qui pose le claim `direction` sans preuve était une course gagnable par
    // n'importe quel compte du projet. Désormais le bootstrap exige : (1) l'opt-in explicite
    // ALLOW_ROLE_BOOTSTRAP=true posé temporairement au déploiement initial, (2) un appelant
    // AUTHENTIFIÉ, (3) l'auto-attribution uniquement (uid = soi-même). Hors fenêtre de bootstrap,
    // provisionner via le script admin (functions/adminSetUserRole.js, service account).
    if (process.env.ALLOW_ROLE_BOOTSTRAP !== "true") {
      throw new HttpsError(
        "failed-precondition",
        "Bootstrap désactivé : provisionner le premier compte 'direction' via le script admin, ou déployer temporairement avec ALLOW_ROLE_BOOTSTRAP=true."
      );
    }
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Le bootstrap requiert un appelant authentifié.");
    }
    if (uid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "Le bootstrap ne peut attribuer 'direction' qu'à l'appelant lui-même.");
    }
    if (role !== "direction") {
      throw new HttpsError(
        "failed-precondition",
        "Le premier appel (bootstrap) doit créer un compte 'direction'."
      );
    }
  } else if (!isCallerDirection) {
    throw new HttpsError(
      "permission-denied",
      "Seule la Direction peut assigner un rôle."
    );
  }

  // Firebase Auth is shared across every app in this project (there is no per-app Auth
  // namespace short of paid Identity Platform tenancy). setCustomUserClaims() REPLACES the
  // user's entire custom-claims object — calling it with only `{role}` would silently wipe out
  // any claim another app already set on this same account. Merge into the existing claims
  // instead, so this app only ever touches its own `role` key.
  const existingClaims = (await getAuth().getUser(uid)).customClaims || {};
  await getAuth().setCustomUserClaims(uid, { ...existingClaims, role });

  await db.collection("auditLog").add({
    uid: request.auth?.uid ?? null,
    action: "setUserRole",
    module: "config",
    entity: "users",
    entityId: uid,
    detail: { role, bootstrap: !bootstrapDone },
    ts: FieldValue.serverTimestamp(),
  });

  if (!bootstrapDone) {
    await bootstrapRef.set({ done: true, ts: FieldValue.serverTimestamp() }, { merge: true });
  }

  logger.info(`setUserRole: uid=${uid} role=${role} bootstrap=${!bootstrapDone} caller=${request.auth?.uid ?? "none"}`);
  return { uid, role };
});

/**
 * setPermissionsMatrix — callable (DG uniquement) : met à jour la MATRICE RBAC (rôle × module) dans
 * config/permissions, sans redéploiement ni re-seed. `data.matrix` est nettoyée par
 * sanitizePermissionsMatrix (n'accepte que rôles/modules connus, valeurs none/read/write). Réservé
 * à `direction` (le seul rôle autorisé à écrire config/permissions, cf. firestore.rules). Merge :
 * on peut ne pousser qu'un sous-ensemble de rôles. Audité dans auditLog.
 */
exports.setPermissionsMatrix = onCall(CALLABLE_OPTS, async (request) => {
  if (request.auth?.token?.role !== "direction") {
    throw new HttpsError("permission-denied", "Seule la Direction peut modifier la matrice des droits.");
  }
  const clean = sanitizePermissionsMatrix(request.data?.matrix);
  if (!Object.keys(clean).length) {
    throw new HttpsError("invalid-argument", "matrix (objet rôle→module→niveau) est requis.");
  }
  const db = firestoreDb();
  // Merge par rôle : chaque rôle fourni remplace sa ligne ; les rôles non fournis sont conservés.
  await db.doc("config/permissions").set({ matrix: clean }, { merge: true });
  await db.collection("auditLog").add({
    action: "setPermissionsMatrix",
    entity: "config/permissions",
    entityId: "permissions",
    uid: request.auth.uid,
    detail: { roles: Object.keys(clean) },
    ts: FieldValue.serverTimestamp(),
  });
  logger.info(`setPermissionsMatrix: caller=${request.auth.uid} roles=${Object.keys(clean).join(",")}`);
  return { ok: true, roles: Object.keys(clean) };
});

/**
 * setLensWeights — callable (DIRECTION uniquement) : met à jour les pondérations de FOCALE
 * (rôle-focale × axe) dans config/lensWeights, sans redéploiement. Ces poids re-classent l'affichage
 * (Fil / Détection / Radar) selon la focale du lecteur — le priorityScore serveur reste l'autorité.
 * Sanitize : n'accepte que les focales dg/strategie/innovation × les 5 axes connus, valeurs bornées
 * [0, 3]. config/lensWeights est LISIBLE par tout authentifié (règle dédiée), écrit ici uniquement.
 */
const LENS_KEYS = ["dg", "strategie", "innovation"];
const LENS_AXES = ["partenaires", "concurrents", "clients_prospects", "tech", "reglementaire"];
function sanitizeLensWeights(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const lens of LENS_KEYS) {
    const row = obj[lens];
    if (!row || typeof row !== "object") continue;
    const clean = {};
    for (const ax of LENS_AXES) {
      const v = Number(row[ax]);
      if (Number.isFinite(v)) clean[ax] = Math.min(3, Math.max(0, Math.round(v * 100) / 100));
    }
    if (Object.keys(clean).length) out[lens] = clean;
  }
  return out;
}
exports.setLensWeights = onCall(CALLABLE_OPTS, async (request) => {
  if (request.auth?.token?.role !== "direction") {
    throw new HttpsError("permission-denied", "Seule la Direction peut modifier les pondérations de focale.");
  }
  const clean = sanitizeLensWeights(request.data?.weights);
  if (!Object.keys(clean).length) {
    throw new HttpsError("invalid-argument", "weights (focale → axe → valeur) est requis.");
  }
  const db = firestoreDb();
  await db.doc("config/lensWeights").set({ weights: clean, updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth.uid }, { merge: true });
  await db.collection("auditLog").add({
    uid: request.auth.uid, action: "setLensWeights", module: "config", entity: "config/lensWeights",
    entityId: "lensWeights", detail: { lenses: Object.keys(clean) }, ts: FieldValue.serverTimestamp(),
  });
  logger.info(`setLensWeights: caller=${request.auth.uid} lenses=${Object.keys(clean).join(",")}`);
  return { ok: true, lenses: Object.keys(clean) };
});

/**
 * enrichTendersNow — callable exec-gated (levier 4) : enrichit les APPELS D'OFFRES en allant lire la
 * PAGE OFFICIELLE (au-delà de l'extrait RSS). Pour les signaux subtype tender/funding/budget publiés,
 * avec URL, à qui il manque le montant OU l'échéance : fetch (garde SSRF) → texte → extraction Vertex
 * → fusion dans businessAngle SANS écraser l'existant. Borné à MAX_TENDER_ENRICH par appel (coût IA).
 * Une échéance datée alimente dueDate (proximité). Best-effort par item (un échec n'arrête pas le lot).
 */
const MAX_TENDER_ENRICH = Number(process.env.MAX_TENDER_ENRICH) || 8;

/** Implémentation partagée (callable enrichTendersNow + planifié enrichTenders). */
async function runEnrichTenders(db) {
  const snap = await db.collection("intelItems").where("subtype", "in", TENDER_ENRICH_SUBTYPES).get();
  const candidates = [];
  snap.forEach((d) => {
    const it = { id: d.id, ...d.data() };
    const ba = it.businessAngle || {};
    if (PUBLISHED_STATUSES.has(it.status) && it.url && (!ba.estAmount || !ba.deadline)) candidates.push(it);
  });
  candidates.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const batch = candidates.slice(0, MAX_TENDER_ENRICH);
  let fetched = 0;
  let enriched = 0;
  await runInBatches(batch, 3, async (it) => {
    let html;
    try { html = await fetchSource(it.url); } catch (e) { logger.warn(`enrichTendersNow: fetch ${it.id} échoué (${e.message})`); return; }
    fetched += 1;
    const text = extractWebText(html, 6000);
    let raw;
    try {
      raw = await vertexLimit(() => generateJson(buildTenderEnrichPrompt(it.title, text), {
        temperature: 0,
        model: process.env.GEMINI_MODEL_EXTRACTION || undefined,
      }));
    } catch (e) { logger.warn(`enrichTendersNow: IA ${it.id} échouée (${e.message})`); return; }
    const ext = parseTenderEnrichResponse(raw);
    const mergedBA = mergeBusinessAngle(it.businessAngle, ext);
    const patch = { businessAngle: mergedBA };
    if (ext.budgetIdentified && !it.budgetIdentified) patch.budgetIdentified = true;
    const iso = isoDeadline(mergedBA.deadline);
    if (iso && !it.dueDate) patch.dueDate = iso;
    const baChanged = JSON.stringify(mergedBA) !== JSON.stringify(it.businessAngle || {});
    if (baChanged || patch.dueDate || patch.budgetIdentified) {
      await db.doc(`intelItems/${it.id}`).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      enriched += 1;
    }
  });
  logger.info(`runEnrichTenders: candidats=${candidates.length} traités=${batch.length} fetch=${fetched} enrichis=${enriched}`);
  return { candidates: candidates.length, processed: batch.length, fetched, enriched };
}

/** enrichTendersNow — callable exec-gated (bouton « Enrichir les AO » dans la vue). */
exports.enrichTendersNow = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "enrichir les appels d'offres");
  return await runEnrichTenders(firestoreDb());
});

/**
 * enrichTenders — Scheduler (quotidien 07:00 Africa/Abidjan, APRÈS la synchro de veille de 06:00) :
 * enrichit automatiquement les nouveaux AO en lisant leur page officielle. Même logique bornée que
 * le callable (MAX_TENDER_ENRICH par run) — coût IA maîtrisé.
 */
exports.enrichTenders = onSchedule(
  { schedule: "0 7 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const r = await runEnrichTenders(firestoreDb());
    logger.info(`enrichTenders (planifié): ${JSON.stringify(r)}`);
  }
);

/* ============================================================================================= *
 * INTÉGRATIONS TIERCES — gestion des utilisateurs (rôles), webhooks sortants & entrants.
 * ============================================================================================= */

/**
 * onActionCreated — trigger : une action (créée côté client dans `actions/{id}`, cf.
 * web/.../lib/execution.ts) déclenche l'événement sortant `action.created`. C'est le point d'émission
 * pour ce type d'événement car les actions ne sont pas créées côté serveur.
 */
exports.onActionCreated = onDocumentCreated(
  { document: "actions/{id}", region: "europe-west1", database: FIRESTORE_DATABASE_ID },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const a = snap.data() || {};
    await dispatchWebhookEvent(firestoreDb(), "action.created", {
      id: snap.id,
      title: a.title || a.action || a.label || null,
      dueDate: a.dueDate || a.quand || null,
      owner: a.owner || a.assignee || null,
      status: a.status || null,
      accountId: a.accountId || a.compte || null,
    });
  }
);

/**
 * userAdmin — callable (DIRECTION uniquement) : gestion des utilisateurs de l'app par le CLAIM `role`
 * (l'Auth Firebase est PARTAGÉE entre apps du projet → on ne touche jamais l'activation globale du
 * compte, cf. décision produit). Actions : `list` (comptes portant un rôle connu de cette app),
 * `invite` (crée si besoin + assigne + e-mail de mot de passe), `assign`, `revoke`.
 */
exports.userAdmin = onCall(CALLABLE_OPTS, async (request) => {
  if (request.auth?.token?.role !== "direction") {
    throw new HttpsError("permission-denied", "Réservé à la Direction.");
  }
  const db = firestoreDb();
  const auth = getAuth();
  const action = request.data?.action;
  const audit = (act, entityId, detail) =>
    db.collection("auditLog").add({ uid: request.auth.uid, action: act, module: "config", entity: "users", entityId: entityId || null, detail: detail || {}, ts: FieldValue.serverTimestamp() });

  if (action === "list") {
    // Auth PARTAGÉE : n'exposer QUE les comptes portant un claim `role` connu de CETTE app.
    const users = [];
    let pageToken;
    do {
      const res = await auth.listUsers(1000, pageToken);
      for (const u of res.users) {
        const role = u.customClaims?.role;
        if (typeof role === "string" && VALID_ROLES.includes(role)) {
          users.push({
            uid: u.uid, email: u.email || null, displayName: u.displayName || null, role,
            disabled: !!u.disabled, lastSignIn: u.metadata?.lastSignInTime || null, createdAt: u.metadata?.creationTime || null,
          });
        }
      }
      pageToken = res.pageToken;
    } while (pageToken);
    users.sort((x, y) => (x.email || "").localeCompare(y.email || ""));
    return { users };
  }

  if (action === "assign" || action === "revoke") {
    const email = typeof request.data?.email === "string" ? request.data.email.trim().toLowerCase() : "";
    let uid = typeof request.data?.uid === "string" ? request.data.uid : "";
    if (!uid && email) {
      try { uid = (await auth.getUserByEmail(email)).uid; } catch { throw new HttpsError("not-found", "Utilisateur introuvable."); }
    }
    if (!uid) throw new HttpsError("invalid-argument", "uid ou email requis.");
    if (uid === request.auth.uid && action === "revoke") {
      throw new HttpsError("failed-precondition", "Vous ne pouvez pas révoquer votre propre accès.");
    }
    const existing = (await auth.getUser(uid)).customClaims || {};
    if (action === "assign") {
      const role = request.data?.role;
      if (!VALID_ROLES.includes(role)) throw new HttpsError("invalid-argument", `role doit être l'un de : ${VALID_ROLES.join(", ")}.`);
      await auth.setCustomUserClaims(uid, { ...existing, role });
      await audit("assignRole", uid, { role });
      return { ok: true, uid, role };
    }
    const next = { ...existing };
    delete next.role; // révocation par-app = retrait du claim role (le compte Auth global reste intact)
    await auth.setCustomUserClaims(uid, next);
    await audit("revokeRole", uid, {});
    return { ok: true, uid, role: null };
  }

  if (action === "invite") {
    const email = typeof request.data?.email === "string" ? request.data.email.trim().toLowerCase() : "";
    const role = request.data?.role;
    if (!email || !/.+@.+\..+/.test(email)) throw new HttpsError("invalid-argument", "email valide requis.");
    if (!VALID_ROLES.includes(role)) throw new HttpsError("invalid-argument", `role doit être l'un de : ${VALID_ROLES.join(", ")}.`);
    let user;
    let created = false;
    try { user = await auth.getUserByEmail(email); }
    catch (e) { if (e.code !== "auth/user-not-found") throw e; user = await auth.createUser({ email, emailVerified: false }); created = true; }
    const existing = user.customClaims || {};
    await auth.setCustomUserClaims(user.uid, { ...existing, role });
    // E-mail « définissez votre mot de passe » via Identity Toolkit (clé web NON secrète). Aucun mot de
    // passe ne transite jamais. Nécessite WEB_API_KEY (functions/.env) — sinon on saute l'e-mail.
    // (nom sans préfixe FIREBASE_ : réservé par firebase deploy pour les .env.)
    const apiKey = process.env.WEB_API_KEY;
    const hasPassword = (user.providerData || []).some((p) => p.providerId === "password");
    let emailSent = false;
    if (apiKey && !hasPassword) {
      try {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
        });
        emailSent = res.ok;
      } catch { emailSent = false; }
    }
    await audit("inviteUser", user.uid, { role, created, emailSent });
    return { ok: true, uid: user.uid, email, role, created, passwordEmailSent: emailSent };
  }

  throw new HttpsError("invalid-argument", "action inconnue (list|invite|assign|revoke).");
});

/**
 * webhookAdmin — callable (DIRECTION uniquement) : CRUD des endpoints sortants et des sources
 * entrantes + lecture des journaux de livraison. Les secrets ne sont renvoyés EN CLAIR qu'à la
 * création/rotation (ensuite masqués). Aucune écriture cliente directe de ces collections (règles).
 */
exports.webhookAdmin = onCall(CALLABLE_OPTS, async (request) => {
  if (request.auth?.token?.role !== "direction") {
    throw new HttpsError("permission-denied", "Réservé à la Direction.");
  }
  const db = firestoreDb();
  const action = request.data?.action;
  const audit = (act, entityId, detail) =>
    db.collection("auditLog").add({ uid: request.auth.uid, action: act, module: "config", entity: "webhooks", entityId: entityId || null, detail: detail || {}, ts: FieldValue.serverTimestamp() });

  // -------- endpoints SORTANTS --------
  if (action === "listEndpoints") {
    const snap = await db.collection("webhookEndpoints").get();
    return { endpoints: snap.docs.map((d) => { const e = d.data(); return { id: d.id, url: e.url, events: e.events || [], label: e.label || "", active: e.active !== false, secretMasked: whMaskSecret(e.secret), lastDeliveryOk: e.lastDeliveryOk ?? null, lastDeliveryAt: e.lastDeliveryAt || null, lastError: e.lastError || null }; }) };
  }
  if (action === "upsertEndpoint") {
    const clean = whSanitizeEndpoint(request.data?.endpoint);
    const guard = checkPublicHttpUrl(clean.url);
    if (!guard.ok) throw new HttpsError("invalid-argument", `URL invalide : ${guard.reason}`);
    if (!clean.events.length) throw new HttpsError("invalid-argument", "Sélectionnez au moins un événement.");
    const id = request.data?.id;
    if (id) {
      await db.doc(`webhookEndpoints/${id}`).set({ ...clean, updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth.uid }, { merge: true });
      await audit("upsertWebhookEndpoint", id, { events: clean.events });
      return { ok: true, id };
    }
    const secret = whGenerateSecret();
    const ref = await db.collection("webhookEndpoints").add({ ...clean, secret, createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid });
    await audit("createWebhookEndpoint", ref.id, { events: clean.events });
    return { ok: true, id: ref.id, secret }; // secret renvoyé UNE seule fois
  }
  if (action === "rotateEndpointSecret") {
    const id = request.data?.id; if (!id) throw new HttpsError("invalid-argument", "id requis.");
    const secret = whGenerateSecret();
    await db.doc(`webhookEndpoints/${id}`).set({ secret, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await audit("rotateWebhookEndpointSecret", id, {});
    return { ok: true, id, secret };
  }
  if (action === "deleteEndpoint") {
    const id = request.data?.id; if (!id) throw new HttpsError("invalid-argument", "id requis.");
    await db.doc(`webhookEndpoints/${id}`).delete();
    await audit("deleteWebhookEndpoint", id, {});
    return { ok: true, id };
  }

  // -------- sources ENTRANTES --------
  if (action === "listInboundSources") {
    const snap = await db.collection("webhookInboundSources").get();
    return { sources: snap.docs.map((d) => { const s = d.data(); return { id: d.id, label: s.label || "", actions: s.actions || [], active: s.active !== false, secretMasked: whMaskSecret(s.secret), lastSeenAt: s.lastSeenAt || null }; }) };
  }
  if (action === "upsertInboundSource") {
    const clean = whSanitizeInboundSource(request.data?.source);
    if (!clean.actions.length) throw new HttpsError("invalid-argument", "Sélectionnez au moins une action.");
    const id = request.data?.id;
    if (id) {
      await db.doc(`webhookInboundSources/${id}`).set({ ...clean, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit("upsertInboundSource", id, { actions: clean.actions });
      return { ok: true, id };
    }
    const secret = whGenerateSecret();
    const ref = await db.collection("webhookInboundSources").add({ ...clean, secret, createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid });
    await audit("createInboundSource", ref.id, { actions: clean.actions });
    return { ok: true, id: ref.id, secret };
  }
  if (action === "rotateInboundSecret") {
    const id = request.data?.id; if (!id) throw new HttpsError("invalid-argument", "id requis.");
    const secret = whGenerateSecret();
    await db.doc(`webhookInboundSources/${id}`).set({ secret, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await audit("rotateInboundSecret", id, {});
    return { ok: true, id, secret };
  }
  if (action === "deleteInboundSource") {
    const id = request.data?.id; if (!id) throw new HttpsError("invalid-argument", "id requis.");
    await db.doc(`webhookInboundSources/${id}`).delete();
    await audit("deleteInboundSource", id, {});
    return { ok: true, id };
  }

  // -------- journaux --------
  if (action === "listDeliveries") {
    const snap = await db.collection("webhookDeliveries").orderBy("ts", "desc").limit(50).get();
    return { deliveries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  }
  if (action === "listInboundLog") {
    const snap = await db.collection("webhookInboundLog").orderBy("ts", "desc").limit(50).get();
    return { log: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  }
  if (action === "events") {
    return { outbound: WH_OUTBOUND_EVENTS, inbound: WH_INBOUND_ACTIONS };
  }

  throw new HttpsError("invalid-argument", "action inconnue.");
});

/**
 * webhookInbound — endpoint HTTPS PUBLIC (onRequest) : reçoit les requêtes des apps tierces.
 * Protégé par SIGNATURE HMAC par source (jamais par l'accès réseau) — modèle « Stripe webhook » :
 * l'invocation publique est normale, la sécurité est la signature. En-têtes attendus :
 *   x-sentinel-source     : id de la source (webhookInboundSources/{id})
 *   x-sentinel-signature  : sha256=<hmac de `${ts}.${body}`>
 *   x-sentinel-timestamp  : epoch (s), fenêtre anti-rejeu 300 s
 *   x-sentinel-action     : ingest | action | sync | pull (ou ?action=, ou body.action ; GET ⇒ pull)
 * L'action doit être autorisée pour la source. Limite de charge 64 Ko. Tout est journalisé.
 */
exports.webhookInbound = onRequest({ region: "europe-west1", timeoutSeconds: 540, memory: "512MiB", cors: false }, async (req, res) => {
  const db = firestoreDb();
  const started = Date.now();
  const sourceId = String(req.get("x-sentinel-source") || req.query.source || "").trim();
  const signature = req.get(WH_SIG_HEADER);
  const timestamp = req.get(WH_TS_HEADER);
  const rawBody = req.rawBody ? req.rawBody.toString("utf8") : "";
  const method = (req.method || "GET").toUpperCase();
  const fail = async (code, msg, act) => {
    try { await db.collection("webhookInboundLog").add({ sourceId: sourceId || null, action: act || null, ok: false, status: code, error: msg, ts: FieldValue.serverTimestamp() }); } catch { /* best-effort */ }
    res.status(code).json({ ok: false, error: msg });
  };
  try {
    if (rawBody.length > 64 * 1024) return void (await fail(413, "Charge trop volumineuse (max 64 Ko)."));
    if (!sourceId) return void (await fail(400, "Source manquante (en-tête x-sentinel-source)."));
    const srcSnap = await db.doc(`webhookInboundSources/${sourceId}`).get();
    if (!srcSnap.exists) return void (await fail(404, "Source inconnue."));
    const src = srcSnap.data();
    if (src.active === false) return void (await fail(403, "Source désactivée."));
    const signedBody = method === "GET" ? "" : rawBody;
    if (!whVerify({ body: signedBody, secret: src.secret, signature, timestamp })) {
      return void (await fail(401, "Signature invalide ou expirée."));
    }

    let payload = {};
    if (method !== "GET" && rawBody) {
      try { payload = JSON.parse(rawBody); } catch { return void (await fail(400, "Corps JSON invalide.")); }
    }
    let act = String(req.get("x-sentinel-action") || req.query.action || payload.action || (method === "GET" ? "pull" : "")).trim();
    if (!WH_INBOUND_ACTIONS.includes(act)) return void (await fail(400, `Action inconnue (${act || "—"}).`, act));
    if (!(Array.isArray(src.actions) && src.actions.includes(act))) {
      return void (await fail(403, `Action '${act}' non autorisée pour cette source.`, act));
    }

    let result;
    if (act === "pull") {
      const which = String(req.query.summary || payload.summary || "veille");
      const allowed = { veille: "summaries/veille", veille_exec: "summaries/veille_exec", quanti: "summaries/quanti" };
      const path = allowed[which] || allowed.veille;
      const s = await db.doc(path).get();
      result = { summary: allowed[which] ? which : "veille", data: s.exists ? s.data() : null };
    } else if (act === "ingest") {
      const item = payload.item || payload;
      if (!item || (!item.title && !item.url)) return void (await fail(422, "item.title ou item.url requis.", act));
      const classified = {
        title: String(item.title || "").slice(0, 300),
        url: item.url ? String(item.url) : "",
        date: item.date || null,
        axis: item.axis || "marche",
        subtype: item.subtype || null,
        summary: item.summary ? String(item.summary).slice(0, 2000) : "",
        source: item.source || `webhook:${sourceId}`,
        impact: item.impact || "moyen",
        stance: item.stance || "neutre",
        status: "new",
      };
      const r = await upsertClassifiedItem(db, classified, null);
      result = { ingested: r.written, id: r.id };
    } else if (act === "action") {
      const a = payload.data || payload;
      const doc = {
        title: String(a.title || a.action || "Action (webhook)").slice(0, 300),
        dueDate: a.dueDate || a.quand || null,
        owner: a.owner || null,
        status: a.status || "todo",
        detail: a.detail ? String(a.detail).slice(0, 2000) : null,
        source: `webhook:${sourceId}`,
        createdBy: `webhook:${sourceId}`,
        createdAt: FieldValue.serverTimestamp(),
      };
      const ref = await db.collection("actions").add(doc);
      result = { actionId: ref.id };
    } else if (act === "sync") {
      const target = String(payload.target || req.query.target || "quanti");
      if (target === "quanti") { await runInternalQuantiSync(db); result = { synced: "quanti" }; }
      else if (target === "sources") { await runSyncSources(db); result = { synced: "sources" }; }
      else return void (await fail(400, "target invalide (quanti|sources).", act));
    }

    await db.doc(`webhookInboundSources/${sourceId}`).set({ lastSeenAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    await db.collection("webhookInboundLog").add({ sourceId, action: act, ok: true, status: 200, ms: Date.now() - started, ts: FieldValue.serverTimestamp() });
    res.status(200).json({ ok: true, action: act, result });
  } catch (e) {
    logger.error(`webhookInbound: ${e.message}`);
    try { res.status(500).json({ ok: false, error: "Erreur interne." }); } catch { /* déjà envoyé */ }
  }
});
