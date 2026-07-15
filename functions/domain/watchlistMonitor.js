"use strict";

/**
 * domain/watchlistMonitor.js — SURVEILLANCE ACTIVE des entités de la watchlist (2026-07).
 *
 * Problème : la watchlist ne servait qu'à ÉTIQUETER les signaux captés (resolveWatchlistEntity),
 * PAS à les chercher. Une entité n'était « surveillée » que si une des sources généralistes parlait
 * d'elle par hasard → les concurrents/clients locaux qui ne publient pas dans les flux crawlés
 * restaient invisibles (0 signal).
 *
 * Solution : transformer chaque entité PRIORITAIRE (Haute/Moyenne) en une source RSS de RECHERCHE
 * Google News (publique, gratuite, déjà parsable par extractRssItems). Ces sources générées passent
 * dans le pipeline existant (fetch → classify → resolveWatchlistEntity) : l'entité devient réellement
 * monitorée. Tenant-agnostique : la géographie est portée par le TEXTE de la requête (geo de l'entité),
 * pas par des paramètres pays codés en dur.
 *
 * PUR : builder d'URL + planificateur de mise en phase. L'I/O (lecture watchlist, écriture sources)
 * vit dans index.js (ensureWatchlistMonitorSources).
 */

// Seules les entités Haute/Moyenne sont surveillées activement (borne le coût : ~1 flux/jour/entité).
const MONITORED_PRIORITIES = ["Haute", "Moyenne"];
// Préfixe d'id déterministe des sources générées — permet de les retrouver/mettre en phase sans
// toucher aux sources saisies/onboardées.
const MONITOR_SOURCE_PREFIX = "wlmon-";
const MONITOR_SOURCE_TAG = "watchlist-monitor";
// Plafond dur (garde-fou) : jamais plus de N sources d'entités générées.
const MAX_MONITORS = 120;

// Type d'entité → axe de veille (VALID_AXES). Inconnu → null (le classifieur tranchera depuis le contenu).
const ENTITY_TYPE_AXIS = {
  concurrent: "concurrents",
  editeur: "tech",
  distributeur: "partenaires",
  regulateur: "reglementaire",
  client: "clients_prospects",
  partenaire: "partenaires",
};

function slug(s) {
  return String(s == null ? "" : s)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * Id déterministe (idempotent) d'une source de surveillance. INCLUT la géo (audit final pré-prod
 * 2026-07) : deux entités homonymes de géos différentes (Orange CI / Orange SN) ne doivent PAS
 * collisionner sur le même id — sinon la seconde est silencieusement perdue. Renvoie null si le nom
 * ne donne pas de slug exploitable.
 */
function entityMonitorSourceId(name, geo) {
  const s = slug(name);
  if (!s) return null;
  const g = slug(geo);
  return MONITOR_SOURCE_PREFIX + s + (g ? "-" + g : "");
}

/**
 * entityNewsSourceUrl(name, geo, lang) — URL de flux Google News RSS de recherche pour une entité.
 * La géo (facultative) est ajoutée au TEXTE de la requête pour cibler géographiquement sans coder de
 * paramètre pays (multi-tenant). Le nom est mis entre guillemets pour une recherche exacte. PUR.
 */
function entityNewsSourceUrl(name, geo, lang = "fr") {
  const nm = String(name == null ? "" : name).trim();
  const g = typeof geo === "string" && geo.trim() ? ` ${geo.trim()}` : "";
  const terms = `"${nm}"${g}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(terms)}&hl=${encodeURIComponent(lang || "fr")}`;
}

/** Une entité est surveillée activement si active, priorité Haute/Moyenne, et nom exploitable. PUR. */
function isMonitored(entity) {
  return !!(entity && entity.active !== false && MONITORED_PRIORITIES.includes(entity.priority) && String(entity.name || "").trim());
}

/**
 * buildEntityMonitorSource(entity, lang) -> descripteur de source RSS générée, ou null si non éligible.
 * PUR.
 */
function buildEntityMonitorSource(entity, lang) {
  if (!isMonitored(entity)) return null;
  const name = String(entity.name).trim();
  const id = entityMonitorSourceId(name, entity.geo);
  if (!id) return null;
  return {
    id,
    name: `Veille entité — ${name}`,
    url: entityNewsSourceUrl(name, entity.geo, lang),
    kind: "rss",
    axis: ENTITY_TYPE_AXIS[String(entity.type || "").toLowerCase()] || null,
    watchlistEntity: name,
  };
}

/**
 * planWatchlistMonitors(entities, existingById, opts) -> { upserts, deactivateIds }.
 * Met en PHASE les sources de surveillance avec la watchlist, en tenant compte de l'ÉTAT existant :
 *  - `existingById` : map { id: { active, consecutiveFailures, url, name, axis } } des sources monitor
 *    déjà en base (issue de monSnap).
 *  - `opts.failureThreshold` : seuil d'échecs consécutifs (= MAX_CONSECUTIVE_FAILURES) au-delà duquel
 *    une source auto-désactivée pour ÉCHECS ne doit PAS être réactivée de force (audit final pré-prod :
 *    sinon on ressuscite un flux mort à chaque run et l'auto-cicatrisation ne s'ancre jamais).
 *
 * upserts (chacun `{ id, name, url, kind, axis, watchlistEntity, activate }`) : uniquement les sources
 * NOUVELLES ou dont le contenu (url/name/axis) a changé, ou à réactiver parce qu'elles avaient été
 * désactivées pour cause de sortie de watchlist (pas pour échecs). `activate=true` demande de (re)poser
 * active:true ; sinon on NE TOUCHE PAS le champ active (préserve une auto-désactivation pour échecs).
 * deactivateIds : sources monitor existantes ENCORE actives dont l'entité n'est plus éligible. PUR.
 */
function planWatchlistMonitors(entities, existingById, opts) {
  const list = Array.isArray(entities) ? entities : [];
  const existing = existingById && typeof existingById === "object" ? existingById : {};
  const threshold = opts && Number.isFinite(opts.failureThreshold) ? opts.failureThreshold : 5;
  const lang = opts && opts.lang;
  const upserts = [];
  const wanted = new Set();
  for (const e of list) {
    const src = buildEntityMonitorSource(e, lang);
    if (!src || wanted.has(src.id)) continue;
    wanted.add(src.id);
    const ex = existing[src.id];
    if (!ex) {
      upserts.push({ ...src, activate: true }); // nouvelle source
    } else {
      const contentChanged = ex.url !== src.url || ex.name !== src.name || (ex.axis || null) !== (src.axis || null);
      const disabledForFailures = ex.active === false && (Number(ex.consecutiveFailures) || 0) >= threshold;
      // Réactiver UNIQUEMENT une source désactivée pour sortie de watchlist (pas pour échecs).
      const reactivate = ex.active === false && !disabledForFailures;
      if (!contentChanged && !reactivate) continue; // deja en phase → aucune ecriture (anti-churn)
      upserts.push({ ...src, activate: reactivate }); // ne (re)pose active que si reactivation legitime
    }
    if (upserts.length >= MAX_MONITORS) break;
  }
  const deactivateIds = Object.keys(existing).filter((id) => !wanted.has(id) && existing[id] && existing[id].active !== false);
  return { upserts, deactivateIds };
}

module.exports = {
  MONITORED_PRIORITIES,
  MONITOR_SOURCE_PREFIX,
  MONITOR_SOURCE_TAG,
  ENTITY_TYPE_AXIS,
  entityMonitorSourceId,
  entityNewsSourceUrl,
  isMonitored,
  buildEntityMonitorSource,
  planWatchlistMonitors,
};
