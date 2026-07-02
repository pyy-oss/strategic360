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

initializeApp();

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
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.scoreItems = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("scoreItems", "V3 Scoring & agrégats veille");
});

/**
 * aggregateVeille — onWrite intelItems + planifié
 * Construit summaries/veille (countsByAxis, countsByImpact, topThreats/Opportunities, ...).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeille = onDocumentWritten({ document: "intelItems/{id}", region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("aggregateVeille", "V3 Scoring & agrégats veille");
});

/**
 * aggregateVeilleExec — onWrite + planifié
 * Construit summaries/veille_exec (boardKpis, decisionsPending, porter, winRateByCompetitor, ...).
 * Roadmap: V3 Scoring & agrégats veille.
 */
exports.aggregateVeilleExec = onSchedule({ schedule: "every 60 minutes", region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("aggregateVeilleExec", "V3 Scoring & agrégats veille");
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
