"use strict";

/**
 * Juge de PERTINENCE des signaux de veille — porte de qualité AVANT publication (audit « insights
 * manquent de pertinence »). Le barème de scoring (scoring.js) mesure impact/crédibilité/proximité ;
 * il ne juge PAS si un signal est réellement actionnable pour Neurones Technologies. Ce module ajoute
 * ce jugement métier via un LLM : un signal reste en attente (`pending`) jusqu'à ce que l'évaluateur
 * le publie (`new`) ou l'écarte (`rejected`, corbeille exec restaurable).
 *
 * PUR : builder de prompt + parser. Aucun accès réseau/Firestore (testé unitairement).
 */

const RELEVANCE_MIN = 40; // seuil de publication (conservateur — on n'écarte que le franchement hors-sujet)

function coerce(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

/**
 * buildEvaluatePrompt(item, companyContextText) -> string. Demande un jugement de pertinence
 * COMMERCIALE/STRATÉGIQUE pour NT (pas la qualité rédactionnelle du signal).
 */
function buildEvaluatePrompt(item, companyContextText) {
  const c = item || {};
  const ctx = coerce(companyContextText);
  return `Tu es analyste de veille stratégique senior pour NEURONES TECHNOLOGIES CI — intégrateur IT / cybersécurité / réseau & télécoms / cloud / formation, marché Côte d'Ivoire, UEMOA et Afrique de l'Ouest.
${ctx ? `Contexte entreprise :\n${ctx}\n` : ""}
Évalue la PERTINENCE COMMERCIALE / STRATÉGIQUE de ce signal de veille POUR NT — pas sa qualité de rédaction.
- PERTINENT = il révèle une OPPORTUNITÉ concrète (appel d'offres, projet, budget/financement, faille à corriger, nouvelle implantation à équiper, réglementation créant un besoin IT/cyber, mouvement d'un compte suivi) ou une MENACE concrète (concurrent qui gagne du terrain, risque de perte de compte) sur ce marché.
- NON PERTINENT = brève tech mondiale sans lien avec NT, généralité macro-économique, hors zone géographique, contenu promotionnel/publicitaire, doublon évident, ou trop vague pour déclencher une action commerciale.

SIGNAL À ÉVALUER :
Titre : ${coerce(c.title)}
Résumé : ${coerce(c.summary)}
Axe : ${coerce(c.axis)} · Type : ${coerce(c.subtype)} · Entité : ${coerce(c.ent)} · Zone : ${coerce(c.geo)}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "pertinence": number,   // 0-100 : à quel point c'est ACTIONNABLE pour NT sur ce marché
  "publier": boolean,     // true si le signal mérite d'apparaître dans le fil de veille de NT
  "raison": string        // UNE phrase factuelle : pourquoi pertinent, ou pourquoi écarté (pas de langue de bois)
}
JSON uniquement.`;
}

/**
 * parseEvaluateResponse(raw) -> { pertinence, publier, raison } | null. Fail-safe : si `publier`
 * absent, on déduit du score vs seuil ; si le score est absent aussi, on PUBLIE (fail-open — ne jamais
 * masquer un signal sur une réponse mal formée).
 */
function parseEvaluateResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  let pertinence = Number(raw.pertinence);
  if (!Number.isFinite(pertinence)) pertinence = null;
  else pertinence = Math.max(0, Math.min(100, Math.round(pertinence)));
  const raison = coerce(raw.raison);
  const publier = typeof raw.publier === "boolean"
    ? raw.publier
    : pertinence != null ? pertinence >= RELEVANCE_MIN : true; // fail-open
  return { pertinence, publier, raison };
}

module.exports = { RELEVANCE_MIN, buildEvaluatePrompt, parseEvaluateResponse };
