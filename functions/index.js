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
const { buildClassificationPrompt, parseClassificationResponse } = require("./domain/classify");
const { dedupeByTitle } = require("./domain/dedupe");
const { pickRelevant } = require("./domain/retrieve");
const { buildBriefingPrompt, parseBriefingResponse } = require("./domain/briefing");
const { buildBriefingPdf } = require("./domain/pdf");
const { generateJson } = require("./domain/vertex");
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
  const { pipelinePondere, winRate } = computePipeline({ opportunities });
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
async function classifyRawText(rawText, watchlistEntities, context) {
  const companyContext = await getCompanyContext();
  // Repères temporels : date de publication de la source (context.defaultDate) → le classifieur
  // juge passé/à-venir sur des dates réelles plutôt que sur le ton du texte (anti-obsolescence).
  const prompt = buildClassificationPrompt(rawText, watchlistEntities, companyContext, {
    pubDate: context && context.defaultDate ? context.defaultDate : undefined,
  });
  const response = await generateJson(prompt);
  return parseClassificationResponse(response, context);
}

/**
 * Writes (or idempotently re-merges) a classified item into `intelItems`, computing the SAME
 * deterministic id the client would (`functions/domain/ids.js#intelItemId`, mirrors
 * `web/src/modules/veille/lib/intel.ts`). NEVER clobbers a human-reviewed doc: if a doc already
 * exists at that id with `status !== 'new'` (i.e. a human has already reviewed/actioned/archived
 * it), the AI-sourced update is skipped entirely rather than merged — the human decision stands.
 * Roadmap: V7 IA & sync — BUILD_KIT.md §1 "Rien n'est publié par l'IA sans revue humaine".
 */
