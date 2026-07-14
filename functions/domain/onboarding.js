"use strict";

/**
 * domain/onboarding.js — ONBOARDING AUTO (Phase 1 « produit agnostique »).
 *
 * Objectif : à partir du texte du SITE d'un client (+ docs corporate), GÉNÉRER sa configuration de
 * veille (profil, contexte, écosystème, plan de veille + sources candidates) — au lieu du paramétrage
 * manuel. MÊME PATRON que classify.js/enrich.js/copilote.js : builders de prompt PURS + parsers
 * coerçant/validant (aucun accès réseau/Firestore ici ; l'orchestration vit dans index.js via
 * generateJson). Rien n'est activé sans revue humaine : ces sorties alimentent un BROUILLON éditable.
 */

// Générateur de rôle système AGNOSTIQUE (copilote.js) — source unique. Sans cycle : copilote.js ne
// dépend que de companyContext.js, pas d'onboarding.js. Utilisé pour produire profile.systemRole du
// client onboardé (sinon roleOf() retombe sur NT_ROLE Neurones dans tous les agents copilote).
const { buildSystemRole } = require("./copilote");

const NO_INVENT =
  "OBJECTIVITÉ (impérative) : n'affirme AUCUN fait (nom, chiffre, entité, zone, offre) qui ne soit " +
  "explicitement présent dans le TEXTE fourni. N'invente pas de client, de concurrent, de partenaire " +
  "ni de montant. Si une information manque, mets `null` ou une liste vide plutôt que de la deviner.";

function coerceStr(v, fallback = "") {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function coerceStrOrNull(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function coerceStrArray(v, max = 50) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, max);
}
function clamp01(n, fallback) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback;
}

/* ------------------------------------------------------------------------------------------- *
 * Étape 3 — PROFIL + CONTEXTE depuis le site
 * ------------------------------------------------------------------------------------------- */
function buildOnboardingProfilePrompt(siteText, docsText, hints) {
  const h = hints && typeof hints === "object" ? hints : {};
  const hintLine = [h.name ? `Nom présumé : ${coerceStr(h.name)}` : "", h.sector ? `Secteur présumé : ${coerceStr(h.sector)}` : ""].filter(Boolean).join(" · ");
  return `Tu es analyste chargé de PROFILER une entreprise pour paramétrer un outil de veille stratégique et commerciale.
${hintLine ? `Indices fournis par l'utilisateur : ${hintLine}\n` : ""}
À partir du TEXTE de son site web (et éventuels documents corporate), produis son profil et un contexte
structuré. ${NO_INVENT}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "profile": {
    "companyName": string,          // nom d'usage
    "legalName": string | null,     // raison sociale si citée, sinon null
    "sector": string,               // secteur d'activité (concis)
    "geographies": [string],        // zones d'activité (codes/regions courts, ex: "fr", "uemoa")
    "currency": string | null,      // devise principale si déductible (ex: "EUR", "XOF"), sinon null
    "homonyms": [string],           // entités homonymes à ne PAS confondre, si le site en mentionne
    "differentiators": string,      // 1-3 différenciateurs de marque, tirés du site
    "regulators": [string]          // régulateurs/organismes de tutelle pertinents pour ce secteur
  },
  "contextText": string             // 8-15 lignes : activité, offres/BU, modèle économique, clients-types,
                                     // concurrents cités, enjeux — DENSE et FACTUEL, uniquement d'après le texte
}
JSON uniquement.

