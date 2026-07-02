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
const logger = require("firebase-functions/logger");
const { computePriorityScore } = require("./domain/scoring");

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

const NOT_IMPLEMENTED = (fn, phase) => {
  const msg = `${fn} not implemented — see BUILD_KIT.md roadmap ${phase}`;
  logger.warn(msg);
  throw new Error(msg);
};

/**
 * ingestInternal — Storage onFinalize (imports/*.xlsx)
 * SheetJS: parse P&L / LIVE / Facturation DF / fiche affaire → summaries/quanti
 * (Porter, BCG/GE, pipeline pondéré, win rate, marge, saturation, KRIs, value-at-stake).
 * Roadmap: V4 Quanti interne.
 */
exports.ingestInternal = onObjectFinalized({ region: "europe-west1" }, async (event) => {
  const filePath = event.data?.name;
  if (!filePath || !filePath.startsWith("imports/")) return;
  NOT_IMPLEMENTED("ingestInternal", "V4 Quanti interne");
});

/**
 * syncSources — Scheduler (quotidien 06:00)
 * Récupère intelSources (RSS/web/portails) → classifyAI → crée intelItems{status:new}.
 * Roadmap: V7 IA & sync.
 */
exports.syncSources = onSchedule({ schedule: "0 6 * * *", timeZone: "Africa/Abidjan", region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("syncSources", "V7 IA & sync");
});

/**
 * classifyAI — appelée par syncSources
 * Vertex AI / Gemini : résumé, classification (axe/type/imminence/impact/posture),
 * entity resolution, so-what + action, signaux faibles.
 * Roadmap: V7 IA & sync.
 */
exports.classifyAI = onCall({ region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("classifyAI", "V7 IA & sync");
});

/**
 * scoreItems — onWrite intelItems
 * Calcule priorityScore (BUILD_KIT.md §8.1) : credibilite × (impact/alignement/probabilite/proximite).
 * Guarded against infinite retrigger loops: only writes when the computed score differs from
 * the currently stored one (this function's own write would otherwise re-trigger itself forever).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.scoreItems = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1" }, async (event) => {
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
exports.aggregateVeille = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1" }, async () => {
  const db = getFirestore();
  const summary = await computeVeilleSummary(db);
  await db.doc("summaries/veille").set(summary);
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
exports.aggregateVeilleExec = onSchedule({ schedule: "every 60 minutes", region: "europe-west1" }, async () => {
  const db = getFirestore();
  const summary = await computeVeilleExecSummary(db);
  await db.doc("summaries/veille_exec").set(summary);
});

/**
 * aggregateVeilleExecOnWrite — onWrite intelItems (companion trigger to aggregateVeilleExec)
 * Keeps summaries/veille_exec fresh in near-real-time as signals are created/updated, instead of
 * waiting for the hourly schedule. Shares computeVeilleExecSummary with the scheduled trigger to
 * avoid duplicating the computation (BUILD_KIT.md §10 lists this pair as "onWrite + planifié").
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeilleExecOnWrite = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1" }, async () => {
  const db = getFirestore();
  const summary = await computeVeilleExecSummary(db);
  await db.doc("summaries/veille_exec").set(summary);
});

/**
 * generateBriefing — callable / planifié
 * IA : idée directrice + 3 arguments MECE + KPIs → briefings (revue humaine obligatoire).
 * Roadmap: V7 IA & sync.
 */
exports.generateBriefing = onCall({ region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("generateBriefing", "V7 IA & sync");
});

/**
 * exportPdf — callable
 * Board pack / one-pager PDF (pdfkit) → Storage (URL signée).
 * Roadmap: V7 IA & sync.
 */
exports.exportPdf = onCall({ region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("exportPdf", "V7 IA & sync");
});

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
exports.setUserRole = onCall({ region: "europe-west1" }, async (request) => {
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

  const db = getFirestore();
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

  await getAuth().setCustomUserClaims(uid, { role });

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
