"use strict";

/**
 * Domain logic: signal priority scoring (BUILD_KIT.md §8.1 / DELTA_01B §3.1-3.2).
 *
 * priorityScore = 100 × credibilite × (0.35·impact + 0.25·alignementStrategique
 *                                       + 0.20·probabilite + 0.20·proximite)
 * Each factor ∈ [0,1]. Result rounded to an integer 0-100.
 *
 * Roadmap: V3 Scoring & agrégats veille. Called by `scoreItems` in functions/index.js.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `impact` factor — BUILD_KIT.md §8.1: IntelItem.impact ∈ 'high'|'medium'|'low'.
 * high=1.0, medium=0.6, low=0.3. Unknown/missing → 0.6 (medium) as a conservative default.
 */
function impactFactor(impact) {
  switch (impact) {
    case "high":
      return 1.0;
    case "medium":
      return 0.6;
    case "low":
      return 0.3;
    default:
      return 0.6;
  }
}

/**
 * `credibilite` factor — derived from the admiralty-code `sourceRating` ("A1".."F5",
 * DELTA_01B §3.2): a reliability LETTER (A totalement fiable → F indéterminée) plus a
 * credibility DIGIT (1 confirmée → 5 improbable).
 *
 * Table chosen here (documented — BUILD_KIT/DELTA are not fully explicit on the numeric
 * mapping, only the qualitative scale):
 *   - Reliability letter (6 steps, A best → F worst): A=1.0, B=0.8, C=0.6, D=0.4, E=0.2, F=0.2
 *     (E and F both bottom out at 0.2 since the [0,1] scale only has 5 "rungs" for 6 letters —
 *     E "source largement fiable par le passé" and F "fiabilité ne peut être appréciée" are
 *     both treated as low-trust).
 *   - Credibility digit (5 steps, 1 best → 5 worst): {1:1.0, 2:0.8, 3:0.6, 4:0.4, 5:0.2}.
 *   - credibilite = (reliabilityScore + credibilityScore) / 2.
 * Unparseable/missing sourceRating → 0.5 (neutral fallback), documented here rather than
 * silently defaulting to a table entry.
 */
const RELIABILITY_TABLE = { A: 1.0, B: 0.8, C: 0.6, D: 0.4, E: 0.2, F: 0.2 };
const CREDIBILITY_TABLE = { 1: 1.0, 2: 0.8, 3: 0.6, 4: 0.4, 5: 0.2 };

function credibiliteFactor(sourceRating) {
  if (typeof sourceRating !== "string") return 0.5;
  const m = /^([A-Fa-f])\s*([1-5])$/.exec(sourceRating.trim());
  if (!m) return 0.5;
  const letter = m[1].toUpperCase();
  const digit = m[2];
  const reliabilityScore = RELIABILITY_TABLE[letter];
  const credibilityScore = CREDIBILITY_TABLE[digit];
  if (reliabilityScore === undefined || credibilityScore === undefined) return 0.5;
  return (reliabilityScore + credibilityScore) / 2;
}

/**
 * `alignementStrategique` factor — PENDING V6 (no strategic-pillar linkage field on intelItems
 * yet; that arrives with `strategicThemes`/`initiatives` in V6). Cheap proxy used meanwhile:
 * axes closer to commercial execution (partenaires, clients_prospects) score higher (0.75)
 * than the rest (concurrents/tech/reglementaire, 0.6 — still a reasonable "aligned by default"
 * baseline). Replace with a real signal→pillar link in V6.
 */
function alignementFactor(axis) {
  return axis === "partenaires" || axis === "clients_prospects" ? 0.75 : 0.6;
}

/**
 * `probabilite` factor — PENDING V7 (no IA-estimated likelihood yet; `classifyAI` will derive
 * this from source language/confidence in V7 IA & sync). Constant placeholder meanwhile.
 */
function probabiliteFactor() {
  return 0.7;
}

/**
 * `proximite` factor — urgency/imminence (BUILD_KIT.md §8.1 "échéance/urgence"). Derived from
 * `dueDate` when present (days remaining until the deadline: sooner = more proximate/urgent),
 * else from `date` (days since the signal: fresher = more proximate). Overdue due dates are
 * clamped to the "imminent" end (proximite=1.0) rather than penalized.
 * Decay: 1.0 for <=7 days, linearly down to 0.3 at >=90 days, 0.3 beyond that.
 * No usable date at all → 0.3 (most conservative / least proximate).
 */
function proximiteFactor(item, now = Date.now()) {
  const dueMs = item && item.dueDate ? Date.parse(item.dueDate) : NaN;
  const dateMs = item && item.date ? Date.parse(item.date) : NaN;

  let days;
  if (!Number.isNaN(dueMs)) {
    days = Math.max((dueMs - now) / MS_PER_DAY, 0);
  } else if (!Number.isNaN(dateMs)) {
    days = Math.max((now - dateMs) / MS_PER_DAY, 0);
  } else {
    return 0.3;
  }

  if (days <= 7) return 1.0;
  if (days >= 90) return 0.3;
  const t = (days - 7) / (90 - 7);
  return 1.0 - t * (1.0 - 0.3);
}

/**
 * Computes the 0-100 priorityScore (BUILD_KIT.md §8.1) for an intelItems document body.
 * @param {{impact?:string, sourceRating?:string, axis?:string, date?:string, dueDate?:string}} item
 * @param {number} [now] injectable clock (ms epoch) for deterministic tests.
 */
function computePriorityScore(item, now = Date.now()) {
  const impact = impactFactor(item && item.impact);
  const credibilite = credibiliteFactor(item && item.sourceRating);
  const alignementStrategique = alignementFactor(item && item.axis);
  const probabilite = probabiliteFactor();
  const proximite = proximiteFactor(item, now);

  const raw = 100 * credibilite * (0.35 * impact + 0.25 * alignementStrategique + 0.2 * probabilite + 0.2 * proximite);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

module.exports = {
  computePriorityScore,
  impactFactor,
  credibiliteFactor,
  alignementFactor,
  probabiliteFactor,
  proximiteFactor,
  RELIABILITY_TABLE,
  CREDIBILITY_TABLE,
};
