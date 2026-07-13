"use strict";

/**
 * domain/pipeline.js — CADENCE & PAUSE des pipelines planifiés (maîtrise des coûts Vertex/Cloud Run).
 *
 * Les crons IA (sync, évaluation, enrichissement, briefing) et l'agrégat exec sont la source
 * principale de coût (un appel Gemini par signal évalué, etc.). Plutôt que de figer la fréquence au
 * déploiement, on la rend AJUSTABLE EN DIRECT depuis l'app : un doc `config/runtime` porte un
 * intervalle minimum (minutes) par pipeline et un interrupteur `paused` global. Chaque cron
 * consulte cette config AVANT tout appel Vertex et se court-circuite s'il a déjà tourné il y a moins
 * de `minIntervalMinutes` — l'appel coûteux n'a alors jamais lieu.
 *
 * Ce module ne contient QUE la décision PURE (aucune I/O) : l'orchestration Firestore (lecture de
 * config/runtime, estampille de lastRun dans une transaction) vit dans index.js. Testé unitairement.
 */

/** Clés de pipeline pilotables (doivent matcher les gates dans index.js et les libellés front). */
const PIPELINE_KEYS = ["sync", "evaluate", "aggregate", "enrich", "briefing"];

/** Borne haute d'un intervalle (30 jours en minutes) — garde-fou contre une saisie absurde. */
const MAX_INTERVAL_MINUTES = 43200;

/**
 * pipelineThrottleDecision({ cfg, key, nowMs }) → { run, reason, ... }.
 * PUR. `cfg` = données de config/runtime (peut être vide) ; `key` = pipeline ; `nowMs` = horloge.
 * `cfg.lastRunMs[key]` : date du dernier run en ms epoch (déjà résolue par l'appelant).
 *
 * - paused === true            → run:false, reason:"paused"
 * - intervalle défini (>0) et dernier run trop récent → run:false, reason:"throttled"
 * - sinon                      → run:true, reason:"ok"
 * Défensif : une config absente/invalide n'empêche JAMAIS l'exécution (on ne fige pas le pipeline
 * sur une erreur de lecture — c'est l'appelant qui gère le fail-open).
 */
function pipelineThrottleDecision({ cfg, key, nowMs }) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  if (c.paused === true) return { run: false, reason: "paused" };
  const intervals = c.intervals && typeof c.intervals === "object" ? c.intervals : {};
  const minMin = Number(intervals[key]);
  const lastMs = Number((c.lastRunMs && c.lastRunMs[key]) ?? NaN);
  if (Number.isFinite(minMin) && minMin > 0 && Number.isFinite(lastMs)) {
    const elapsedMs = nowMs - lastMs;
    if (elapsedMs < minMin * 60000) {
      return { run: false, reason: "throttled", minMin, elapsedMin: Math.max(0, Math.round(elapsedMs / 60000)) };
    }
  }
  return { run: true, reason: "ok" };
}

/**
 * sanitizePipelineIntervals(obj) → objet { key: minutes } nettoyé (clés connues uniquement, entiers
 * ≥ 0, plafonnés). PUR. Sert à valider l'entrée du callable setPipelineConfig. 0 = cadence native
 * (aucun throttle) ; > 0 = intervalle minimum entre deux runs automatiques.
 */
function sanitizePipelineIntervals(obj) {
  const src = obj && typeof obj === "object" ? obj : {};
  const out = {};
  for (const k of PIPELINE_KEYS) {
    const v = Number(src[k]);
    if (Number.isFinite(v) && v >= 0) {
      out[k] = Math.min(Math.round(v), MAX_INTERVAL_MINUTES);
    }
  }
  return out;
}

module.exports = {
  PIPELINE_KEYS,
  MAX_INTERVAL_MINUTES,
  pipelineThrottleDecision,
  sanitizePipelineIntervals,
};
