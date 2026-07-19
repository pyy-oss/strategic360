"use strict";

/**
 * domain/portalTenders.js — EXTRACTEUR d'AO avis-par-avis pour les PORTAILS institutionnels dont la
 * page liste des LIENS DE DÉTAIL par dossier (constaté sur DOM réel 2026-07-19 via le diagnostic
 * `sourceDiag`). L'extraction générique `extractWebItems` ratait ces listes (elle ne reconnaissait
 * pas leur structure) ; ici on cible le MOTIF DE LIEN de détail — une URL propre par avis.
 *
 * Portails couverts (motif de préfixe) :
 *  - BOAD  : /fr/opportunites/appels-doffre/{slug}/  (ex. aaon-029-2026-menuiserie-aluminium-…)
 *  - BCEAO : /fr/appels-offres/{slug}                (ex. appel-candidatures-pour-la-49e-promotion-…)
 *
 * PUR : parsing HTML par regex, aucune I/O. La provenance (URL du détail) devient la source de vérité.
 */

/** Déslugifie « aaon-029-2026-menuiserie-aluminium » → « Aaon 029 2026 Menuiserie Aluminium » (titre lisible). */
function deSlug(slug) {
  const s = String(slug == null ? "" : slug).replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
  if (!s) return "";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extrait une référence de dossier depuis le slug si présente (AAON-029-2026, AOON-012-2026, AO-2026-05,
 * N°..., DAO 12-2026…). Renvoie la forme majuscule, ou null si le slug ne porte pas de référence.
 */
function refFromSlug(slug) {
  const s = String(slug == null ? "" : slug);
  const m = s.match(/\b([a-z]{2,5}[-\s]?\d{2,4}[-\s]?\d{2,4})\b/i) // aaon-029-2026, ao-2026-05
    || s.match(/\bn[°o][-\s]?\d{2,4}[-\s]?\d{2,4}\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/g, "-") : null;
}

/**
 * extractPortalTenders(html, { baseUrl, detailPrefix, max=15, excludePaths=[] }) -> [{ url, title, ref, slug }]
 * Récupère les liens dont le CHEMIN commence par `detailPrefix` ET porte un slug (donc ≠ la page liste
 * elle-même), les rend absolus, déduplique, et écarte les chemins de `excludePaths` (page liste, /en/…).
 * PUR.
 */
function extractPortalTenders(html, opts = {}) {
  const { baseUrl, detailPrefix, max = 15 } = opts;
  const excludePaths = new Set((Array.isArray(opts.excludePaths) ? opts.excludePaths : []).map((p) => norm(p)));
  if (!html || !detailPrefix || !baseUrl) return [];
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const prefix = String(detailPrefix);
  const out = [];
  const seen = new Set();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let abs;
    try { abs = new URL(m[1], base); } catch { continue; }
    // Même hôte que le portail uniquement (pas de lien sortant).
    if (abs.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    const path = norm(abs.pathname);
    if (!path.startsWith(norm(prefix))) continue;
    // Un SLUG doit exister après le préfixe (sinon c'est la page liste elle-même).
    const rest = path.slice(norm(prefix).length).replace(/^\/+/, "");
    if (!rest || rest.length < 3) continue;
    if (excludePaths.has(path)) continue;
    // Pagination / filtres (?page=, #) déjà retirés par pathname ; on ignore les segments techniques.
    if (/^(page|search|filter|rss|feed)\b/i.test(rest)) continue;
    const key = path.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const slug = rest.replace(/\/+$/, "").split("/").pop() || rest;
    out.push({
      url: `${abs.origin}${abs.pathname}`,
      slug,
      title: deSlug(slug),
      ref: refFromSlug(slug),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Normalise un chemin pour comparaison : minuscule, sans slash final superflu (garde la casse d'URL sinon). */
function norm(p) {
  return String(p == null ? "" : p).toLowerCase().replace(/\/{2,}/g, "/");
}

module.exports = { deSlug, refFromSlug, extractPortalTenders };
