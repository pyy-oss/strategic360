"use strict";

/**
 * Domain logic: IA classification of a raw veille signal into an `intelItems` doc shape
 * (BUILD_KIT.md §9.C / §10 "classifyAI" / DELTA_01 §3.C: "résume, classe (axe/type/imminence/
 * impact/posture), rapproche des entités de la watchlist, détecte les signaux faibles, propose un
 * « so-what » + une action. Aucune publication sans revue humaine (`new → reviewed`).").
 *
 * Pure functions only (no Vertex AI / Firestore access here) — `buildClassificationPrompt` builds
 * the prompt text, `parseClassificationResponse` maps an already-obtained JSON response onto the
 * `IntelItem` shape. Both are unit-tested with synthetic fixtures in
 * functions/test/classify.domain.test.js without ever calling Vertex AI. The only caller that
 * actually hits the network (`functions/domain/vertex.js#generateJson`) lives in
 * functions/index.js (`syncSources`/`classifyAI`).
 *
 * `IntelItem` shape mirrored from web/src/modules/veille/lib/intel.ts (kept as JSDoc here since
 * functions/ is CommonJS and can't import a .ts type):
 * @typedef {Object} IntelItemFields
 * @property {string} title
 * @property {string} summary
 * @property {string} [url]
 * @property {string} [sourceName]
 * @property {"partenaires"|"concurrents"|"clients_prospects"|"tech"|"reglementaire"} axis
 * @property {string} [subtype]
 * @property {string} [cat]
 * @property {string} [ent]
 * @property {string} [geo]
 * @property {string} date
 * @property {"high"|"medium"|"low"} impact
 * @property {"opportunity"|"threat"|"neutral"} stance
 * @property {string} sourceRating A1..F5 (code de l'amirauté)
 * @property {string} [confidence]
 * @property {string} [soWhat]
 * @property {string} [recommendedAction]
 * @property {"imminent"|"court"|"moyen"|"horizon"} [prox]
 * @property {boolean} [neuf] "signal faible" (weak/early signal) flag
 * @property {{buyer?:string, bu?:"ICT"|"FORMATION"|"les_deux", estAmount?:string, deadline?:string, tenderRef?:string}} [businessAngle]
 * @property {string} [dueDate] échéance ISO YYYY-MM-DD (dépôt AO, deadline conformité, EOL)
 * @property {boolean} budgetIdentified true si un budget/montant est explicitement cité
 * @property {"new"|"reviewed"|"actioned"|"archived"} status ALWAYS "new" — see hard-default below.
 */

const { COMPANY_CONTEXT } = require("./companyContext");

