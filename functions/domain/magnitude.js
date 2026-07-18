"use strict";

/**
 * domain/magnitude.js — APPRÉCIATION RELATIVE des montants (2026-07). Retour terrain : les agents
 * du Copilote qualifiaient mal l'échelle d'un montant (« opportunité de 3 M » présentée comme
 * majeure alors que le compte pèse des milliards, ou l'inverse). Les prompts DEMANDAIENT de situer
 * en % du CA, mais le modèle devait le CALCULER lui-même — d'où des erreurs.
 *
 * Solution : on PRÉ-CALCULE ici (déterministe) l'appréciation de chaque montant clé — % du CA réalisé
 * du compte, multiple du deal médian du portefeuille, et un LABEL qualitatif borné. Injecté dans le
 * contexte, partagé par TOUS les agents → cohérence (mêmes labels partout), pertinence, et sens des
 * proportions garanti. PUR : aucun accès réseau/Firestore.
 */

// Seuils en % du CA RÉALISÉ du compte (échelle de la RELATION, la plus actionnable pour un commercial).
// Un montant se juge d'abord par rapport à ce qu'on fait DÉJÀ avec ce compte.
const REL_THRESHOLDS = [
  { max: 2, label: "dérisoire" },        // < 2% du CA compte → accessoire
  { max: 10, label: "modeste" },         // 2–10%
  { max: 30, label: "significatif" },    // 10–30%
  { max: 100, label: "majeur" },         // 30–100%
  { max: Infinity, label: "transformationnel" }, // ≥ 100% du CA actuel → change la dimension du compte
];

function labelForPct(pct) {
  if (!Number.isFinite(pct) || pct < 0) return null;
  return (REL_THRESHOLDS.find((t) => pct < t.max) || REL_THRESHOLDS[REL_THRESHOLDS.length - 1]).label;
}

function round1(n) { return Math.round(n * 10) / 10; }

/**
 * appreciateAmount(amount, { accountCas, portfolioMedian }) -> appréciation relative d'UN montant.
 * Renvoie null si le montant n'est pas exploitable. Sinon :
 *  { montant, pctOfCas, xMedian, label, phrase } — `phrase` prête à insérer (FR, sobre).
 */
function appreciateAmount(amount, opts = {}) {
  const m = Number(amount);
  if (!Number.isFinite(m) || m <= 0) return null;
  const cas = Number(opts.accountCas) || 0;
  const med = Number(opts.portfolioMedian) || 0;
  const pctOfCas = cas > 0 ? round1((m / cas) * 100) : null;
  const xMedian = med > 0 ? round1(m / med) : null;
  const label = pctOfCas != null ? labelForPct(pctOfCas) : null;
  const parts = [];
  if (pctOfCas != null) parts.push(`≈ ${pctOfCas}% du CA réalisé du compte`);
  if (xMedian != null) parts.push(`${xMedian}× le deal médian du portefeuille`);
  const phrase = parts.length
    ? `${parts.join(", ")}${label ? ` → ${label} à l'échelle du compte` : ""}`
    : "échelle du compte inconnue (CA réalisé non disponible)";
  return { montant: m, pctOfCas, xMedian, label, phrase };
}

/**
 * clientScaleNote(secteur, tier) -> note qualitative sur la CAPACITÉ D'INVESTISSEMENT du client
 * (on ne connaît pas son P&L, mais son secteur/tier renseigne l'ordre de grandeur). Sert à rappeler
 * qu'un montant faible pour un grand compte = marge pour viser plus haut. PUR.
 */
const LARGE_CAP_SECTORS = /t[ée]l[ée]com|banqu|assur|mine|p[ée]trol|[ée]nerg|gouvern|minist|holding|industri|cimenter|brasser/i;
function clientScaleNote(secteur, tier) {
  const s = String(secteur || "");
  const t = String(tier || "");
  const big = LARGE_CAP_SECTORS.test(s) || /strat[ée]g|cl[ée]|key/i.test(t);
  if (big) return "Grand compte (capacité d'investissement élevée) : un montant faible en absolu peut être marginal pour LUI → marge pour viser plus haut / élargir le périmètre.";
  return "Compte de taille intermédiaire : calibrer l'ambition au réalisable, éviter de surdimensionner.";
}

/**
 * buildMagnitudeGuide(ctx) -> guide d'appréciation prêt à injecter dans les prompts.
 * ctx attendu (extrait du contexte Copilote) : { compte, secteur, tier, casTotal, pipelinePondere,
 * portfolioMedian, recommendation:{offre,montantEstime}, whitespacePotential, deals:[{nom,montant}],
 * signauxCompte:[{titre, estAmount}] }. Tout est optionnel (robuste aux comptes pauvres). PUR.
 */
function buildMagnitudeGuide(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const accountCas = Number(c.casTotal) || 0;
  const portfolioMedian = Number(c.portfolioMedian) || 0;
  const ap = (amount) => appreciateAmount(amount, { accountCas, portfolioMedian });
  const amounts = [];
  const push = (libelle, montant) => { const a = ap(montant); if (a) amounts.push({ libelle, ...a }); };

  if (accountCas > 0) push("CA réalisé du compte (référence)", accountCas);
  if (Number(c.pipelinePondere) > 0) push("Pipeline pondéré", c.pipelinePondere);
  if (c.recommendation && Number(c.recommendation.montantEstime) > 0) push(`Next best offer — ${c.recommendation.offre || "offre"}`, c.recommendation.montantEstime);
  if (Number(c.whitespacePotential) > 0) push("Potentiel cross-sell total (whitespace)", c.whitespacePotential);
  for (const d of Array.isArray(c.deals) ? c.deals.slice(0, 6) : []) {
    if (d && Number(d.montant) > 0) push(`Deal en cours — ${d.nom || d.titre || "opportunité"}`, d.montant);
  }
  for (const s of Array.isArray(c.signauxCompte) ? c.signauxCompte.slice(0, 6) : []) {
    const amt = s && (s.estAmount || (s.businessAngle && s.businessAngle.estAmount));
    const parsed = typeof amt === "string" ? Number(amt.replace(/[^\d]/g, "")) : Number(amt);
    if (Number.isFinite(parsed) && parsed > 0) push(`Signal veille — ${s.titre || "AO"}`, parsed);
  }

  return {
    echelleCompte: {
      casTotal: accountCas,
      secteur: c.secteur || "",
      tier: c.tier || "",
      note: clientScaleNote(c.secteur, c.tier),
    },
    montants: amounts, // chaque montant clé déjà apprécié (% CA, ×médiane, label)
  };
}

module.exports = {
  REL_THRESHOLDS,
  labelForPct,
  appreciateAmount,
  clientScaleNote,
  buildMagnitudeGuide,
};
