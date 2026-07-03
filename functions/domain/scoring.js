"use strict";

/**
 * Domain logic: signal priority scoring (BUILD_KIT.md §8.1, révisé par l'audit de
 * pertinence 2026-07 — Actions 5.1/5.2 du plan consolidé).
 *
 * priorityScore = 100 × (0.4 + 0.6·credibilite)
 *                     × (0.30·impact + 0.25·proximite + 0.20·potentielBusiness
 *                        + 0.15·alignement + 0.10·probabilite)
 *
 * Chaque facteur ∈ [0,1] ; résultat arrondi à l'entier, clampé [0,100].
 *
 * Changements vs l'ancien barème (100 × credibilite × (0.35·impact + 0.25·alignement
 * + 0.20·probabilite + 0.20·proximite)) :
 *   - `credibilite` devient un PLANCHER multiplicatif (0.4 + 0.6·c) au lieu d'un facteur
 *     brut : une source moyenne n'écrase plus mécaniquement un signal business fort.
 *   - Nouveau facteur `potentielBusiness` (poids 0.20) dérivé de `subtype` (SUBTYPE_BUSINESS)
 *     avec bonus stance=opportunity (+0.1) et budgetIdentified (+0.1).
 *   - `alignement` est recalibré par axe (AXIS_ALIGN) avec bonus +0.2 si une entité de la
 *     watchlist est résolue (`item.ent`).
 *   - `proximite` lit enfin l'enum `prox` du classifieur (PROX_TABLE) : chaîne de priorité
 *     dueDate → prox → décote sur la fraîcheur de `date` (plafonnée à 0.5 : un item
 *     simplement "frais" n'est plus traité comme un item à échéance imminente) → 0.3.
 *
 * Exemple chiffré (cf. plan d'audit, Action 5.2 — corrige l'inversion constatée) :
 *   - AO BCEAO imminent (impact high, C3, axis clients_prospects, subtype tender,
 *     stance opportunity, ent résolue) : ancien barème ≈ 53 → nouveau ≈ 74.
 *     Détail : (0.4 + 0.6×0.6) × (0.30×1.0 + 0.25×1.0 + 0.20×1.0 + 0.15×1.0 + 0.10×0.7)
 *            = 0.76 × 0.97 = 0.7372 → 74.
 *   - Brève tech fraîche (impact high, A1, axis tech, sans subtype ni échéance) :
 *     ancien barème ≈ 84 → nouveau ≈ 64.
 *     Détail : 1.0 × (0.30×1.0 + 0.25×0.5 + 0.20×0.4 + 0.15×0.45 + 0.10×0.7)
 *            = 0.6425 → 64.
 *
 * Défaut d'impact : 'medium' (0.6) — aligné avec le défaut du parseur de classification
 * (Action 5.5, partie scoring).
 *
 * Roadmap: V3 Scoring & agrégats veille. Called by `scoreItems` in functions/index.js.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `impact` factor — BUILD_KIT.md §8.1: IntelItem.impact ∈ 'high'|'medium'|'low'.
 * high=1.0, medium=0.6, low=0.3. Unknown/missing → 0.6 ('medium'), défaut aligné avec
 * le parseur de classification (Action 5.5).
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
 *
 * NOTE (Action 5.2) : dans computePriorityScore, ce facteur est appliqué via le plancher
 * multiplicatif (0.4 + 0.6·credibilite) et non plus brut.
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
 * `potentielBusiness` factor (Action 5.2) — proxy de convertibilité commerciale du signal,
 * dérivé du `subtype` produit par le classifieur. Un AO (tender) ou un financement est
 * directement actionnable par le commerce ; un lancement produit l'est beaucoup moins.
 * Bonus : stance "opportunity" (+0.1) et budget explicitement identifié dans le texte
 * (`budgetIdentified`, +0.1), plafonnés à 1. Subtype inconnu/absent → 0.4.
 */
const SUBTYPE_BUSINESS = {
  tender: 1.0,
  funding: 0.9,
  eol: 0.9,
  regulation: 0.85,
  budget: 0.85,
  // Guet des mouvements d'acteurs (2026-07 : création/arrivée d'entreprises, expansion de
  // groupes, nouveaux entrants) — fort potentiel business, juste sous les AO/financements.
  implantation: 0.75,
  market_entry: 0.7,
  expansion: 0.65,
  pricing: 0.6,
  program_change: 0.6,
  ma: 0.55,
  win: 0.5,
  product_launch: 0.45,
};

function businessFactor(item) {
  let f = SUBTYPE_BUSINESS[item?.subtype] ?? 0.4;
  if (item?.stance === "opportunity") f = Math.min(1, f + 0.1);
  if (item?.budgetIdentified) f = Math.min(1, f + 0.1);
  return f;
}

/**
 * `alignement` factor (Action 5.2) — alignement stratégique par axe (AXIS_ALIGN : les axes
 * proches de l'exécution commerciale scorent plus haut ; la veille tech mondiale reste utile
 * mais moins alignée), avec bonus +0.2 (plafonné à 1) quand le classifieur a résolu une
 * entité de la watchlist (`item.ent`) — un signal rattaché à un client/concurrent/éditeur
 * suivi est par construction plus aligné. Remplace le proxy binaire 0.75/0.6 pré-audit.
 * Axe inconnu/absent → 0.6.
 */
