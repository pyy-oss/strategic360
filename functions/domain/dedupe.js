"use strict";

/**
 * Dédoublonnage intelligent (Vague C, 2026-07) — le pipeline ne déduplique que par CLÉ EXACTE
 * (hash d'URL, ids.js) : la même actualité (même AO, même annonce) vue depuis deux sources aux URLs
 * différentes crée deux signaux distincts. Ce module ajoute une détection de QUASI-doublons par
 * similarité des titres normalisés (Jaccard sur jetons significatifs). PUR — testé unitairement.
 */

function normalizeTitle(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Mots vides + années : trop fréquents pour porter du sens dans une comparaison de titres.
const DEDUPE_STOP = new Set([
  "de", "la", "le", "les", "des", "du", "et", "en", "un", "une", "pour", "sur", "au", "aux", "dans",
  "the", "of", "a", "to", "in", "and", "with", "on", "for", "2024", "2025", "2026", "2027",
]);

function titleTokens(s) {
  return new Set(normalizeTitle(s).split(/\s+/).filter((w) => w.length >= 3 && !DEDUPE_STOP.has(w)));
}

/** Similarité de Jaccard entre les jetons significatifs de deux titres (0..1). PUR. */
function titleSimilarity(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Deux titres sont des quasi-doublons si leurs jetons significatifs se RECOUVRENT largement — on
 * utilise le coefficient de recouvrement (intersection / plus petit ensemble), plus tolérant aux
 * reformulations et aux sur-titres que Jaccard, MAIS gardé par un minimum de 2 jetons partagés pour
 * éviter qu'un simple mot commun (« Cisco ») ne fusionne deux sujets distincts. PUR. Seuil défaut 0.6.
 */
function isNearDuplicate(a, b, threshold = 0.6) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0 >= 1; // false
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  if (inter < 2) return false;
  return inter / Math.min(A.size, B.size) >= threshold;
}

/**
 * dedupeByTitle(items, threshold) — écarte les quasi-doublons d'une liste (garde le PREMIER de
 * chaque grappe). `items` = tableau de chaînes OU d'objets `{title}`. Renvoie la liste filtrée dans
 * l'ordre d'origine. PUR.
 */
function dedupeByTitle(items, threshold = 0.6) {
  const list = Array.isArray(items) ? items : [];
  const keptTitles = [];
  const out = [];
  for (const it of list) {
    const title = typeof it === "string" ? it : it && typeof it === "object" ? it.title : "";
    const t = typeof title === "string" ? title : "";
    if (keptTitles.some((k) => isNearDuplicate(k, t, threshold))) continue;
    keptTitles.push(t);
    out.push(it);
  }
  return out;
}

module.exports = { normalizeTitle, titleSimilarity, isNearDuplicate, dedupeByTitle };
