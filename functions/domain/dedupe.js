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
 * isStrongDuplicate(a, b) — quasi-doublon À FORT RECOUVREMENT : au moins 3 jetons significatifs
 * partagés ET coefficient de recouvrement ≥ 0.75. Assez robuste pour affirmer « même événement »
 * MÊME si les deux signaux ont été classés sur des axes différents (une levée de fonds fintech vue
 * `tech` par un média et `clients_prospects` par un autre). Sert à lever la contrainte d'axe
 * identique du dédoublonnage (audit pertinence 2026-07). PUR.
 */
function isStrongDuplicate(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  if (inter < 3) return false;
  return inter / Math.min(A.size, B.size) >= 0.75;
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

/**
 * clusterNearDuplicates(items, threshold) — regroupe les quasi-doublons d'une collection de signaux.
 * `items` = [{id, title, axis?, ...}]. Deux items ne sont fusionnés que s'ils partagent le MÊME axe
 * (un signal tech et un signal client au titre proche ne sont pas le même sujet) et sont quasi-
 * doublons par recouvrement de titre. Renvoie UNIQUEMENT les grappes de taille ≥ 2 (les doublons
 * réels), chacune = tableau des items d'origine dans l'ordre rencontré. PUR.
 */
function clusterNearDuplicates(items, threshold = 0.6) {
  const list = Array.isArray(items) ? items : [];
  const clusters = []; // { rep:{title,axis}, members: [] }
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const title = typeof it.title === "string" ? it.title : "";
    const axis = it.axis || "";
    let placed = false;
    for (const c of clusters) {
      // Même axe + quasi-doublon standard, OU fort recouvrement quel que soit l'axe (même événement
      // classé différemment selon la source) — audit pertinence 2026-07.
      const sameAxis = (c.rep.axis || "") === axis && isNearDuplicate(c.rep.title, title, threshold);
      if (sameAxis || isStrongDuplicate(c.rep.title, title)) {
        c.members.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ rep: { title, axis }, members: [it] });
  }
  return clusters.filter((c) => c.members.length >= 2).map((c) => c.members);
}

module.exports = { normalizeTitle, titleSimilarity, isNearDuplicate, isStrongDuplicate, dedupeByTitle, clusterNearDuplicates };
