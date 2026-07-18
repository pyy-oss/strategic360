"use strict";

/**
 * domain/clientTenderMonitor.js — SURVEILLANCE ACTIVE des APPELS D'OFFRES lancés par NOS CLIENTS
 * (2026-07). Un AO émis par un compte qu'on connaît déjà (Copilote/nt360) est le plus rentable :
 * relation établie, contexte connu. La corrélation passive (badge « client connu » sur les flux
 * captés) ne les attrape que par hasard ; ici on va les CHERCHER.
 *
 * Mécanisme : pour chaque client PRIORITAIRE (auto par valeur/tier + liste ajustable), une source RSS
 * de recherche Google News scopée « appels d'offres », qui passe dans le pipeline existant
 * (fetch → classify → gate provenance → subtype tender → badge « client connu »). Même patron pur que
 * domain/watchlistMonitor.js (builder d'URL + planificateur ; l'I/O vit dans index.js).
 */

const CLIENT_AO_MONITOR_PREFIX = "clientao-";
const CLIENT_AO_MONITOR_TAG = "client-ao-monitor";
// Plafond dur (coût : ~1 flux/jour/client). Au-delà on ne surveille pas activement (corrélation reste).
const MAX_CLIENT_MONITORS = 60;
const DEFAULT_AUTO_MAX = 40;

function slug(s) {
  return String(s == null ? "" : s)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function norm(s) {
  return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

/** Rang de tier (plus haut = plus prioritaire) — libellés nt360/Copilote tolérés. */
function tierRank(tier) {
  const t = norm(tier);
  if (/strateg/.test(t)) return 3;
  if (/\bcle\b|^cle|clef|key/.test(t)) return 2;
  if (/standard|courant/.test(t)) return 1;
  return 0;
}

/** Valeur d'un compte pour le classement auto : tier d'abord (dominant), puis CAS historique nt360. */
function accountPriority(a) {
  const cas = Number(a && a.nt360 && a.nt360.casTotal) || 0;
  return tierRank(a && a.tier) * 1e15 + cas;
}

/** Id déterministe (idempotent) d'une source de surveillance AO client. Null si nom inexploitable. */
function clientMonitorSourceId(nom) {
  const s = slug(nom);
  return s ? CLIENT_AO_MONITOR_PREFIX + s : null;
}

/**
 * URL de flux Google News RSS ciblant les APPELS D'OFFRES d'un client. Le nom est mis entre
 * guillemets (recherche exacte) et combiné à un vocabulaire d'AO. PUR.
 */
function clientTenderSourceUrl(nom, lang = "fr") {
  const nm = String(nom == null ? "" : nom).trim();
  const terms = `"${nm}" (appel d'offres OR "avis d'appel" OR "marché public" OR consultation OR "manifestation d'intérêt")`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(terms)}&hl=${encodeURIComponent(lang || "fr")}`;
}

/**
 * selectMonitoredClients(accounts, config) -> liste de comptes { nom } à surveiller.
 * config: { auto?: boolean=true, max?: number, include?: string[], exclude?: string[] }.
 *  - auto : prend les `max` (déf. 40) meilleurs comptes par valeur (tier puis CAS).
 *  - include : noms toujours surveillés (union) ; exclude : noms retirés (priorité sur include/auto).
 * Déduplique par slug, plafonne à MAX_CLIENT_MONITORS. PUR.
 */
function selectMonitoredClients(accounts, config) {
  const list = Array.isArray(accounts) ? accounts.filter((a) => a && String(a.nom || "").trim()) : [];
  const cfg = config && typeof config === "object" ? config : {};
  const auto = cfg.auto !== false;
  const max = Number.isFinite(cfg.max) && cfg.max > 0 ? Math.min(cfg.max, MAX_CLIENT_MONITORS) : DEFAULT_AUTO_MAX;
  const excludeSlugs = new Set((Array.isArray(cfg.exclude) ? cfg.exclude : []).map(slug).filter(Boolean));
  const includeNames = (Array.isArray(cfg.include) ? cfg.include : []).map((s) => String(s || "").trim()).filter(Boolean);

  const bySlug = new Map();
  const add = (nom) => {
    const id = slug(nom);
    if (!id || excludeSlugs.has(id) || bySlug.has(id)) return;
    bySlug.set(id, { nom: String(nom).trim() });
  };
  // 1) Inclusions explicites d'abord (toujours surveillées, dans la limite du plafond).
  for (const nm of includeNames) add(nm);
  // 2) Sélection auto par valeur décroissante.
  if (auto) {
    const ranked = [...list].sort((a, b) => accountPriority(b) - accountPriority(a));
    for (const a of ranked) {
      if ([...bySlug.keys()].filter((k) => !excludeSlugs.has(k)).length >= (includeNames.length + max)) break;
      add(a.nom);
    }
  }
  return [...bySlug.values()].slice(0, MAX_CLIENT_MONITORS);
}

/** Descripteur de source RSS générée pour un client, ou null si nom inexploitable. PUR. */
function buildClientTenderSource(client, lang) {
  const nom = client && String(client.nom || "").trim();
  if (!nom) return null;
  const id = clientMonitorSourceId(nom);
  if (!id) return null;
  return {
    id,
    name: `AO client — ${nom}`,
    url: clientTenderSourceUrl(nom, lang),
    kind: "rss",
    axis: "clients_prospects",
    clientAccount: nom,
  };
}

/**
 * planClientTenderMonitors(accounts, config, existingById, opts) -> { upserts, deactivateIds }.
 * Même logique anti-churn / anti-résurrection que planWatchlistMonitors : ne réécrit que le nouveau
 * ou le modifié, ne réactive jamais une source auto-désactivée pour ÉCHECS. PUR.
 */
function planClientTenderMonitors(accounts, config, existingById, opts) {
  const existing = existingById && typeof existingById === "object" ? existingById : {};
  const threshold = opts && Number.isFinite(opts.failureThreshold) ? opts.failureThreshold : 5;
  const lang = opts && opts.lang;
  const selected = selectMonitoredClients(accounts, config);
  const upserts = [];
  const wanted = new Set();
  for (const c of selected) {
    const src = buildClientTenderSource(c, lang);
    if (!src || wanted.has(src.id)) continue;
    wanted.add(src.id);
    const ex = existing[src.id];
    if (!ex) {
      upserts.push({ ...src, activate: true });
    } else {
      const contentChanged = ex.url !== src.url || ex.name !== src.name;
      const disabledForFailures = ex.active === false && (Number(ex.consecutiveFailures) || 0) >= threshold;
      const reactivate = ex.active === false && !disabledForFailures;
      if (!contentChanged && !reactivate) continue;
      upserts.push({ ...src, activate: reactivate });
    }
    if (upserts.length >= MAX_CLIENT_MONITORS) break;
  }
  const deactivateIds = Object.keys(existing).filter((id) => !wanted.has(id) && existing[id] && existing[id].active !== false);
  return { upserts, deactivateIds };
}

module.exports = {
  CLIENT_AO_MONITOR_PREFIX,
  CLIENT_AO_MONITOR_TAG,
  MAX_CLIENT_MONITORS,
  tierRank,
  accountPriority,
  clientMonitorSourceId,
  clientTenderSourceUrl,
  selectMonitoredClients,
  buildClientTenderSource,
  planClientTenderMonitors,
};
