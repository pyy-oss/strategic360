"use strict";

/**
 * Cloud Functions (Node 20) — "Veille Stratégique" (Neurones Technologies CI).
 *
 * V0 (Socle & design): structure only — correct Cloud Functions v2 trigger signatures per
 * BUILD_KIT.md §10, bodies throw "not implemented" pending their roadmap phase. No Vertex AI
 * calls yet (that's V7). No real Firestore/Storage wiring yet (V2-V6).
 */

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { computePriorityScore } = require("./domain/scoring");
const { parsePnl } = require("./parsers/pnl");
const { parseLive } = require("./parsers/live");
const { parseFacturationDf } = require("./parsers/facturationDf");
const { parseFiche } = require("./parsers/fiche");
const { computePorterForces, computeBcg, computeCasSummary, computePipeline, computeKris, computeValueAtStake, computePipelineInfluenced, computeGranularite } = require("./domain/quanti");
const { intelItemId } = require("./domain/ids");
const { buildClassificationPrompt, parseClassificationResponse, deriveSourceRatingFromUrl } = require("./domain/classify");
const { dedupeByTitle, isNearDuplicate, isStrongDuplicate, clusterNearDuplicates } = require("./domain/dedupe");
const { pickOnboardingLinks } = require("./domain/onboarding");
const { buildEvaluatePrompt, parseEvaluateResponse } = require("./domain/evaluate");
const { pickRelevant } = require("./domain/retrieve");
const { buildBriefingPrompt, parseBriefingResponse } = require("./domain/briefing");
const { buildBriefingPdf } = require("./domain/pdf");
const { generateJson, DEFAULT_MODEL } = require("./domain/vertex");
const { AGENTS: COPILOTE_AGENTS, buildChatPrompt, parseChatResponse } = require("./domain/copilote");
const PDFDocument = require("pdfkit");
const { v1: firestoreAdminV1 } = require("@google-cloud/firestore");

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
 * pour laisser le JS peupler la page. */
