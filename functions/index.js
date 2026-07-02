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
const { computePorterForces, computeBcg, computeCasSummary, computePipeline, computeKris, computeValueAtStake } = require("./domain/quanti");
const { intelItemId } = require("./domain/ids");
const { buildClassificationPrompt, parseClassificationResponse } = require("./domain/classify");
const { buildBriefingPrompt, parseBriefingResponse } = require("./domain/briefing");
const { buildBriefingPdf } = require("./domain/pdf");
const { generateJson } = require("./domain/vertex");
const PDFDocument = require("pdfkit");
const { v1: firestoreAdminV1 } = require("@google-cloud/firestore");

initializeApp();

/**
 * Subtype label used by the sample "Fil de veille" data (web/src/modules/veille/data.ts) for
 * tenders/AO items. NOTE: as of V2, the "Nouvelle fiche de veille" contribution form
 * (web/src/modules/veille/views/Fil.tsx) does not yet collect a `subtype` field at all, so
 * `tendersOpen` will read 0 for real (form-submitted) items until a later phase adds subtype
 * capture to the form / classifyAI (V7). Kept here so aggregation is correct as soon as that
 * field starts being populated (matches the maquette's `sub: "Appel d'offres"` convention).
 */
const TENDER_SUBTYPE = "Appel d'offres";

/**
 * Some intelSources (SIGMAP/DGMP, ARMP, etc.) return 403 to Node's default fetch — most likely
 * bot-detection rejecting the absent/generic default User-Agent, per a real syncSources run
 * against propulse-business-87f7a (2026-07-02). A realistic browser-ish User-Agent is a low-risk
 * mitigation for that class of failure; sites with stricter anti-bot measures (Cloudflare
 * challenges, JS-rendered content) will still fail and need a different ingestion approach later.
 */