TEXTE DU SITE / DOCS :
"""
${coerceStr(siteText).slice(0, 12000)}
${coerceStr(docsText) ? `\n--- DOCS ---\n${coerceStr(docsText).slice(0, 6000)}` : ""}
"""`;
}

function parseOnboardingProfileResponse(raw) {
  if (!raw || typeof raw !== "object" || !raw.profile || typeof raw.profile !== "object") return null;
  const p = raw.profile;
  const companyName = coerceStr(p.companyName);
  const contextText = coerceStr(raw.contextText);
  if (!companyName && !contextText) return null;
  return {
    profile: {
      companyName,
      legalName: coerceStrOrNull(p.legalName),
      sector: coerceStr(p.sector),
      geographies: coerceStrArray(p.geographies, 12).map((g) => g.toLowerCase()),
      currency: coerceStrOrNull(p.currency),
      homonyms: coerceStrArray(p.homonyms, 12),
      differentiators: coerceStr(p.differentiators),
      regulators: coerceStrArray(p.regulators, 20),
    },
    contextText,
  };
}

/* ------------------------------------------------------------------------------------------- *
 * Étape 4 — ÉCOSYSTÈME (entités typées) + taxonomie du secteur
 * ------------------------------------------------------------------------------------------- */
const ENTITY_TYPES = ["concurrent", "client", "partenaire", "regulateur", "editeur"];

function buildEcosystemMapPrompt(contextText, siteText) {
  return `Tu es analyste de veille. À partir du CONTEXTE de l'entreprise et du texte de son site, CARTOGRAPHIE
son écosystème et propose la taxonomie de veille de son SECTEUR. ${NO_INVENT}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "entities": [
    { "name": string, "type": "concurrent"|"client"|"partenaire"|"regulateur"|"editeur",
      "geo": string | null, "note": string }   // entités NOMMÉES dans les textes uniquement
  ],
  "axes": [
    { "key": string,            // identifiant court snake_case (ex: "clients_prospects")
      "label": string,          // libellé lisible
      "alignWeight": number,    // 0-1 : proximité de l'axe avec l'action commerciale (clients > tech)
      "guetGuidance": string }  // 1-2 phrases : quoi guetter sur cet axe, pour CE secteur
  ],
  "subtypes": [string]          // vocabulaire des types d'événements du secteur (ex: "tender","ma","litige")
}
Contraintes : 4 à 6 axes couvrant clients/prospects, concurrents, partenaires, réglementaire et
technologie/marché ; entités uniquement si NOMMÉES dans les textes. Français. JSON uniquement.

CONTEXTE :
${coerceStr(contextText).slice(0, 4000)}

SITE :
"""
${coerceStr(siteText).slice(0, 8000)}
"""`;
}

function parseEcosystemMapResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const entities = (Array.isArray(raw.entities) ? raw.entities : [])
    .filter((e) => e && typeof e === "object" && coerceStr(e.name))
    .map((e) => ({
      name: coerceStr(e.name),
      type: ENTITY_TYPES.includes(e.type) ? e.type : "concurrent",
      geo: coerceStrOrNull(e.geo),
      note: coerceStr(e.note),
    }))
    .slice(0, 200);
  const axes = (Array.isArray(raw.axes) ? raw.axes : [])
    .filter((a) => a && typeof a === "object" && coerceStr(a.key))
    .map((a) => ({
      key: coerceStr(a.key).toLowerCase().replace(/[\s'/]+/g, "_").replace(/[^a-z0-9_]/g, ""),
      label: coerceStr(a.label) || coerceStr(a.key),
      alignWeight: clamp01(a.alignWeight, 0.6),
      guetGuidance: coerceStr(a.guetGuidance),
    }))
    .filter((a) => a.key)
    .slice(0, 10);
  const subtypes = coerceStrArray(raw.subtypes, 40).map((s) => s.toLowerCase().replace(/[\s'/]+/g, "_").replace(/[^a-z0-9_]/g, "")).filter(Boolean);
  if (!entities.length && !axes.length) return null;
  return { entities, axes, subtypes };
}

/* ------------------------------------------------------------------------------------------- *
 * Étape 5 — PLAN DE VEILLE (axes prioritaires + guidage + mots-clés + sources candidates)
 * ------------------------------------------------------------------------------------------- */
const SOURCE_KINDS = ["rss", "web", "web-js", "newsletter", "portal"];

function buildVeillePlanPrompt(profile, entities) {
  const p = profile && typeof profile === "object" ? profile : {};
  const ents = (Array.isArray(entities) ? entities : []).slice(0, 60).map((e) => `- ${coerceStr(e.name)} (${coerceStr(e.type)})`).join("\n");
  return `Tu es consultant en veille stratégique. Conçois le PLAN DE VEILLE d'un client à partir de son profil