async function upsertClassifiedItem(db, classified) {
  const id = intelItemId({ url: classified.url, title: classified.title, date: classified.date });
  const ref = db.doc(`intelItems/${id}`);
  const existing = await ref.get();
  if (existing.exists && existing.data().status !== "new") {
    logger.info(`syncSources: skip ${id} — already reviewed/actioned/archived (human decision stands)`);
    return { id, written: false };
  }
  await ref.set(
    {
      ...classified,
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

  let sourcesProcessed = 0;
  let itemsCreated = 0;

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

      const context = { sourceName: source.name, defaultSourceRating: source.sourceRating };
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
            });
            if (!classified) return false;
            const { written } = await upsertClassifiedItem(db, classified);
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
              });
              if (!classified) return false;
              const { written } = await upsertClassifiedItem(db, classified);
              return written;
            })
          );
          created = settled.filter((s) => s.status === "fulfilled" && s.value).length;
        } else {
          // Repli : page sans items structurés → texte global, ancré sur titre+date (pas l'URL).
          const rawText = extractWebText(html);
          degraded = isDegradedWebPage(rawText); // M1 : page coquille (SPA) = source dégradée
          if (rawText && !degraded) {
            const classified = await classifyRawText(rawText, watchlistEntities, { ...context });
            if (classified) {
              const { written } = await upsertClassifiedItem(db, classified);
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

  let settled;
  try {
    settled = await runInBatches(sourcesSnap.docs, AI_CONCURRENCY, processSource);
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

  logger.info(`syncSources: done — sourcesProcessed=${sourcesProcessed}/${sourcesSnap.size} itemsCreated=${itemsCreated}`);
  return { sourcesTotal: sourcesSnap.size, sourcesProcessed, itemsCreated };
}

/**
 * syncSources — Scheduler (quotidien 06:00 Africa/Abidjan). Thin wrapper around runSyncSources().
 * Roadmap: V7 IA & sync.
 */
// 2 GiB : le rendu headless (kind "web-js") lance Chromium, gourmand en mémoire. Les sources
// web-js sont peu nombreuses (portails anti-bot) mais le navigateur doit tenir dans l'instance.
exports.syncSources = onSchedule({ schedule: "0 6 * * *", timeZone: "Africa/Abidjan", region: "europe-west1", timeoutSeconds: 540, memory: "2GiB" }, async () => {
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

  const rawText = `${existing.title || ""}\n${existing.summary || ""}`.trim();
  const classified = await classifyRawText(rawText, watchlistEntities, {
    sourceName: existing.sourceName,
    url: existing.url,
    defaultDate: existing.date,
    defaultSourceRating: existing.sourceRating,
  });
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
exports.onIntelItemWrite = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1", database: FIRESTORE_DATABASE_ID }, async (event) => {
  const db = firestoreDb();
  const after = event.data && event.data.after;

  if (after && after.exists) {
    const item = after.data();
    const computed = computePriorityScore(item);
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
  const snap = await db.collection("intelItems").get();
  // Filtre en mémoire (collection de petite taille) : un `!=` Firestore exclurait les docs sans
  // champ `status`. On re-score tout ce qui n'est pas archivé.
  const active = snap.docs.filter((d) => (d.data().status || "new") !== "archived");
  const updates = active.map(async (doc) => {
    const item = doc.data();
    const computed = computePriorityScore(item);
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
  { schedule: "30 4 * * *", timeZone: "Africa/Abidjan", region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    await runRescoreActive(firestoreDb());
  }
);

/**
 * Recomputes summaries/veille (BUILD_KIT.md §6) from the full `intelItems` collection.
 * Shared so it can be unit-tested / reused without duplicating query logic per trigger.
 */
async function computeVeilleSummary(db) {
  const snap = await db.collection("intelItems").get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  const menacesTotal = items.filter((i) => i.stance === "threat").length;
  // « Traitée » = actionnée OU archivée (audit 2026-07) : une menace archivée est résolue/classée,
  // pas une menace laissée sans réponse — sinon la couverture décisionnelle était sous-estimée.
  const DONE_THREAT_STATUS = new Set(["actioned", "archived"]);
  const menacesTraitees = items.filter((i) => i.stance === "threat" && DONE_THREAT_STATUS.has(i.status)).length;
  const opportunites = items.filter((i) => i.stance === "opportunity").length;
  // Placeholder metric: count of high-impact threats not yet actioned/archived, standing in for
  // a chiffered "exposure" figure until summaries/quanti (V4) can value it in FCFA.
  const threatsExposure = items.filter(
    (i) => i.stance === "threat" && i.impact === "high" && i.status !== "actioned" && i.status !== "archived"
  ).length;

  return {
    boardKpis: {
      menacesTotal,
      menacesTraitees,
      opportunites,
      winRateGlobal, // taux de victoire global (winLoss) — null si aucun deal enregistré
      tti: null, // time-to-insight needs decision timestamps — V6 (decisions collection)
    },
    decisionsPending, // décisions non tranchées (collection decisions)
    porter: quanti ? quanti.porterForces ?? null : null, // from summaries/quanti (nt360 sync)
    winRateByCompetitor, // taux de victoire par concurrent (winLoss)
    pipelineInfluenced, // veille-tracked clients' value-at-stake — see computation above
    threatsExposure,
    okrProgress, // avancement moyen des initiatives (0-1) — null si aucune initiative
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * aggregateVeilleExec — planifié (toutes les 60 min)
 * Construit summaries/veille_exec (boardKpis, decisionsPending, porter, winRateByCompetitor, ...).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeilleExec = onSchedule({ schedule: "every 60 minutes", timeZone: "Africa/Abidjan", region: "europe-west1" }, async () => {
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
    db.collection("intelItems").orderBy("priorityScore", "desc").limit(10).get(),
  ]);

  const veilleSummary = veilleSnap.exists ? veilleSnap.data() : null;
  const veilleExecSummary = veilleExecSnap.exists ? veilleExecSnap.data() : null;
  const topItems = topItemsSnap.docs.map((d) => {
    const it = d.data();
    // ent/date rendus par briefing.js#itemsBlock (Action 4.3) — recommandations nominatives.
    return { title: it.title, axis: it.axis, impact: it.impact, stance: it.stance, soWhat: it.soWhat, priorityScore: it.priorityScore, ent: it.ent, date: it.date };
  });

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
  { schedule: "0 7 * * 5", timeZone: "Africa/Abidjan", region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
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
    const parsed = parseSwotPestelResponse(await generateJson(buildSwotPestelPrompt(signals, companyContext)));
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
    const parsed = parseDiagnosticResponse(await generateJson(buildDiagnosticPrompt(signals, companyContext)));
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
    const parsed = parseGe9Response(await generateJson(buildGe9Prompt(signals, granularite, companyContext)));
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
  for (const [key, build, parse] of [
    ["ansoff", buildAnsoffPrompt, parseAnsoffResponse],
    ["vrio", buildVrioPrompt, parseVrioResponse],
    ["valueChain", buildValueChainPrompt, parseValueChainResponse],
    ["scenarios", buildScenariosPrompt, parseScenariosResponse],
  ]) {
    try {
      const parsed = parse(await generateJson(build(signals, companyContext)));
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

  // 8. Three Horizons — suggestions d'initiatives (frameworks/horizons). L'humain adopte une
  // suggestion en créant l'initiative réelle dans Exécution & Décisions.
  try {
    const parsed = parseHorizonsResponse(await generateJson(buildHorizonsPrompt(signals, companyContext)));
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
    const parsed = parseInnovationBetsResponse(await generateJson(buildInnovationBetsPrompt(signals, companyContext)));
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
  { schedule: "0 5 * * 1", timeZone: "Africa/Abidjan", region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
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
  const [acctSnap, pestelSnap, bizSnap, metaSnap] = await Promise.all([
    accountId ? db.doc(`copiloteAccounts/${accountId}`).get() : Promise.resolve(null),
    db.doc("frameworks/pestel").get(),
    db.collection("bizOpportunities").get(),
    db.doc("summaries/copiloteMeta").get(),
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
  const deals = (Array.isArray(nt.opportunites) ? nt.opportunites : []).map((o) => ({
    titre: `${o.nom} — ${Number.isFinite(o.montant) ? new Intl.NumberFormat("fr-FR").format(o.montant) + " XOF" : "montant n.c."} (${o.etape})`,
  }));
  // SIGNAUX = leads de veille (opportunités business dérivées de la veille). Deux usages distincts :
  //  - `signaux` : échantillon générique pour la PROSPECTION (comptes cibles) ;
  //  - `signauxCompte` : ceux qui NOMMENT ce compte → déclencheurs commerciaux rattachés au portefeuille.
  const bizAll = bizSnap.docs.map((d) => d.data()).filter((o) => o && o.name);
  // Récupération légère (Vague D) : au lieu des 10 PREMIERS leads (ordre Firestore arbitraire), on
  // classe par PERTINENCE au compte (secteur + whitespace + enjeux) — la prospection voit les leads
  // qui comptent pour CE compte, pas un échantillon aveugle.
  const prospectTerms = [a.secteur, ...(Array.isArray(a.whitespace) ? a.whitespace : []), ...(Array.isArray(a.enjeux) ? a.enjeux : [])].filter(Boolean);
  const signaux = pickRelevant(bizAll, { terms: prospectTerms }, 10).map((o) => ({ titre: o.name }));
  const signauxCompte = (a.nom ? nt360MatchSignalsToAccount(a.nom, bizAll) : [])
    .slice(0, 5)
    .map((o) => ({ titre: o.name }));
  // WHITESPACE RÉEL = catalogue d'offres NT (agrégé au sync, summaries/copiloteMeta.buCatalog) MOINS
  // les BU que ce compte a déjà touchées (achetées ou en cours). C'est le cross-sell concret et
  // spécifique — remplace le whitespace vide qui faisait produire des livrables génériques.
  const meta = metaSnap.exists ? metaSnap.data() : {};
  const buCatalog = Array.isArray(meta.buCatalog) ? meta.buCatalog : [];
  const affinity = meta.affinity && typeof meta.affinity === "object" ? meta.affinity : {};
  const ownedBus = [...(Array.isArray(nt.bus) ? nt.bus : []), ...historique.map((h) => h.offre), ...enCours]
    .filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  const touched = new Set(ownedBus.map((x) => x.toLowerCase()));
  const derivedWhitespace = buCatalog.filter((bu) => typeof bu === "string" && bu.trim() && !touched.has(bu.trim().toLowerCase()));
  const humanWhitespace = Array.isArray(a.whitespace) ? a.whitespace.filter((x) => typeof x === "string" && x.trim()) : [];
  const whitespace0 = [...new Set([...humanWhitespace, ...derivedWhitespace])];
  // Classement du whitespace par AFFINITÉ de cross-sell (market basket) + « next best offer ».
  const ranked = nt360RecommendNextOffers(ownedBus, whitespace0, affinity);
  const whitespace = ranked.length ? ranked.map((r) => r.offre) : whitespace0;
  const recoBase = ranked.find((r) => r.csPct > 0) || ranked[0] || null;
  // Chiffrage de la next best offer : panier de référence (médiane du portefeuille) pour son offre.
  const benchmark = meta.buBenchmark && typeof meta.buBenchmark === "object" ? meta.buBenchmark : {};
  const recommendation = recoBase
    ? { ...recoBase, montantEstime: Number(benchmark[recoBase.offre]?.medianCas) || 0 }
    : null;
  const casTotal = Number(nt.casTotal) || 0;
  const pipelinePondere = Number(nt.pipelinePondere) || 0;
  const wins = Number(nt.wins) || 0;
  const enjeux = Array.isArray(a.enjeux) ? a.enjeux : [];
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
    signauxCompte, // déclencheurs de veille nommant CE compte (rattachés au portefeuille)
    deals,   // opportunités réelles du compte (CVP/triennal/plan/chat)
    recommendation, // next best offer data-driven { offre, csPct, montantEstime }
    casTotal,
    pipelinePondere,
    wins,
    account: { nom: a.nom || "", secteur: a.secteur || "", tier: a.tier || "", enjeux, historique, enCours, whitespace, casTotal, pipelinePondere, wins, deals, recommendation, signauxCompte },
  };
}

/**
 * copiloteGenerate — callable. data: { agent, accountId?, extra? }.
 * agent ∈ {prospection, cvp, triennal, planCompte, redaction}. `extra` fusionne des champs ctx
 * fournis par l'écran (ex. redaction : {kind, canal, ton, contexte}).
 */
// Champs d'écran que le client a le droit de fournir (redaction) — tout le reste du contexte est
// assemblé côté serveur depuis nt360/veille et ne doit PAS être surchargé par le client.
const COPILOTE_EXTRA_ALLOWED = ["kind", "canal", "ton", "contexte", "compte"];
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
  matchSignalsToAccount: nt360MatchSignalsToAccount,
  copiloteAccountMatchesScope: nt360AccountMatchesScope,
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
  const { pipelinePondere, winRate } = computePipeline({ opportunities });
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
  { schedule: "30 5 * * *", timeZone: "Africa/Abidjan", region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
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
  // Écriture par lots (audit Copilote 2026-07) : le portefeuille réel compte ~800 comptes. Un
  // `await set()` par compte = ~800 allers-retours séquentiels (lent, et fragile à mesure que le
  // portefeuille grossit). On commit par lots de 400 (< la limite Firestore de 500 ops/commit) :
  // 2 allers-retours au lieu de 800. Merge additif inchangé (les champs qualitatifs restent intacts).
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < derived.length; i += CHUNK) {
    const slice = derived.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const acc of slice) {
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
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
    }
    await batch.commit();
    written += slice.length;
  }
  // Catalogue d'offres NT = union de toutes les BU réelles observées dans le pipeline. Sert au calcul
  // du whitespace RÉEL par compte (catalogue − BU déjà touchées) → livrables IA spécifiques, non génériques.
  const buCatalog = [...new Set(derived.flatMap((acc) => Array.isArray(acc.bus) ? acc.bus : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))].sort();
  // Affinité de cross-sell (market basket) sur tout le portefeuille : « les comptes qui achètent X
  // achètent aussi Y » → base de la recommandation « next best offer » par compte.
  const affinity = nt360DeriveBuAffinity(derived);
  // Panier de référence par offre (médiane du CAS cumulé par compte) → CHIFFRE la « next best offer ».
  const buBenchmark = nt360DeriveBuBenchmark(derived);
  await db.doc("summaries/copiloteMeta").set(
    { buCatalog, affinity, buBenchmark, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  logger.info(`runSyncCopiloteAccounts: ${written} comptes copilote pré-remplis depuis nt360 (catalogue ${buCatalog.length} offres)`);
  return { accounts: written, buCatalog: buCatalog.length };
}

exports.syncCopiloteAccounts = onSchedule(
  { schedule: "45 5 * * *", timeZone: "Africa/Abidjan", region: "europe-west1", timeoutSeconds: 540, memory: "512MiB" },
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
  { schedule: "0 2 * * *", timeZone: "Africa/Abidjan", region: "europe-west1" },
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