const SOURCE_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; VeilleStrategiqueBot/1.0; +https://strategic360.web.app)",
  Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8",
};

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

  return {
    porterForces,
    bcg,
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

    const summary = await computeSummaryQuanti(db);
    await db.doc("summaries/quanti").set(summary);

    logger.info(`ingestInternal: kind=${kind} file=${filePath} rowsIn=${rowsIn} rowsOk=${rowsOk} warnings=${warnings.length}`);
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
    items.push({ title: grab("title"), description: grab("description"), link: grab("link") });
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
 * Classifies one raw text extract via Vertex AI (buildClassificationPrompt → generateJson →
 * parseClassificationResponse) and returns the parsed IntelItem fields, or `null` if the AI
 * response was unusable (mirrors `parseClassificationResponse`'s contract).
 */
async function classifyRawText(rawText, watchlistEntities, context) {
  const prompt = buildClassificationPrompt(rawText, watchlistEntities);
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

  for (const sourceDoc of sourcesSnap.docs) {
    const source = { id: sourceDoc.id, ...sourceDoc.data() };
    try {
      if (source.kind === "manual") {
        logger.info(`syncSources: skip ${source.id} (kind=manual, no auto-fetch)`);
        continue;
      }
      if (!source.url) {
        logger.warn(`syncSources: skip ${source.id} — no url configured for kind=${source.kind}`);
        continue;
      }

      const context = { sourceName: source.name, defaultSourceRating: source.sourceRating };

      if (source.kind === "rss" || source.kind === "newsletter" || source.kind === "portal") {
        const res = await fetch(source.url, { headers: SOURCE_FETCH_HEADERS });
        if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
        const xml = await res.text();
        const rssItems = extractRssItems(xml);
        for (const rssItem of rssItems) {
          const rawText = `${rssItem.title}\n${rssItem.description}`.trim();
          if (!rawText) continue;
          const classified = await classifyRawText(rawText, watchlistEntities, {
            ...context,
            url: rssItem.link || source.url,
          });
          if (classified) {
            const { written } = await upsertClassifiedItem(db, classified);
            if (written) itemsCreated += 1;
          }
        }
      } else if (source.kind === "web") {
        const res = await fetch(source.url, { headers: SOURCE_FETCH_HEADERS });
        if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
        const html = await res.text();
        const rawText = extractWebText(html);
        if (rawText) {
          const classified = await classifyRawText(rawText, watchlistEntities, { ...context, url: source.url });
          if (classified) {
            const { written } = await upsertClassifiedItem(db, classified);
            if (written) itemsCreated += 1;
          }
        }
      } else {
        logger.warn(`syncSources: skip ${source.id} — unrecognized kind "${source.kind}"`);
        continue;
      }

      await sourceDoc.ref.update({
        lastFetch: FieldValue.serverTimestamp(),
        lastStatus: "ok",
        consecutiveFailures: 0,
      });
      sourcesProcessed += 1;
    } catch (err) {
      // Documented per task brief: one failing source must never abort the whole sync.
      logger.error(`syncSources: source ${source.id} (${source.kind}) failed — ${err.message}`);
      // Source health tracking (self-curating pipeline — "100% automatique"): record the failure
      // on the source doc; after MAX_CONSECUTIVE_FAILURES straight failures the source is
      // auto-deactivated so dead feeds stop wasting fetch/AI cycles and surface visibly in the UI
      // (active=false). A human can re-activate after fixing the URL.
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
    }
  }

  logger.info(`syncSources: done — sourcesProcessed=${sourcesProcessed}/${sourcesSnap.size} itemsCreated=${itemsCreated}`);
  return { sourcesTotal: sourcesSnap.size, sourcesProcessed, itemsCreated };
}

/**
 * syncSources — Scheduler (quotidien 06:00 Africa/Abidjan). Thin wrapper around runSyncSources().
 * Roadmap: V7 IA & sync.
 */
exports.syncSources = onSchedule({ schedule: "0 6 * * *", timeZone: "Africa/Abidjan", region: "europe-west1" }, async () => {
  await runSyncSources(firestoreDb());
});

/**
 * syncSourcesNow — callable (manual on-demand trigger). Same runSyncSources() logic as the
 * schedule, exposed so a run can be tested/forced without waiting for the daily 06:00 slot.
 * Exec-gated, same pattern as classifyAI/generateBriefing/exportPdf.
 * Roadmap: V7 IA & sync (added post-deploy for real-data onboarding).
 */
exports.syncSourcesNow = onCall(CALLABLE_OPTS, async (request) => {
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
exports.classifyAI = onCall(CALLABLE_OPTS, async (request) => {
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
 * scoreItems — onWrite intelItems
 * Calcule priorityScore (BUILD_KIT.md §8.1) : credibilite × (impact/alignement/probabilite/proximite).
 * Guarded against infinite retrigger loops: only writes when the computed score differs from
 * the currently stored one (this function's own write would otherwise re-trigger itself forever).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.scoreItems = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1", database: FIRESTORE_DATABASE_ID }, async (event) => {
  const after = event.data && event.data.after;
  if (!after || !after.exists) return; // deleted — nothing to score

  const item = after.data();
  const computed = computePriorityScore(item);
  if (item.priorityScore === computed) return; // no-op guard: avoid re-triggering ourselves

  await after.ref.update({ priorityScore: computed });
  logger.info(`scoreItems: ${after.ref.path} priorityScore=${computed}`);
});

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

  for (const it of items) {
    if (it.axis) countsByAxis[it.axis] = (countsByAxis[it.axis] || 0) + 1;
    if (it.impact) countsByImpact[it.impact] = (countsByImpact[it.impact] || 0) + 1;
    if (it.geo) countsByGeo[it.geo] = (countsByGeo[it.geo] || 0) + 1;
    if (it.ent) entityCounts[it.ent] = (entityCounts[it.ent] || 0) + 1;
    if (it.subtype === TENDER_SUBTYPE && it.status !== "archived") tendersOpen += 1;
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
 * aggregateVeille — onWrite intelItems
 * Construit summaries/veille (countsByAxis, countsByImpact, topThreats/Opportunities, ...).
 * Writes to a DIFFERENT document than intelItems, so no self-retrigger risk (unlike scoreItems,
 * no guard is needed here — recomputing on every intelItems write, including scoreItems's own
 * priorityScore update, is exactly what keeps this summary fresh).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeille = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1", database: FIRESTORE_DATABASE_ID }, async (event) => {
  const db = firestoreDb();
  try {
    const summary = await computeVeilleSummary(db);
    await db.doc("summaries/veille").set(summary);
  } catch (err) {
    // Observability (V8): without this, a failure here silently leaves summaries/veille stale —
    // Radar exécutif/Fil would keep showing outdated counts with no visible error anywhere.
    logger.error(`aggregateVeille: FAILED for ${event.document} — ${err.message}`, { err });
    throw err;
  }
});

/**
 * Recomputes summaries/veille_exec (BUILD_KIT.md §6 / DELTA_01B §13). Shared by the scheduled
 * trigger and the intelItems onWrite trigger below.
 *
 * Several fields depend on collections/features that don't exist yet (documented per-field):
 * decisions/winLoss/initiatives/summaries.quanti are later roadmap phases (V4/V6).
 */
async function computeVeilleExecSummary(db) {
  const snap = await db.collection("intelItems").get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const menacesTotal = items.filter((i) => i.stance === "threat").length;
  const menacesTraitees = items.filter((i) => i.stance === "threat" && i.status === "actioned").length;
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
      tti: null, // time-to-insight needs decision timestamps — V6 (decisions collection)
    },
    decisionsPending: [], // decisions collection is V6
    porter: null, // summaries/quanti (Porter forces from internal data) is V4
    winRateByCompetitor: {}, // winLoss collection is V6
    pipelineInfluenced: 0, // needs opportunities/pipeline linkage — V4+
    threatsExposure,
    okrProgress: null, // initiatives collection is V6
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
 * aggregateVeilleExecOnWrite — onWrite intelItems (companion trigger to aggregateVeilleExec)
 * Keeps summaries/veille_exec fresh in near-real-time as signals are created/updated, instead of
 * waiting for the hourly schedule. Shares computeVeilleExecSummary with the scheduled trigger to
 * avoid duplicating the computation (BUILD_KIT.md §10 lists this pair as "onWrite + planifié").
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeilleExecOnWrite = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1", database: FIRESTORE_DATABASE_ID }, async (event) => {
  const db = firestoreDb();
  try {
    const summary = await computeVeilleExecSummary(db);
    await db.doc("summaries/veille_exec").set(summary);
  } catch (err) {
    logger.error(`aggregateVeilleExecOnWrite: FAILED for ${event.document} — ${err.message}`, { err });
    throw err;
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
exports.generateBriefing = onCall(CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "générer un briefing");

  const db = firestoreDb();
  const [veilleSnap, veilleExecSnap, topItemsSnap] = await Promise.all([
    db.doc("summaries/veille").get(),
    db.doc("summaries/veille_exec").get(),
    db.collection("intelItems").orderBy("priorityScore", "desc").limit(10).get(),
  ]);

  const veilleSummary = veilleSnap.exists ? veilleSnap.data() : null;
  const veilleExecSummary = veilleExecSnap.exists ? veilleExecSnap.data() : null;
  const topItems = topItemsSnap.docs.map((d) => {
    const it = d.data();
    return { title: it.title, axis: it.axis, impact: it.impact, stance: it.stance, soWhat: it.soWhat, priorityScore: it.priorityScore };
  });

  const now = new Date();
  const period = `semaine du ${now.toISOString().slice(0, 10)}`;

  const prompt = buildBriefingPrompt({ veilleSummary, veilleExecSummary, topItems, period });
  const response = await generateJson(prompt);
  const briefing = parseBriefingResponse(response, {
    period,
    generatedBy: `vertex-ai:${request.auth.uid}`,
    kpis: veilleExecSummary?.boardKpis ?? null,
  });
  if (!briefing) {
    throw new HttpsError("internal", "La réponse IA n'a pas pu être exploitée (contenu vide/incomplet).");
  }

  const ref = await db.collection("briefings").add({ ...briefing, createdAt: FieldValue.serverTimestamp() });
  logger.info(`generateBriefing: created briefings/${ref.id} caller=${request.auth.uid}`);
  return { id: ref.id, status: briefing.status };
});

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
async function runEnrichment(db) {
  const itemsSnap = await db.collection("intelItems").get();
  const signals = pickSignalsForEnrichment(itemsSnap.docs.map((d) => d.data()));

  if (!signals.length) {
    logger.info("runEnrichment: no non-archived intelItems — nothing to enrich, skipping");
    return { skipped: true };
  }

  const summary = { swotPestel: "failed", techRadarBlips: 0, battlecardMoves: 0 };

  // 1. SWOT + PESTEL frameworks -----------------------------------------------------------------
  try {
    const parsed = parseSwotPestelResponse(await generateJson(buildSwotPestelPrompt(signals)));
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
      const parsed = parseTechRadarResponse(await generateJson(buildTechRadarPrompt(techSignals)));
      if (!parsed) {
        logger.error("runEnrichment: tech radar response unusable (parse returned null)");
      } else {
        for (const blip of parsed.blips) {
          const ref = db.doc(`techRadar/${enrichSlugId(blip.name)}`);
          const existing = await ref.get();
          // merge:true — a human-created blip with the same slug only gets its
          // ring/momentum/rationale refreshed, its other fields survive.
          await ref.set(
            {
              ...blip,
              generatedBy: "ai",
              ...(existing.exists ? {} : { linkedItems: [] }),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        summary.techRadarBlips = parsed.blips.length;
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
      const parsed = parseBattlecardMovesResponse(await generateJson(buildBattlecardMovesPrompt(competitorSignals)));
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

  logger.info(`runEnrichment: done — ${JSON.stringify(summary)} (signals=${signals.length})`);
  return summary;
}

/**
 * enrichStrategicArtifacts — Scheduler (hebdomadaire, lundi 05:00 Africa/Abidjan).
 * Regenerates the strategic artifacts from the week's accumulated signals via `runEnrichment`.
 */
exports.enrichStrategicArtifacts = onSchedule(
  { schedule: "0 5 * * 1", timeZone: "Africa/Abidjan", region: "europe-west1" },
  async () => {
    await runEnrichment(firestoreDb());
  }
);

/**
 * enrichNow — callable, exec-gated (same pattern as syncSourcesNow/classifyAI): triggers the
 * enrichment pipeline on demand and returns its summary.
 */
exports.enrichNow = onCall(CALLABLE_OPTS, async (request) => {
  requireExecCaller(request, "lancer l'enrichissement IA");
  const result = await runEnrichment(firestoreDb());
  logger.info(`enrichNow: caller=${request.auth.uid} result=${JSON.stringify(result)}`);
  return result;
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
exports.exportPdf = onCall(CALLABLE_OPTS, async (request) => {
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