const VALID_AXES = ["partenaires", "concurrents", "clients_prospects", "tech", "reglementaire"];
const VALID_IMPACTS = ["high", "medium", "low"];
const VALID_STANCES = ["opportunity", "threat", "neutral"];
const VALID_PROX = ["imminent", "court", "moyen", "horizon"];
// Vocabulaire canonique des subtypes (m2 audit 2026-07) — aligné sur SUBTYPE_BUSINESS du scoring.
// Le subtype reste libre (on ne jette pas une valeur inconnue), mais il est normalisé (minuscule,
// tirets) et les synonymes fréquents sont ramenés à la forme canonique pour fiabiliser les filtres.
const VALID_SUBTYPES = new Set([
  "tender", "funding", "eol", "supply", "vulnerability", "cve", "regulation", "budget",
  "implantation", "market_entry", "expansion", "pricing", "program_change", "ma", "win",
  "product_launch", "hire", "leadership", "trend", "macro",
]);
const SUBTYPE_SYNONYMS = {
  appel_offre: "tender", appel_doffres: "tender", ao: "tender", rfp: "tender", tenders: "tender",
  financement: "funding", grant: "funding", fund: "funding",
  fin_de_vie: "eol", end_of_life: "eol", eos: "eol",
  approvisionnement: "supply", sourcing: "supply", shortage: "supply", penurie: "supply",
  faille: "vulnerability", vuln: "vulnerability", cves: "cve",
  reglementation: "regulation", compliance: "regulation", conformite: "regulation",
  nouvel_entrant: "market_entry", new_entrant: "market_entry",
  fusion: "ma", acquisition: "ma", merger: "ma",
  recrutement: "hire", hiring: "hire", nomination: "leadership",
  tendance: "trend", macroeconomie: "macro",
};
function normalizeSubtype(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const k = value.trim().toLowerCase().replace(/[\s'/]+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (VALID_SUBTYPES.has(k)) return k;
  if (SUBTYPE_SYNONYMS[k]) return SUBTYPE_SYNONYMS[k];
  return k || undefined; // inconnu : conservé sous forme normalisée (pas de perte d'information)
}
function normalizeGeo(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim().toLowerCase().replace(/[\s']+/g, "_");
}
// businessAngle.bu — quelle Business Unit est concernée par le signal (Action 4.2 de l'audit).
const VALID_BUS = ["ICT", "FORMATION", "les_deux"];

// Detection-radar category (web ECAT key) derived from the axis — mirrors
// web/src/modules/veille/lib/intel.ts#AXIS_TO_DETECTION_CAT. Persisted on every classified item
// so the "Radar de détection" view can plot AI signals without any human touch-up.
const AXIS_TO_DETECTION_CAT = {
  partenaires: "marche",
  concurrents: "marche",
  clients_prospects: "sectoriel",
  tech: "tech",
  reglementaire: "regpays",
};

/**
 * Builds the Gemini prompt for classifying one raw veille signal (BUILD_KIT.md §9.C).
 * @param {string} rawText Raw extracted text (title + description/body, however obtained —
 *   manual paste, RSS <description>, or a truncated web-page text extract).
 * @param {Array<{name:string, type?:string, note?:string}>} [watchlistEntities] `intelWatchlist`
 *   entries to resolve the signal's entity against (DELTA_01 §3.C "rapproche des entités de la
 *   watchlist"). The optional `note` (contexte concurrentiel/commercial de l'entrée) is passed to
 *   the model so it can disambiguate entities and sharpen soWhat/recommendedAction (Action 4.5).
 * @returns {string}
 */
function buildClassificationPrompt(rawText, watchlistEntities, companyContext = COMPANY_CONTEXT) {
  const watchlist = Array.isArray(watchlistEntities) ? watchlistEntities : [];
  const watchlistLines = watchlist.length
    ? watchlist.map((e) => `- ${e.name}${e.type ? ` (${e.type})` : ""}${e.note ? ` — ${e.note}` : ""}`).join("\n")
    : "(watchlist vide — aucune entité connue à rapprocher)";

  return `Tu es un analyste de veille stratégique ET de développement commercial pour l'entreprise suivante :
${companyContext}

RÈGLE DE FILTRAGE — HOMONYMIE : si le texte concerne le groupe français coté NEURONES (neurones.net), Neurones Technologies SA (Genève) ou Neurones IT Asia, ce N'EST PAS notre entreprise — ne le rattache à aucune entité de la watchlist, classe impact "low", stance "neutral", et signale-le dans le summary, sauf lien explicite avec la Côte d'Ivoire/UEMOA.

Analyse le texte source ci-dessous et réponds
UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte hors JSON) respectant
exactement ce schéma :

{
  "title": string,               // titre court et factuel du signal
  "summary": string,              // résumé en 2-3 phrases
  "axis": "partenaires" | "concurrents" | "clients_prospects" | "tech" | "reglementaire",
  "subtype": string,               // ex: product_launch, eol, supply (pénurie/appro/crédit distributeur),
                                    // vulnerability (faille/CVE sur techno d'un éditeur → campagne patch),
                                    // program_change, pricing, ma, tender, funding, budget, leadership,
                                    // win, hire, regulation, trend, macro, market_entry (nouvel entrant),
                                    // implantation (nouvelle implantation), expansion (expansion d'un groupe)
  "impact": "high" | "medium" | "low",
  "stance": "opportunity" | "threat" | "neutral",
  "entity": string | null,         // nom de l'entité de la watchlist la plus proche, sinon null
  "geo": string | null,            // ex: "ci", "afrique_ouest", "afrique"
  "prox": "imminent" | "court" | "moyen" | "horizon", // imminence de l'échéance/impact
  "weakSignal": boolean,           // signal faible/précoce (encore incertain mais potentiellement important)
  "soWhat": string,                // "so-what" : pourquoi ce signal compte pour Neurones
  "recommendedAction": string,     // action recommandée, concrète et actionnable
  "confidence": "high" | "medium" | "low",
  "businessAngle": {
    "buyer": string | null,      // organisation qui achète/lance l'AO (ex: "BCEAO"), null si aucune
    "bu": "ICT" | "FORMATION" | "les_deux" | null,
    "estAmount": string | null,  // montant si cité dans le texte ("152 M$") — NE PAS inventer
    "deadline": string | null,   // échéance textuelle si citée
    "tenderRef": string | null   // référence/portail de l'AO (SIGOMAP, afdb.org, bceao.int...)
  },
  "dueDate": string | null,      // date d'échéance ISO YYYY-MM-DD (limite de dépôt AO, deadline conformité, date EOL) sinon null
  "budgetIdentified": boolean    // true si un budget/montant est explicitement mentionné
}

AXES DE GUET PRIORITAIRES (à détecter activement dans le texte) :
- CRÉATION / ARRIVÉE D'ENTREPRISES : nouvelle société, filiale, banque, fintech, assurance ou
  institution qui se crée ou s'implante en CI/UEMOA → subtype "implantation" ; c'est une
  OPPORTUNITÉ (nouveau client potentiel à équiper : réseau, cyber, cloud, formation) sauf si
  c'est un acteur IT/ESN → alors "market_entry", MENACE nouvel entrant.
- EXPANSION DE GROUPES régionaux ou internationaux (ouverture de pays, rachat, croissance,
  nouveau siège, datacenter, levée de fonds) → subtype "expansion" ; opportunité si client
  potentiel, menace si concurrent/désintermédiation.
- ACTUALITÉ TECHNOLOGIQUE : ne retenir que l'angle BUSINESS pour une ESN en CI/UEMOA —
  vulnérabilité majeure sur les technologies de nos éditeurs (Cisco, Fortinet, Palo Alto, HPE,
  Microsoft, Wallix) → subtype "vulnerability", OPPORTUNITÉ de campagne de patch/upgrade/audit chez
  les clients équipés ; nouvelle techno monétisable en zone = opportunité d'offre.
- SOURCING / APPROVISIONNEMENT : pénurie, rupture, allongement des délais, changement de conditions
  de crédit d'un distributeur (Hiperdist, Westcon, Exclusive, Ingram, TD SYNNEX) → subtype "supply" ;
  déterminant pour la marge et la trésorerie (cycle long, backlog à financer).

RÈGLE DE PERTINENCE GÉOGRAPHIQUE : une actualité tech/cyber MONDIALE sans lien exploitable avec
la Côte d'Ivoire/UEMOA, nos clients, nos concurrents ou les technologies de nos éditeurs doit être
classée impact "low" et stance "neutral" (elle ne doit pas noyer le fil) — n'y rattache un angle
business QUE s'il est réel et actionnable localement.

Consignes impératives :
- "soWhat" : impact concret citant la BU, le client ou le concurrent concerné (jamais de généralité).
- "recommendedAction" : UNE action commerciale/opérationnelle précise, datée et nominative
  (ex: "Proposer à la BRVM un audit de conformité aux instructions SI AMF-UMOA de mars 2024").
- "prox" : imminent = < 1 mois, court = < 3 mois, moyen = 3-12 mois, horizon = > 12 mois.
- Dans "businessAngle", n'inventer AUCUN montant ni échéance : null si le texte n'en cite pas.

Watchlist des entités suivies (partenaires, concurrents, clients, prospects) :
${watchlistLines}

Texte source à analyser :
"""
${rawText}
"""

Réponds avec le JSON uniquement.`;
}

function coerceEnum(value, allowed, fallback) {
  if (typeof value === "string" && allowed.includes(value)) return value;
  return fallback;
}

function coerceString(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

/**
 * Coerces the optional `businessAngle` block (Action 4.2) onto its persisted shape. Every
 * sub-field is either a trimmed non-empty string (enum-checked for `bu`) or ABSENT — never
 * undefined/null (Firestore hygiene, same rule as the top-level fields). Returns undefined when
 * nothing usable survives, so the whole key gets dropped by the undefined-sweep below.
 * @param {unknown} raw
 * @returns {object | undefined}
 */
function coerceBusinessAngle(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const angle = {
    buyer: coerceString(raw.buyer, undefined),
    bu: coerceEnum(raw.bu, VALID_BUS, undefined),
    estAmount: coerceString(raw.estAmount, undefined),
    deadline: coerceString(raw.deadline, undefined),
    tenderRef: coerceString(raw.tenderRef, undefined),
  };
  for (const key of Object.keys(angle)) {
    if (angle[key] === undefined) delete angle[key];
  }
  return Object.keys(angle).length ? angle : undefined;
}

/**
 * Validates/maps a raw JSON response (already parsed, e.g. by `vertex.js#generateJson`) onto a
 * partial `intelItems` doc body. Coerces/defaults missing or malformed fields sensibly, but
 * returns `null` for completely unusable input (not an object, or no meaningful title/summary
 * text at all — nothing worth persisting).
 *
 * HARD RULE (BUILD_KIT.md §1 "Rien n'est publié par l'IA sans revue humaine" / §9.C "Revue
 * humaine obligatoire (new→reviewed)"): `status` is ALWAYS forced to `"new"` here, regardless of
 * anything the AI response claims — this function is the single choke point enforcing that no AI
 * output can ever mark itself as already-reviewed/actioned/archived.
 *
 * @param {unknown} rawJsonResponse
 * @param {{sourceName?: string, url?: string, defaultDate?: string, defaultSourceRating?: string}} [context]
 *   Fields not derivable from the AI response itself (they come from the `intelSources` doc /
 *   ingestion context, not from the model).
 * @returns {Partial<IntelItemFields> | null}
 */
function parseClassificationResponse(rawJsonResponse, context) {
  if (!rawJsonResponse || typeof rawJsonResponse !== "object" || Array.isArray(rawJsonResponse)) {
    return null;
  }

  const r = rawJsonResponse;
  const title = coerceString(r.title, null);
  const summary = coerceString(r.summary, null);
  // Completely unusable: no title AND no summary — nothing meaningful to persist.
  if (!title && !summary) return null;

  const ctx = context || {};
  const today = new Date().toISOString().slice(0, 10);

  const axis = coerceEnum(r.axis, VALID_AXES, "tech");
  const item = {
    title: title || summary.slice(0, 80),
    summary: summary || title,
    axis,
    cat: AXIS_TO_DETECTION_CAT[axis],
    subtype: normalizeSubtype(r.subtype),
    impact: coerceEnum(r.impact, VALID_IMPACTS, "low"),
    stance: coerceEnum(r.stance, VALID_STANCES, "neutral"),
    ent: coerceString(r.entity, undefined),
    geo: normalizeGeo(r.geo),
    prox: coerceEnum(r.prox, VALID_PROX, "moyen"),
    neuf: r.weakSignal === true,
    soWhat: coerceString(r.soWhat, undefined),
    recommendedAction: coerceString(r.recommendedAction, undefined),
    confidence: coerceEnum(r.confidence, VALID_IMPACTS, undefined),
    // Bloc business (Action 4.2) : dueDate validée par regex ISO stricte (une échéance floue ou
    // inventée ne doit jamais piloter le scoring de proximité) ; budgetIdentified strictement
    // booléen ; businessAngle coercé champ par champ (voir coerceBusinessAngle).
    businessAngle: coerceBusinessAngle(r.businessAngle),
    dueDate:
      typeof r.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate.trim())
        ? r.dueDate.trim()
        : undefined,
    budgetIdentified: r.budgetIdentified === true,
    date: coerceString(r.date, ctx.defaultDate || today),
    sourceName: ctx.sourceName || undefined,
    url: ctx.url || undefined,
    sourceRating: ctx.defaultSourceRating || "C3", // "moyennement fiable / probable" — conservative
    // default when the source itself carries no explicit admiralty rating.
    // Non-negotiable human review gate — see function doc comment above.
    status: "new",
  };

  // Firestore rejects `undefined` values outright ("Cannot use undefined as a Firestore value" —
  // hit in production on 2026-07-02 when Gemini legitimately returned entity:null for a signal
  // matching no watchlist entry). Optional fields the AI didn't provide must be ABSENT from the
  // doc, not present-with-undefined.
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key];
  }

  return item;
}

module.exports = {
  buildClassificationPrompt,
  parseClassificationResponse,
  VALID_AXES,
  VALID_IMPACTS,
  VALID_STANCES,
  VALID_PROX,
  VALID_BUS,
  AXIS_TO_DETECTION_CAT,
};
