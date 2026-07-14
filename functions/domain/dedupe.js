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
 * Jetons GÉNÉRIQUES d'appels d'offres/marchés publics — présents dans quantité d'AO DISTINCTS
 * (« fourniture de matériel informatique » de deux ministères ≠ doublon). Exclus du comptage de
 * recouvrement fort pour éviter les fusions cross-axe abusives (audit dedup 2026-07).
 */
const GENERIC_TOKENS = new Set([
  "fourniture", "fournitures", "materiel", "materiels", "equipement", "equipements", "informatique",
  "acquisition", "marche", "marches", "appel", "offre", "offres", "public", "publics", "projet",
  "projets", "prestation", "prestations", "service", "services", "maintenance", "installation",
  "livraison", "achat", "achats", "lot", "lots", "avis", "renforcement", "mise", "place", "systeme",
]);

/**
 * isStrongDuplicate(a, b) — quasi-doublon À FORT RECOUVREMENT, robuste au point d'affirmer « même
 * événement » MÊME sur des axes différents (une levée de fonds vue `tech` et `clients_prospects`).
 * ≥ 3 jetons partagés et recouvrement ≥ 0.75. DURCI (audit 2026-07) : on exige EN PLUS au moins 2
 * jetons partagés NON GÉNÉRIQUES (hors GENERIC_TOKENS d'AO) — un vrai discriminant d'événement doit
 * être présent. Ainsi deux AO PUREMENT génériques (« fourniture de matériel informatique » de deux
 * acheteurs, aucun jeton fort partagé) ne fusionnent plus, tandis qu'un vrai même-événement
 * (« BRVM refonte SI ») partage « brvm »+« refonte » et fusionne toujours. PUR.
 */
function isStrongDuplicate(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  let interStrong = 0;
  for (const t of A) if (B.has(t)) { inter++; if (!GENERIC_TOKENS.has(t)) interStrong++; }
  if (inter < 3 || interStrong < 2) return false;
  return inter / Math.min(A.size, B.size) >= 0.75;
}

/**
 * discriminantKey(item) — extrait un IDENTIFIANT FORT d'événement (audit intégral 2026-07, M3) :
 * référence d'AO, acheteur/entité adjudicatrice, ou entité principale. Deux signaux à titre proche
 * mais à discriminant DIFFÉRENT sont des événements DISTINCTS (deux appels d'offres « fourniture de
 * matériel informatique » de deux ministères ≠ un doublon) et ne doivent jamais être fusionnés.
 * Renvoie "" si l'item ne porte aucun discriminant exploitable (→ on retombe sur le titre seul). PUR.
 */
function discriminantKey(item) {
  if (!item || typeof item !== "object") return "";
  const ba = item.businessAngle && typeof item.businessAngle === "object" ? item.businessAngle : {};
  const cand =
    item.tenderRef || item.ref || ba.tenderRef || ba.ref ||
    ba.buyer || ba.acheteur || ba.autorite || item.ent || "";
  return normalizeTitle(cand);
}

/**
 * blocksMerge(a, b) — true si deux items portent CHACUN un discriminant fort et qu'ils DIFFÈRENT
 * (donc événements distincts, fusion interdite malgré des titres proches). Si l'un au moins n'a pas
 * de discriminant, on ne bloque pas (retour au titre seul). PUR.
 */
function blocksMerge(a, b) {
  const da = discriminantKey(a);
  const db = discriminantKey(b);
  return !!da && !!db && da !== db;
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
  const clusters = []; // { rep:{title,axis, item}, members: [] }
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const title = typeof it.title === "string" ? it.title : "";
    const axis = it.axis || "";
    let placed = false;
    for (const c of clusters) {
      // Discriminant fort divergent (M3) : deux AO/événements distincts ne fusionnent jamais, même
      // à titre quasi identique.
      if (blocksMerge(c.rep.item, it)) continue;
      // Même axe + quasi-doublon standard, OU fort recouvrement quel que soit l'axe (même événement
      // classé différemment selon la source) — audit pertinence 2026-07.
      const sameAxis = (c.rep.axis || "") === axis && isNearDuplicate(c.rep.title, title, threshold);
      if (sameAxis || isStrongDuplicate(c.rep.title, title)) {
        c.members.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ rep: { title, axis, item: it }, members: [it] });
  }
  return clusters.filter((c) => c.members.length >= 2).map((c) => c.members);
}

module.exports = { normalizeTitle, titleSimilarity, isNearDuplicate, isStrongDuplicate, discriminantKey, blocksMerge, dedupeByTitle, clusterNearDuplicates };