const AXIS_ALIGN = {
  clients_prospects: 0.9, // 0.9 (et non 1.0) pour que les bonus géo/watchlist restent discriminants avant clamp

  reglementaire: 0.75,
  partenaires: 0.7,
  concurrents: 0.6,
  tech: 0.45,
};

function alignementFactor(item) {
  const base = AXIS_ALIGN[item?.axis] ?? 0.6;
  // Bonus géographique (2026-07, rééquilibrage du fil) : un signal ancré CI/UEMOA/Afrique de
  // l'Ouest pèse plus qu'une brève mondiale — complète la règle de pertinence du classifieur.
  const geo = typeof item?.geo === "string" ? item.geo.toLowerCase() : "";
  const geoBonus = geo === "ci" || geo.includes("ivoire") ? 0.15 : geo.includes("afrique") || geo.includes("uemoa") ? 0.08 : 0;
  return Math.min(1, base + (item?.ent ? 0.2 : 0) + geoBonus);
}

/**
 * `probabilite` factor — PENDING V7 (no IA-estimated likelihood yet; `classifyAI` will derive
 * this from source language/confidence in V7 IA & sync). Constant placeholder meanwhile.
 */
function probabiliteFactor() {
  return 0.7;
}

/**
 * `prox` enum (classifieur) → proximité. imminent < 1 mois, court < 3 mois,
 * moyen 3-12 mois, horizon > 12 mois.
 */
const PROX_TABLE = { imminent: 1.0, court: 0.75, moyen: 0.5, horizon: 0.25 };

/**
 * `proximite` factor (Action 5.1) — urgency/imminence. Chaîne de priorité :
 *   1. `dueDate` (échéance réelle : limite de dépôt AO, deadline conformité, date EOL) —
 *      décote sur les jours restants : 1.0 à ≤7 jours, décroissance linéaire jusqu'à 0.3
 *      à ≥90 jours ; les échéances dépassées sont clampées côté "imminent" (1.0) plutôt
 *      que pénalisées.
 *   2. Enum `prox` du classifieur via PROX_TABLE (imminent 1.0, court 0.75, moyen 0.5,
 *      horizon 0.25) — auparavant jamais lu.
 *   3. Fallback décote sur la fraîcheur de `date` (date de publication) : la fraîcheur
 *      n'est PAS une échéance, elle est donc PLAFONNÉE à 0.5 (item du jour) et décroît
 *      linéairement jusqu'à 0.3 à ≥90 jours. C'est ce plafond qui corrige l'ancien biais
 *      "tout item frais score 1.0 en proximité".
 *   4. Aucune date utilisable → 0.3 (le moins proximate).
 */
function proximiteFactor(item, now = Date.now()) {
  const dueMs = item && item.dueDate ? Date.parse(item.dueDate) : NaN;
  if (!Number.isNaN(dueMs)) {
    const days = Math.max((dueMs - now) / MS_PER_DAY, 0);
    if (days <= 7) return 1.0;
    if (days >= 90) return 0.3;
    const t = (days - 7) / (90 - 7);
    return 1.0 - t * (1.0 - 0.3);
  }

  const fromProx = item ? PROX_TABLE[item.prox] : undefined;
  if (fromProx !== undefined) return fromProx;

  const dateMs = item && item.date ? Date.parse(item.date) : NaN;
  if (!Number.isNaN(dateMs)) {
    const days = Math.max((now - dateMs) / MS_PER_DAY, 0);
    if (days <= 7) return 0.5;
    if (days >= 90) return 0.3;
    const t = (days - 7) / (90 - 7);
    return 0.5 - t * (0.5 - 0.3);
  }

  return 0.3;
}

/**
 * Computes the 0-100 priorityScore (barème audité, Actions 5.1/5.2) for an intelItems
 * document body.
 * @param {{impact?:string, sourceRating?:string, axis?:string, subtype?:string,
 *          stance?:string, budgetIdentified?:boolean, ent?:string, prox?:string,
 *          date?:string, dueDate?:string}} item
 * @param {number} [now] injectable clock (ms epoch) for deterministic tests.
 */
function computePriorityScore(item, now = Date.now()) {
  const impact = impactFactor(item && item.impact);
  const credibilite = credibiliteFactor(item && item.sourceRating);
  const potentielBusiness = businessFactor(item);
  const alignement = alignementFactor(item);
  const probabilite = probabiliteFactor();
  const proximite = proximiteFactor(item, now);

  const raw =
    100 *
    (0.4 + 0.6 * credibilite) *
    (0.3 * impact + 0.25 * proximite + 0.2 * potentielBusiness + 0.15 * alignement + 0.1 * probabilite);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

module.exports = {
  computePriorityScore,
  impactFactor,
  credibiliteFactor,
  businessFactor,
  alignementFactor,
  probabiliteFactor,
  proximiteFactor,
  RELIABILITY_TABLE,
  CREDIBILITY_TABLE,
  SUBTYPE_BUSINESS,
  AXIS_ALIGN,
  PROX_TABLE,
};