async function fetchRendered(url) {
  const browser = await getRenderBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(SOURCE_FETCH_HEADERS["User-Agent"]);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Laisse le JS rendre le contenu (listes d'AO, actualités) après le DOMContentLoaded.
    await new Promise((r) => setTimeout(r, 3500));
    return await page.content();
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

/**
 * fetchSource(url) — récupère une source avec robustesse : UA navigateur, suivi des redirections,
 * timeout dur (12 s) pour ne pas bloquer un lot, et 1 nouvelle tentative sur erreur réseau
 * transitoire. Lève une erreur explicite sur statut HTTP non-2xx (comptée comme échec de santé).
 */
async function fetchSource(url) {
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { headers: SOURCE_FETCH_HEADERS, redirect: "follow", signal: controller.signal });
      if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch (err) {
    // Retente une fois uniquement sur erreur réseau/timeout (pas sur un 4xx déterministe).
    if (/HTTP [45]\d\d/.test(String(err.message)) && !/HTTP 429|HTTP 5\d\d/.test(String(err.message))) throw err;
    return await attempt();
  }
}

/** Source health: auto-deactivate a source after this many consecutive fetch failures. */
const MAX_CONSECUTIVE_FAILURES = 5;

/** The 8 profiles from BUILD_KIT.md §7 / firestore.rules. */
const VALID_ROLES = [
  "direction",
  "strategie",
  "innovation",
  "commercial_dir",
  "commercial",
  "pmo",
  "achats",
  "lecture",
];

/** Mirrors `exec()` in firestore.rules (BUILD_KIT.md §7): direction/strategie/innovation. */
const EXEC_ROLES = ["direction", "strategie", "innovation"];
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
const COMMERCIAL_ROLES = ["commercial", "commercial_dir", ...EXEC_ROLES];
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
 *    functions/.env(.<project-id>) file — see functions/.env.example. Falls back to "(default)"
 *    so this codebase still works standalone against a project with no other apps.
 *  - STORAGE_BUCKET_NAME: a dedicated Cloud Storage bucket (e.g. "strategic360"), separate from
 *    the project's default bucket other apps may already be using. Falls back to the default
 *    bucket (`getStorage().bucket()` with no args) when unset.
 * See docs/BUILD_KIT.md / README.md "Checklist de déploiement" for the full multi-app rationale.
 */
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const STORAGE_BUCKET_NAME = process.env.STORAGE_BUCKET_NAME || undefined;
// Fuseau des schedulers (Phase 0 produit) : paramétrable par déploiement client (les onSchedule sont
// statiques au déploiement — c'est le bon niveau). Défaut = Neurones (Côte d'Ivoire).
const TENANT_TIMEZONE = process.env.TENANT_TIMEZONE || "Africa/Abidjan";

/** Firestore handle scoped to FIRESTORE_DATABASE_ID — use this everywhere instead of a bare
 * `getFirestore()` call, so every read/write in this codebase stays confined to this app's
 * dedicated database and never touches another app's "(default)" (or other named) database. */
function firestoreDb() {
  return FIRESTORE_DATABASE_ID === "(default)" ? getFirestore() : getFirestore(FIRESTORE_DATABASE_ID);
}

/** Storage bucket handle scoped to STORAGE_BUCKET_NAME — same rationale as db() above. */
function defaultBucket() {
  return STORAGE_BUCKET_NAME ? getStorage().bucket(STORAGE_BUCKET_NAME) : getStorage().bucket();
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

    const parsed = config.parse(buffer);
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
  const response = await generateJson(prompt);
  // La taxonomie du profil sert AUSSI à valider/normaliser la sortie (axes/subtypes custom).
  return parseClassificationResponse(response, { ...(context || {}), taxonomy: profile && profile.taxonomy });
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
    // par deux sources et classé sur des axes différents) — audit pertinence 2026-07.
    const dup = dedupeIndex.find((e) => ((e.axis || "") === axis && isNearDuplicate(e.title, title)) || isStrongDuplicate(e.title, title));
    if (dup) {
      logger.info(`syncSources: skip near-duplicate « ${String(classified.title).slice(0, 60)} » ~ « ${String(dup.title).slice(0, 60)} »`);
      return { id, written: false, duplicate: true };
    }
    dedupeIndex.push({ title: classified.title || "", axis });
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
async function runSyncSources(db) {

  const [sourcesSnap, watchlistSnap] = await Promise.all([
    db.collection("intelSources").where("active", "==", true).get(),
    db.collection("intelWatchlist").where("active", "==", true).get(),
  ]);
  const watchlistEntities = watchlistSnap.docs.map((d) => ({ name: d.data().name, type: d.data().type }));
  // Profil client (Phase 0 produit) : surcharge éventuelle de la notation des sources par domaine.
  // Absent → défaut Neurones (aucun changement de comportement).
  const clientProfile = await loadClientProfile(db);

  // Index anti-quasi-doublon (bug « doublons dans les signaux ») : titres+axes des signaux NON archivés
  // déjà présents. Partagé (mutable) entre les sources d'un même run pour aussi capter les doublons
  // intra-run (best-effort : les lots parallèles peuvent se croiser, l'id exact reste la garde dure).
  let dedupeIndex = [];
  try {
    const existingSnap = await db.collection("intelItems").get();
    dedupeIndex = existingSnap.docs
      .map((d) => d.data())
      .filter((x) => x && (x.status || "new") !== "archived" && x.title)
      .map((x) => ({ title: x.title, axis: x.axis || "" }));
  } catch (e) {
    logger.warn(`syncSources: index anti-doublon indisponible (${e.message}) — dédup par id seulement`);
  }

  let sourcesProcessed = 0;
  let itemsCreated = 0;

  // Suivi de PROGRESSION (UX 2026-07) : on publie l'avancement dans summaries/syncStatus pour que le
  // front affiche « X/Y sources · N signaux · phase » en direct au lieu d'un spinner aveugle.
  // Best-effort : toute écriture échouée est ignorée, jamais d'impact sur la synchro.
  const total = sourcesSnap.size;
  const writeSyncStatus = (patch) => db.doc("summaries/syncStatus").set(patch, { merge: true }).catch(() => {});
  await writeSyncStatus({ running: true, startedAt: FieldValue.serverTimestamp(), finishedAt: null, total, processed: 0, created: 0, phase: "ingestion" });

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

      if (source.kind === "rss" || source.kind === "newsletter" || source.kind === "portal") {
        const xml = await fetchSource(source.url);
        // Rééquilibrage du fil : les flux tech/cyber MONDIAUX sont prolifiques et noyaient les
        // signaux locaux — plafond réduit à 2 items/run pour l'axe tech, 5 pour les axes locaux.
        const rssItems = extractRssItems(xml, source.axis === "tech" ? 2 : 5);
        // Classification des items d'une même source en parallèle (chaque appel Vertex est indep.).
        const settled = await Promise.allSettled(
          rssItems.map(async (rssItem) => {
            const rawText = `${rssItem.title}\n${rssItem.description}`.trim();
            if (!rawText) return false;
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
        // kind "web" : fetch HTTP simple. Même extraction multi-items ensuite.
        const html = source.kind === "web-js" ? await fetchRendered(source.url) : await fetchSource(source.url);
        // C5 : extraction MULTI-ITEMS — chaque avis/actualité devient un intelItem à ID distinct
        // (lien de l'item, sinon titre+date), au lieu d'UN doc figé sur l'URL du portail.
        const webItems = extractWebItems(html, source.url, source.axis === "tech" ? 2 : 8);
        if (webItems.length) {
          const settled = await Promise.allSettled(
            webItems.map(async (wi) => {
              const perItemLink = wi.link && wi.link !== source.url ? wi.link : undefined;
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

  let settled;
  try {
    settled = await runInBatches(sourcesSnap.docs, AI_CONCURRENCY, trackedSource);
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

  logger.info(`syncSources: done — sourcesProcessed=${sourcesProcessed}/${sourcesSnap.size} itemsCreated=${itemsCreated} deduped=${deduped.archived} évalués=${evaluated.evaluated} (pub ${evaluated.published}/rej ${evaluated.rejected})`);
  return { sourcesTotal: sourcesSnap.size, sourcesProcessed, itemsCreated, deduped: deduped.archived, evaluated: evaluated.published, rejected: evaluated.rejected };
}

/**
 * syncSources — Scheduler (quotidien 06:00 Africa/Abidjan). Thin wrapper around runSyncSources().
 * Roadmap: V7 IA & sync.
 */
// 2 GiB : le rendu headless (kind "web-js") lance Chromium, gourmand en mémoire. Les sources
// web-js sont peu nombreuses (portails anti-bot) mais le navigateur doit tenir dans l'instance.
exports.syncSources = onSchedule({ schedule: "0 6 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "2GiB" }, async () => {
  await runSyncSources(firestoreDb());
});

/**
 * syncSourcesNow — callable (manual on-demand trigger). Same runSyncSources() logic as the
 * schedule, exposed so a run can be tested/forced without waiting for the daily 06:00 slot.
 * Exec-gated, same pattern as classifyAI/generateBriefing/exportPdf.
 * Roadmap: V7 IA & sync (added post-deploy for real-data onboarding).
 */
exports.syncSourcesNow = onCall({ ...HEAVY_CALLABLE_OPTS, memory: "2GiB" }, async (request) => {
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

/**
 * runEvaluateIntelItems — PORTE DE QUALITÉ : passe en revue les signaux EN ATTENTE (`pending`) et, via
 * un jugement LLM de PERTINENCE pour NT, les PUBLIE (`new`, avec evalScore/evalReason) ou les ÉCARTE
 * (`rejected`, corbeille exec restaurable). FAIL-OPEN par item : toute erreur d'évaluation → on publie
 * (jamais pire que le comportement historique « tout est publié »), le fil ne se vide jamais.
 * Borné à `limit` par passe (coût). Parallélisé (runInBatches, AI_CONCURRENCY).
 */
async function runEvaluateIntelItems(db, { limit = 150 } = {}) {
  const companyContext = await getCompanyContext();
  const snap = await db.collection("intelItems").where("status", "==", "pending").limit(limit).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!items.length) return { evaluated: 0, published: 0, rejected: 0 };
  let published = 0, rejected = 0;
  const stamp = () => FieldValue.serverTimestamp();
  await runInBatches(items, AI_CONCURRENCY, async (it) => {
    try {
      const parsed = parseEvaluateResponse(await generateJson(buildEvaluatePrompt(it, companyContext)));
      if (parsed && parsed.publier === false) {
        await db.doc(`intelItems/${it.id}`).update({ status: "rejected", evalScore: parsed.pertinence, evalReason: parsed.raison || "écarté par l'évaluateur", evalFailed: false, updatedAt: stamp() });
        rejected += 1;
      } else if (parsed) {
        await db.doc(`intelItems/${it.id}`).update({ status: "new", evalScore: parsed.pertinence, evalReason: parsed.raison || "publié", evalFailed: false, updatedAt: stamp() });
        published += 1;
      } else {
        // Réponse non exploitable (parse null) : fail-open, mais on MARQUE le signal (evalFailed) et on
        // pose un score plancher explicite (50) pour que le tri aval ne confonde pas un signal « non
        // évalué » avec un signal réellement validé (audit pertinence 2026-07).
        await db.doc(`intelItems/${it.id}`).update({ status: "new", evalScore: 50, evalReason: "évaluation indisponible — publié par défaut", evalFailed: true, updatedAt: stamp() });
        published += 1;
      }
    } catch (err) {
      // Fail-open borné aux vraies pannes (réseau/IA) : on PUBLIE mais on MARQUE (evalFailed + score
      // plancher) — ne jamais retenir un signal à cause d'une panne, ni le faire passer pour validé.
      logger.warn(`runEvaluateIntelItems: éval échouée pour ${it.id} — publié par défaut (${err.message})`);
      try { await db.doc(`intelItems/${it.id}`).update({ status: "new", evalScore: 50, evalReason: "évaluation échouée — publié par défaut", evalFailed: true, updatedAt: stamp() }); published += 1; } catch (_e) { /* ignore */ }
    }
  });
  logger.info(`runEvaluateIntelItems: ${items.length} évalués — ${published} publiés, ${rejected} écartés`);
  return { evaluated: items.length, published, rejected };
}

/** evaluateIntelItemsNow — callable exec-gated : évalue à la demande les signaux en attente. */
exports.evaluateIntelItemsNow = onCall({ ...HEAVY_CALLABLE_OPTS, memory: "1GiB" }, async (request) => {
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
  { schedule: "every 60 minutes", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const result = await runEvaluateIntelItems(firestoreDb());
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
      return;
    }
  }

  // Score stabilisé (ou suppression) → recalcul des deux agrégats, chacun une seule fois.
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
 * aggregateVeilleExec — planifié (toutes les 60 min)
 * Construit summaries/veille_exec (boardKpis, decisionsPending, porter, winRateByCompetitor, ...).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeilleExec = onSchedule({ schedule: "every 60 minutes", timeZone: TENANT_TIMEZONE, region: "europe-west1" }, async () => {
  const db = firestoreDb();
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
  const prompt = buildBriefingPrompt({ veilleSummary, veilleExecSummary, topItems, period, companyContext });
  const response = await generateJson(prompt);
  const briefing = parseBriefingResponse(response, {
    period,
    generatedBy,
    kpis: veilleExecSummary?.boardKpis ?? null,
  });
  if (!briefing) return null;

  const ref = await db.collection("briefings").add({ ...briefing, createdAt: FieldValue.serverTimestamp() });
  logger.info(`runGenerateBriefing: created briefings/${ref.id} generatedBy=${generatedBy}`);
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
    const result = await runGenerateBriefing(firestoreDb(), "vertex-ai:scheduled");
    if (!result) {
      logger.error("generateBriefingWeekly: réponse IA inexploitable — aucun briefing créé cette semaine");
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
async function writeFrameworkDoc(db, key, content) {
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
  const signals = pickSignalsForEnrichment(itemsSnap.docs.map((d) => d.data()));
  // Échantillon ENTRELACÉ PAR AXE (audit pertinence 2026-07) : les cadres qui visent la BREADTH
  // (SWOT/PESTEL, Diagnostic, GE9, Ansoff, Horizons, paris d'innovation, scénarios) doivent voir un
  // input équilibré, pas la seule tête priorité-clusterisée. La diversité est déjà garantie dans la
  // SÉLECTION (pickSignalsForEnrichment stratifie par axe) ; ici on l'expose aussi dans l'ORDRE lu.
  const diverseSignals = diversifySignals(signals, { key: "axis" });

  if (!signals.length) {
    logger.info("runEnrichment: no non-archived intelItems — nothing to enrich, skipping");
    return { skipped: true };
  }

  // 0. Rafraîchissement du contexte entreprise (dynamique) — AVANT les autres générations pour
  // qu'elles utilisent la version à jour. writeFrameworkDoc applique la garde humaine : un
  // contexte édité par la Direction n'est jamais réécrit par l'IA.
  let companyContext = await getCompanyContext();
  try {
    const parsed = parseContextRefreshResponse(
      await generateJson(buildContextRefreshPrompt(companyContext, signals)),
      companyContext
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
      const swotStatus = await writeFrameworkDoc(db, "swot", parsed.swot);
      const pestelStatus = await writeFrameworkDoc(db, "pestel", parsed.pestel);
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
    const parsed = parseGe9Response(await generateJson(buildGe9Prompt(diverseSignals, granularite, companyContext)));
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
    const parsed = parseOpportunitiesResponse(await generateJson(buildOpportunitiesPrompt(signals, companyContext)));
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
}

/**
 * enrichStrategicArtifacts — Scheduler (hebdomadaire, lundi 05:00 Africa/Abidjan).
 * Regenerates the strategic artifacts from the week's accumulated signals via `runEnrichment`.
 */
exports.enrichStrategicArtifacts = onSchedule(
  { schedule: "0 5 * * 1", timeZone: TENANT_TIMEZONE, region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    await runEnrichment(firestoreDb());
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
  const signaux = pickRelevant(bizAll, { terms: prospectTerms }, 10).map((o) => ({ titre: o.name }));
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
  const recoBase = ranked.find((r) => r.csPct > 0) || ranked[0] || null;
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

exports.copiloteGenerate = onCall(HEAVY_CALLABLE_OPTS, async (request) => {
  requireCommercialCaller(request, "utiliser le copilote commercial");
  const { agent, accountId, extra } = request.data || {};
  const spec = COPILOTE_AGENTS[agent];
  if (!spec) throw new HttpsError("invalid-argument", `agent inconnu : ${agent}`);
  assertAccountId(accountId);
  const db = firestoreDb();
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
 * Sync quanti interne depuis nt360 ("données internes disponibles dans une autre application",
 * 2026-07-02) — the internal P&L/LIVE/Facturation/fiche data lives in the SIBLING app nt360's
 * named Firestore database (same shared project), already parsed from its own Excel imports.
 * This reads nt360 STRICTLY READ-ONLY, maps its rows onto domain/quanti.js's shapes
 * (domain/nt360.js) and recomputes strategic360's `summaries/quanti` — the same doc/shape that
 * ingestInternal (the Storage-upload path, kept as a fallback) writes, so the quanti views
 * (Indicateurs/Valeur/Portefeuille/Simulateur) light up with no frontend change.
 * ------------------------------------------------------------------------------------------- */

const NT360_DATABASE_ID = process.env.NT360_DATABASE_ID || "nt360";

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
  const src = getFirestore(NT360_DATABASE_ID); // READ-ONLY — never write through this handle

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
  const src = getFirestore(NT360_DATABASE_ID); // READ-ONLY
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
  for (let i = 0; i < derived.length; i += CHUNK) {
    const slice = derived.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const acc of slice) {
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
    const payload = {
      name: `${kindLabel} ${cand.offre} — ${cand.client}`,
      client: cand.client,
      bu: cand.offre,
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
    if (existing.exists) {
      delete payload.status; // ne jamais repasser un lead qualifié/écarté par un humain en "new"
    } else {
      payload.status = "new";
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

/** Rôles qui voient TOUT le portefeuille (pas de cloisonnement). */
const COPILOTE_UNSCOPED_ROLES = ["commercial_dir", ...EXEC_ROLES];

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
 * #exportDocuments`, from `@google-cloud/firestore`'s `v1` namespace — this is DISTINCT from the
 * regular `firebase-admin`/`@google-cloud/firestore` document-CRUD client used everywhere else in
 * this file; it talks to the separate "Firestore Admin" API surface) to snapshot the entire
 * default database to Cloud Storage. Output path: `gs://{projectId}.appspot.com/scheduled-exports/
 * {YYYY-MM-DD}/` (one dated folder per run — the export API itself writes several files under
 * that prefix, it is NOT a single downloadable file).
 *
 * UNVERIFIABLE IN THIS SANDBOX: there is no real GCP project/credentials here, no Firestore Admin
 * API enabled, and no emulator support for managed exports — this has NOT been exercised
 * end-to-end. It is implemented per the documented API surface (verified to load/construct
 * correctly — `new firestoreAdminV1.FirestoreAdminClient()` and `.databasePath()` both work in
 * this sandbox, see V8 task notes) and kept maximally defensive: any failure is caught and logged
 * at `error` level rather than thrown, because a scheduled maintenance job crashing must never be
 * mistaken for a user-facing incident (BUILD_KIT.md doesn't put this on any request path).
 *
 * Deployment prerequisites (manual, console/gcloud side — see README.md "Deployment Checklist"):
 *   - Firestore Admin API enabled for the project (usually on by default once Firestore is used).
 *   - The Cloud Functions service account needs `roles/datastore.importExportAdmin` (or
 *     equivalent) on the project, and the target bucket needs to exist with write access granted
 *     to that same service account.
 *   - The default `{projectId}.appspot.com` bucket (created automatically with most projects) is
 *     used as the export target here; override via `FIRESTORE_EXPORT_BUCKET` env var if a
 *     dedicated bucket is preferred.
 */
exports.scheduledFirestoreExport = onSchedule(
  { schedule: "0 2 * * *", timeZone: TENANT_TIMEZONE, region: "europe-west1" },
  async () => {
    try {
      const client = new firestoreAdminV1.FirestoreAdminClient();
      const projectId = await client.getProjectId();
      const bucket = process.env.FIRESTORE_EXPORT_BUCKET || `${projectId}.appspot.com`;
      const dateFolder = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const outputUriPrefix = `gs://${bucket}/scheduled-exports/${dateFolder}`;
      const databaseName = client.databasePath(projectId, "(default)");

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
    // First-ever call: only allowed to bootstrap the first `direction` user, and only if
    // no admin caller is required yet (nobody has the claim to call it normally).
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
