"use strict";

/**
 * Parseurs PURS des flux d'avis de bailleurs (Phase 2 fiabilisation AO). Aucun accès réseau ici :
 * on reçoit le JSON/texte déjà récupéré et on le normalise en avis {title,url,geo,deadline,tenderRef,…}.
 *
 * Motivation (investigation provenance 2026-07) : les portails de marchés publics NATIONAUX se
 * scrapent mal (JS/anti-bot) → peu d'AO exploitables, souvent sans URL. Les bailleurs (Banque
 * Mondiale, BAD, BOAD, AFD, UNGM) — qui FINANCENT les gros projets ICT/infra en CI/UEMOA — publient
 * au contraire des avis STRUCTURÉS : chaque avis a une URL, un pays, une échéance, une référence.
 * On privilégie donc ces flux, la provenance devenant fiable par construction.
 */

/** Récupère la 1ʳᵉ valeur non vide parmi plusieurs clés candidates (schémas variables des API). */
function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/** ISO-3166 alpha-3 (code pays Banque Mondiale) → code geo court de l'app (UEMOA/CEDEAO). */
const WB_CTRY_TO_GEO = {
  CIV: "ci", SEN: "sn", MLI: "ml", BFA: "bf", BEN: "bj", TGO: "tg", NER: "ne", GNB: "gw",
  GHA: "gh", NGA: "ng", GIN: "gn", TCD: "afrique_ouest", MRT: "afrique_ouest",
};
/** Déduit le geo de l'app depuis le code/nom de pays (source de vérité = le PAYS de l'avis, jamais inventé). */
function geoFromCountry(code, name) {
  const c = String(code || "").toUpperCase();
  if (WB_CTRY_TO_GEO[c]) return WB_CTRY_TO_GEO[c];
  const n = String(name || "").toLowerCase();
  if (/ivoire|ivory|c[oô]te\s*d/.test(n)) return "ci";
  if (/s[ée]n[ée]gal/.test(n)) return "sn";
  if (/\bmali\b/.test(n)) return "ml";
  if (/burkina/.test(n)) return "bf";
  if (/b[ée]nin/.test(n)) return "bj";
  if (/\btogo\b/.test(n)) return "tg";
  if (/niger(?!ia)/.test(n)) return "ne";
  if (/bissau|guin[ée]e[- ]bissau/.test(n)) return "gw";
  if (/west\s*africa|afrique\s*de\s*l|uemoa|waemu|ecowas|cedeao/.test(n)) return "afrique_ouest";
  return null;
}

/** URL canonique d'un avis Banque Mondiale, construite depuis son id si l'API n'en fournit pas. */
function wbNoticeUrl(id) {
  return id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${encodeURIComponent(id)}` : null;
}

/**
 * Normalise la réponse de l'API World Bank Procurement Notices (search.worldbank.org/api/v3/procnotices).
 * Défensif : accepte plusieurs formes de conteneur (array direct, {procnotices:[…]|{…}}, {rows}, {docs})
 * et plusieurs noms de champs (le schéma varie selon la version). Ne garde qu'un avis exploitable
 * (titre + une URL déterministe). Renvoie [] sur entrée inexploitable (jamais d'erreur).
 */
function parseWorldBankProcNotices(json, { maxItems = 30 } = {}) {
  let rows = [];
  if (Array.isArray(json)) rows = json;
  else if (json && Array.isArray(json.procnotices)) rows = json.procnotices;
  else if (json && json.procnotices && typeof json.procnotices === "object") rows = Object.values(json.procnotices);
  else if (json && Array.isArray(json.rows)) rows = json.rows;
  else if (json && Array.isArray(json.docs)) rows = json.docs;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const id = pick(r, ["id", "noticeid", "notice_id", "bid_reference_no"]);
    const title = pick(r, ["bid_description", "project_name", "noticetext", "title", "description"]);
    const url = pick(r, ["url", "notice_url"]) || wbNoticeUrl(id);
    if (!title || !url) continue; // provenance obligatoire : pas de titre ou pas d'URL → on écarte
    const country = pick(r, ["project_ctry_name", "country", "countryname", "countryshortname"]);
    const code = pick(r, ["countrycode", "project_ctry_code", "country_code"]);
    out.push({
      title: title.slice(0, 300),
      url,
      country,
      geo: geoFromCountry(code, country),
      deadline: pick(r, ["submission_deadline_date", "deadline_date", "bid_closing_dt", "submission_date"]),
      tenderRef: pick(r, ["bid_reference_no", "procurement_ref_no", "project_id", "projectid"]) || id,
      description: pick(r, ["noticetext", "bid_description", "description"]) || title,
      noticeType: pick(r, ["notice_type", "noticetype"]),
      publishedDate: pick(r, ["noticedate", "publication_date", "submitdate"]),
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

module.exports = { pick, geoFromCountry, wbNoticeUrl, parseWorldBankProcNotices };
