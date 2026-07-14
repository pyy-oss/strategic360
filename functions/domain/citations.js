"use strict";

/**
 * Vérification des citations [n] (fiabilité des sorties IA, 2026-07). Les générateurs ancrés
 * (briefing, cadres, scénarios) reçoivent des signaux NUMÉROTÉS [1..N] et doivent citer [n] pour
 * chaque fait. Rien ne vérifiait qu'un [n] cité existe : un [7] halluciné sur 4 signaux devenait un
 * lien mort / une fausse preuve. Ces fonctions PURES retirent les citations hors plage a posteriori.
 *
 * PUR : pas d'accès réseau/Firestore (testé unitairement).
 */

/** listCitations("... [2] ... [10]") -> [2, 10] (nombres cités, dans l'ordre, avec doublons). */
function listCitations(text) {
  if (typeof text !== "string" || !text) return [];
  const out = [];
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(Number(m[1]));
  return out;
}

/**
 * stripInvalidCitations(text, maxN) -> texte où seules les citations [k] avec 1 <= k <= maxN sont
 * conservées ; les autres (0, hors plage, hallucinées) sont retirées, et l'espace superflu laissé
 * devant est nettoyé (« ... audit [7]. » -> « ... audit. »). maxN <= 0 (aucun signal source) retire
 * TOUTES les citations. N'altère jamais le reste du texte.
 */
function stripInvalidCitations(text, maxN) {
  if (typeof text !== "string" || !text) return text;
  const max = Number.isFinite(Number(maxN)) ? Number(maxN) : 0;
  return text
    // Espace(s) éventuel(s) + citation invalide -> supprimés (garde la ponctuation qui suit).
    .replace(/\s*\[(\d+)\]/g, (whole, num) => {
      const k = Number(num);
      return k >= 1 && k <= max ? whole : "";
    });
}

/**
 * hasInvalidCitations(text, maxN) -> true si au moins une citation est hors plage [1..maxN].
 * Utile pour marquer/auditer une sortie sans la modifier.
 */
function hasInvalidCitations(text, maxN) {
  const max = Number.isFinite(Number(maxN)) ? Number(maxN) : 0;
  return listCitations(text).some((k) => k < 1 || k > max);
}

module.exports = { listCitations, stripInvalidCitations, hasInvalidCitations };
