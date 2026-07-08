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

const RELEVANCE_MIN = 55; // seuil de publication (relevé — la porte doit écarter le « médiocre mais pas absurde »)

function coerce(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

/** Sérialise le businessAngle (acheteur/budget/échéance/référence AO) — matière d'actionnabilité. */
function businessAngleText(ba) {
  if (!ba || typeof ba !== "object") return "";
  const parts = [];
  if (ba.buyer) parts.push(`acheteur : ${coerce(ba.buyer)}`);
  if (ba.estAmount) parts.push(`budget/montant : ${coerce(ba.estAmount)}`);
  if (ba.deadline) parts.push(`échéance : ${coerce(ba.deadline)}`);
  if (ba.tenderRef) parts.push(`réf. AO : ${coerce(ba.tenderRef)}`);
  return parts.join(" · ");
}

/**
 * buildEvaluatePrompt(item, companyContextText) -> string. Demande un jugement de pertinence
 * COMMERCIALE/STRATÉGIQUE pour NT (pas la qualité rédactionnelle du signal). Le juge voit désormais
 * les CHAMPS D'ACTIONNABILITÉ (so-what, action recommandée, impact/posture/imminence, échéance et le
 * businessAngle acheteur/budget/échéance/AO) : sans eux il jugeait « à l'aveugle » et pouvait écarter
 * comme « trop vague » un AO pourtant chiffré (audit pertinence 2026-07).
 */
function buildEvaluatePrompt(item, companyContextText) {
  const c = item || {};
  const ctx = coerce(companyContextText);
  const ba = businessAngleText(c.businessAngle);
  return `Tu es analyste de veille stratégique senior pour NEURONES TECHNOLOGIES CI — intégrateur IT / cybersécurité / réseau & télécoms / cloud / formation, marché Côte d'Ivoire, UEMOA et Afrique de l'Ouest.
${ctx ? `Contexte entreprise :\n${ctx}\n` : ""}
Évalue la PERTINENCE COMMERCIALE / STRATÉGIQUE de ce signal de veille POUR NT — pas sa qualité de rédaction.
- PERTINENT = il révèle une OPPORTUNITÉ concrète (appel d'offres, projet, budget/financement, faille à corriger, nouvelle implantation à équiper, réglementation créant un besoin IT/cyber, mouvement d'un compte suivi) ou une MENACE concrète (concurrent qui gagne du terrain, risque de perte de compte) sur ce marché.
- NON PERTINENT = brève tech mondiale sans lien avec NT, généralité macro-économique, hors zone géographique, contenu promotionnel/publicitaire, doublon évident, ou trop vague pour déclencher une action commerciale.

FONDE ton jugement sur l'ACTIONNABILITÉ, pas seulement sur le titre :
- Un ACHETEUR identifié (compte/institution nommé), un BUDGET/montant, une ÉCHÉANCE ou une référence d'AO = fort signe de pertinence, même si le titre est sobre.
- Un « so-what » ou une action recommandée GÉNÉRIQUE (« suivre l'évolution », « rester attentif », « surveiller la tendance ») SANS cible ni échéance = signe de faible actionnabilité : baisse la note en conséquence.

SIGNAL À ÉVALUER :
Titre : ${coerce(c.title)}
Résumé : ${coerce(c.summary)}
Axe : ${coerce(c.axis)} · Type : ${coerce(c.subtype)} · Entité : ${coerce(c.ent)} · Zone : ${coerce(c.geo)}
Impact : ${coerce(c.impact)} · Posture : ${coerce(c.stance)} · Imminence : ${coerce(c.prox)} · Échéance : ${coerce(c.dueDate)}
So-what : ${coerce(c.soWhat)}
Action recommandée : ${coerce(c.recommendedAction)}
${ba ? `Angle business : ${ba}` : "Angle business : (aucun acheteur/budget/échéance identifié)"}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "pertinence": number,   // 0-100 : à quel point c'est ACTIONNABLE pour NT sur ce marché
  "publier": boolean,     // true si le signal mérite d'apparaître dans le fil de veille de NT
  "raison": string        // UNE phrase factuelle : pourquoi pertinent, ou pourquoi écarté (pas de langue de bois)
}
JSON uniquement.`;
}

/**
 * parseEvaluateResponse(raw) -> { pertinence, publier, raison } | null. La publication est COUPLÉE au
 * score : on ne publie que si `publier` n'est pas explicitement false ET que le score atteint le seuil
 * (un `publier:true` avec un score sous le seuil est requalifié en NON publié — sinon la porte ne mord
 * jamais). Fail-open borné : un score absent ne bloque pas (réponse partielle → on publie) ; une
 * réponse non-objet renvoie null (l'appelant publiera par défaut, jamais de signal masqué sur panne).
 */
function parseEvaluateResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  let pertinence = Number(raw.pertinence);
  if (!Number.isFinite(pertinence)) pertinence = null;
  else pertinence = Math.max(0, Math.min(100, Math.round(pertinence)));
  const raison = coerce(raw.raison);
  // Score absent → ne bloque pas (fail-open sur réponse partielle) ; sinon exige le seuil.
  const scoreOk = pertinence == null ? true : pertinence >= RELEVANCE_MIN;
  // Rejet explicite (m10 audit intégral) : Gemini renvoie souvent le booléen STRINGIFIÉ ("false")
  // en mode JSON — `raw.publier === false` strict laissait alors passer un signal que le modèle
  // voulait écarter. On normalise false / "false" / 0 / "no" / "non".
  const rejette = isFalsey(raw.publier);
  const publier = rejette ? false : scoreOk; // rejet explicite respecté ; sinon couplé au seuil
  return { pertinence, publier, raison };
}

/** Vrai si la valeur exprime un « non » : false, "false", 0, "0", "no", "non" (insensible à la casse). */
function isFalsey(v) {
  if (v === false) return true;
  if (typeof v === "number") return v === 0;
  if (typeof v === "string") return ["false", "0", "no", "non"].includes(v.trim().toLowerCase());
  return false;
}

module.exports = { RELEVANCE_MIN, buildEvaluatePrompt, parseEvaluateResponse };
