"use strict";

/**
 * Cloud Functions (Node 20) — "Veille Stratégique" (Neurones Technologies CI).
 *
 * V0 (Socle & design): structure only — correct Cloud Functions v2 trigger signatures per
 * BUILD_KIT.md §10, bodies throw "not implemented" pending their roadmap phase. No Vertex AI
 * calls yet (that's V7). No real Firestore/Storage wiring yet (V2-V6).
 */

const { initializeApp } = require("firebase-admin/app");
const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const logger = require("firebase-functions/logger");

initializeApp();

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
 * Pose le custom claim `role` + audit.
 * Roadmap: V1 Auth & RBAC.
 */
exports.setUserRole = onCall({ region: "europe-west1" }, async () => {
  NOT_IMPLEMENTED("setUserRole", "V1 Auth & RBAC");
});