et de son écosystème. ${NO_INVENT} Pour les SOURCES, ne propose que des URLs plausibles et publiques
(sites officiels/régulateurs du secteur, portails d'appels d'offres, médias spécialisés, flux RSS) —
elles seront VALIDÉES techniquement ensuite, donc reste réaliste (pas d'URL inventée de toutes pièces).

PROFIL : ${coerceStr(p.companyName)} — secteur ${coerceStr(p.sector)} — zones ${(Array.isArray(p.geographies) ? p.geographies : []).join("/")}.
ÉCOSYSTÈME :
${ents || "(aucune entité fournie)"}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "axes": [ { "key": string, "label": string, "alignWeight": number, "guetGuidance": string } ],
  "classifierGuidance": string,   // le bloc « axes de guet » à injecter dans le prompt de classification
  "homonymyRule": string,         // règle d'homonymie (entités à ignorer), ou "" si aucune
  "keywords": [string],           // requêtes/mots-clés de veille pour ce secteur
  "candidateSources": [
    { "name": string, "url": string, "kind": "rss"|"web"|"web-js"|"newsletter"|"portal", "axis": string }
  ]
}
JSON uniquement.`;
}

function parseVeillePlanResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const axes = (Array.isArray(raw.axes) ? raw.axes : [])
    .filter((a) => a && typeof a === "object" && coerceStr(a.key))
    .map((a) => ({
      key: coerceStr(a.key).toLowerCase().replace(/[\s'/]+/g, "_").replace(/[^a-z0-9_]/g, ""),
      label: coerceStr(a.label) || coerceStr(a.key),
      alignWeight: clamp01(a.alignWeight, 0.6),
      guetGuidance: coerceStr(a.guetGuidance),
    }))
    .filter((a) => a.key)
    .slice(0, 10);
  const candidateSources = (Array.isArray(raw.candidateSources) ? raw.candidateSources : [])
    .filter((s) => s && typeof s === "object" && coerceStr(s.url) && /^https?:\/\//i.test(coerceStr(s.url)))
    .map((s) => ({
      name: coerceStr(s.name) || coerceStr(s.url),
      url: coerceStr(s.url),
      kind: SOURCE_KINDS.includes(s.kind) ? s.kind : "web",
      axis: coerceStr(s.axis),
    }))
    .slice(0, 60);
  const classifierGuidance = coerceStr(raw.classifierGuidance);
  if (!axes.length && !candidateSources.length && !classifierGuidance) return null;
  return {
    axes,
    classifierGuidance,
    homonymyRule: coerceStr(raw.homonymyRule),
    keywords: coerceStrArray(raw.keywords, 60),
    candidateSources,
  };
}

/* ------------------------------------------------------------------------------------------- *
 * Étape 1 (support) — SÉLECTION DES LIENS À CRAWLER (pur, testable). Le crawler (index.js, I/O)
 * fetch la home puis suit ces liens INTERNES prioritaires pour enrichir le texte d'onboarding.
 * ------------------------------------------------------------------------------------------- */
const ONBOARDING_LINK_GROUPS = [
  { key: "about", kws: ["a-propos", "a_propos", "apropos", "about", "qui-sommes", "qui_sommes", "presentation", "notre-histoire", "entreprise", "company", "societe"] },
  { key: "offers", kws: ["offre", "offres", "service", "services", "solution", "solutions", "produit", "produits", "expertise", "expertises", "metier", "metiers", "prestation"] },
  { key: "clients", kws: ["client", "clients", "reference", "references", "realisation", "realisations", "portfolio", "temoignage", "cas-client", "case-stud"] },
  { key: "contact", kws: ["contact", "contactez", "nous-contacter"] },
];

/**
 * pickOnboardingLinks(html, baseUrl) -> [url] — jusqu'à 4 liens INTERNES prioritaires (à-propos,
 * offres, clients, contact), un par groupe, dédupliqués, même domaine que baseUrl. PUR.
 */
function pickOnboardingLinks(html, baseUrl) {
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const host = base.hostname.replace(/^www\./, "");
  const norm = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const picked = new Map(); // group -> url
  const seen = new Set();
  let m;
  while ((m = aRe.exec(String(html || ""))) !== null) {
    let abs;
    try { abs = new URL(m[1], base); } catch { continue; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (abs.hostname.replace(/^www\./, "") !== host) continue; // interne uniquement
    const key = `${abs.origin}${abs.pathname}`.replace(/\/$/, "");
    if (key === `${base.origin}${base.pathname}`.replace(/\/$/, "") || seen.has(key)) continue;
    const hay = `${norm(abs.pathname)} ${norm(m[2].replace(/<[^>]+>/g, " "))}`;
    for (const g of ONBOARDING_LINK_GROUPS) {
      if (picked.has(g.key)) continue;
      if (g.kws.some((kw) => hay.includes(kw))) { picked.set(g.key, key); seen.add(key); break; }
    }
    if (picked.size >= ONBOARDING_LINK_GROUPS.length) break;
  }
  return [...picked.values()];
}

/* ------------------------------------------------------------------------------------------- *
 * Étape 6 (P4) — MAPPING brouillon -> docs `config/*` de production (PUR, testable). Traduit le
 * brouillon `config/onboardingDraft` (sortie de onboardCompany) en la forme exacte attendue par
 * loadClientProfile (config/profile, config/veilleTaxonomy) + le contexte (frameworks/companyContext)
 * + les graines de sources (intelSources) et d'entités (intelWatchlist). L'écriture Firestore
 * (applyOnboardingDraft) vit dans index.js. On ne dérive QUE ce qui est présent dans le brouillon —
 * scoring/offerMapping/sourceAuthority restent aux défauts (non déductibles d'un site).
 * ------------------------------------------------------------------------------------------- */
