"use strict";

/**
 * domain/noticeStatus.js — classe un avis d'appel d'offres en AVIS OUVERT vs RÉSULTAT/ATTRIBUTION.
 *
 * Motivation (audit final 2026-07) : les portails et l'API World Bank mélangent, dans la même liste, des
 * AVIS ouverts (auxquels on soumissionne) et des RÉSULTATS (attributions, PV d'adjudication, décisions
 * d'infructuosité, synthèses de dépouillement). Sans distinction, la vue AO se pollue d'items non
 * soumissionnables et le KPI « AO ouverts » sur-compte. On dérive donc un `noticeKind` déterministe :
 *   - "award"  : attribution / résultat / décision — informatif, PAS une opportunité ouverte.
 *   - "notice" : avis ouvert (défaut) — une opportunité à instruire.
 *
 * PUR : heuristique sur le `notice_type` (API bailleur) + le titre + le nom de fichier (portail Drupal
 * type UEMOA où l'avis est un PDF « PV_attribution_… »). Aucune I/O. Conçu pour être RÉPLIQUÉ à
 * l'identique côté front (fallback), la valeur stockée faisant foi quand elle est présente.
 */

// Marqueurs d'un RÉSULTAT/ATTRIBUTION (et non d'un avis ouvert). Insensible à la casse/accents.
const AWARD_RE = /\b(?:award|awarded|attributi|adjudicat|infructuo|r[ée]sultat|d[ée]cision|proc[eè]s[-\s]?verbal|\bpv\b|synth[eè]se[\s_-]*d[ée]pouillement|contract\s+award|marktattribu)/i;
// notice_type explicites de l'API World Bank correspondant à une attribution / une info (pas un avis ouvert).
const AWARD_NOTICE_TYPE_RE = /award|contract\s*award|attribution/i;

/**
 * deriveNoticeKind({ noticeType, title, url, subtype }) -> "award" | "notice"
 * "award" si le type de notice bailleur OU le titre OU le nom de fichier (dernier segment d'URL) porte
 * un marqueur de résultat/attribution ; sinon "notice" (avis ouvert, défaut sûr).
 */
function deriveNoticeKind(input = {}) {
  const noticeType = String(input.noticeType == null ? "" : input.noticeType);
  const title = String(input.title == null ? "" : input.title);
  let fileSeg = "";
  try {
    const u = new URL(String(input.url || ""), "https://x.invalid");
    fileSeg = decodeURIComponent(u.pathname.split("/").pop() || "");
  } catch { fileSeg = ""; }
  // Normalise « _ » → espace : l'underscore est un caractère de mot, donc `\b` ne s'y déclenche pas
  // (les noms de fichiers UEMOA « PV_attribution_… » masquaient sinon le marqueur d'attribution).
  const hay = `${title} ${fileSeg}`.replace(/_/g, " ");
  if (AWARD_NOTICE_TYPE_RE.test(noticeType)) return "award";
  if (AWARD_RE.test(hay)) return "award";
  return "notice";
}

/** True si l'avis est une opportunité ouverte (pratique pour filtrer/KPI). */
function isOpenNotice(input) {
  return deriveNoticeKind(input) === "notice";
}

module.exports = { deriveNoticeKind, isOpenNotice };