function slugifyName(s) {
  return String(s == null ? "" : s)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Identifiant déterministe (donc idempotent à la ré-application) d'une source depuis son URL. */
function sourceIdFromUrl(url) {
  try {
    const u = new URL(url);
    const base = `${u.hostname.replace(/^www\./, "")}${u.pathname}`;
    const slug = slugifyName(base) || "src";
    return `onb-${slug}`;
  } catch { return null; }
}

/** Assemble le texte de contexte entreprise (frameworks/companyContext.content.text) depuis le brouillon. */
function assembleContextTextFromDraft(draft) {
  const parts = [];
  const ctx = coerceStr(draft && draft.contextText);
  if (ctx) parts.push(ctx);
  const plan = (draft && draft.plan) || {};
  const cg = coerceStr(plan.classifierGuidance);
  if (cg) parts.push(cg);
  const hr = coerceStr(plan.homonymyRule);
  if (hr) parts.push(hr);
  const eco = (draft && draft.ecosystem) || {};
  const comps = (Array.isArray(eco.entities) ? eco.entities : []).filter((e) => e && e.type === "concurrent" && coerceStr(e.name)).map((e) => coerceStr(e.name));
  if (comps.length) parts.push(`CONCURRENTS : ${comps.slice(0, 20).join(", ")}.`);
  return parts.join("\n\n");
}

/**
 * buildConfigDocsFromDraft(draft) -> { profileDoc, taxonomyDoc, contextText, sources[], watchlist[] }
 * ou null si le brouillon n'a pas de nom d'entreprise exploitable. PUR (aucune I/O).
 *  - profileDoc  : surcharge config/profile (le sous-objet `profile` du brouillon).
 *  - taxonomyDoc : { axes:[{key,alignWeight}], subtypes:[...] } — omis si vides (on ne remplace pas
 *                  les défauts par du vide, cf. mergeProfile).
 *  - sources     : graines intelSources { id, name, url, kind, axis } — sources VALIDÉES uniquement
 *                  (valid===true) si une validation a eu lieu ; sinon toutes (valid null/undefined).
 *  - watchlist   : graines intelWatchlist { id, name, type, geo } depuis les entités de l'écosystème.
 */
function buildConfigDocsFromDraft(draft) {
  if (!draft || typeof draft !== "object") return null;
  const profile = draft.profile && typeof draft.profile === "object" ? draft.profile : {};
  if (!coerceStr(profile.companyName)) return null;
  const eco = draft.ecosystem && typeof draft.ecosystem === "object" ? draft.ecosystem : {};
  const plan = draft.plan && typeof draft.plan === "object" ? draft.plan : {};

  // Axes : union plan de veille (prioritaire) + écosystème, dédupliqués par clé.
  const axisMap = new Map();
  for (const a of [...(Array.isArray(eco.axes) ? eco.axes : []), ...(Array.isArray(plan.axes) ? plan.axes : [])]) {
    if (a && coerceStr(a.key)) axisMap.set(coerceStr(a.key), { key: coerceStr(a.key), alignWeight: clamp01(a.alignWeight, 0.6) });
  }
  const axes = [...axisMap.values()];
  const subtypes = coerceStrArray(eco.subtypes, 40);
  const taxonomyDoc = {};
  if (axes.length) taxonomyDoc.axes = axes;
  if (subtypes.length) taxonomyDoc.subtypes = subtypes;
  // Règle d'homonymie + guidance classifieur du client (audit multi-tenant 2026-07) : sans ce routage,
  // config/veilleTaxonomy ne les portait PAS et classify.js retombait sur les défauts Neurones (« groupe
  // français NEURONES… »), filtrant à tort les signaux d'un autre client. classify.js les lit depuis
  // tax.homonymyRule / tax.classifierGuidance.
  const hr = coerceStr(plan.homonymyRule);
  if (hr) taxonomyDoc.homonymyRule = hr;
  const cg = coerceStr(plan.classifierGuidance);
  if (cg) taxonomyDoc.classifierGuidance = cg;
  // Marqueurs de section attendus dans le CONTEXTE du client (audit multi-tenant 2026-07, C2) : sans
  // ce champ, config/veilleTaxonomy héritait des 4 marqueurs Neurones (BUSINESS UNITS / OBJECTIF
  // COMMERCIAL…) et le rafraîchissement hebdo du contexte d'un client tiers était rejeté ou forcé au
  // gabarit Neurones. On n'exige que les sections RÉELLEMENT produites pour ce client (au minimum
  // CONCURRENTS quand des concurrents existent). Écrit même vide pour NEUTRALISER le défaut Neurones.
  const comps = (Array.isArray(eco.entities) ? eco.entities : []).filter((e) => e && e.type === "concurrent" && coerceStr(e.name));
  taxonomyDoc.contextMarkers = comps.length ? ["CONCURRENTS"] : [];

  const cands = Array.isArray(plan.candidateSources) ? plan.candidateSources : [];
  const validated = cands.some((s) => s && s.valid === true) || cands.some((s) => s && s.valid === false);
  const sources = cands
    .filter((s) => s && coerceStr(s.url) && (validated ? s.valid === true : true))
    .map((s) => ({ id: sourceIdFromUrl(coerceStr(s.url)), name: coerceStr(s.name) || coerceStr(s.url), url: coerceStr(s.url), kind: SOURCE_KINDS.includes(s.kind) ? s.kind : "web", axis: coerceStr(s.axis) }))
    .filter((s) => s.id);

  const watchlist = (Array.isArray(eco.entities) ? eco.entities : [])
    .filter((e) => e && coerceStr(e.name))
    .map((e) => ({ id: `onb-${slugifyName(coerceStr(e.name))}`, name: coerceStr(e.name), type: ENTITY_TYPES.includes(e.type) ? e.type : "concurrent", geo: coerceStrOrNull(e.geo) }))
    .filter((e) => e.id !== "onb-");

  // systemRole (audit multi-tenant 2026-07, B1) : GÉNÉRÉ depuis le profil client si absent — sinon
  // roleOf() retombe sur NT_ROLE (identité/géo/homonymes Neurones) dans les 13 agents copilote. On ne
  // l'écrase pas s'il est déjà fourni (édition manuelle possible).
  const profileDoc = coerceStr(profile.systemRole) ? { ...profile } : { ...profile, systemRole: buildSystemRole(profile) };
  return { profileDoc, taxonomyDoc, contextText: assembleContextTextFromDraft(draft), sources, watchlist };
}

module.exports = {
  buildOnboardingProfilePrompt,
  parseOnboardingProfileResponse,
  pickOnboardingLinks,
  buildConfigDocsFromDraft,
  sourceIdFromUrl,
  buildEcosystemMapPrompt,
  parseEcosystemMapResponse,
  buildVeillePlanPrompt,
  parseVeillePlanResponse,
  ENTITY_TYPES,
  SOURCE_KINDS,
};
