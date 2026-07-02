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
 * @property {"new"|"reviewed"|"actioned"|"archived"} status ALWAYS "new" — see hard-default below.
 */

const VALID_AXES = ["partenaires", "concurrents", "clients_prospects", "tech", "reglementaire"];
const VALID_IMPACTS = ["high", "medium", "low"];
const VALID_STANCES = ["opportunity", "threat", "neutral"];
const VALID_PROX = ["imminent", "court", "moyen", "horizon"];

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
 * @param {Array<{name:string, type?:string}>} [watchlistEntities] `intelWatchlist` entries to
 *   resolve the signal's entity against (DELTA_01 §3.C "rapproche des entités de la watchlist").
 * @returns {string}
 */
function buildClassificationPrompt(rawText, watchlistEntities) {
  const watchlist = Array.isArray(watchlistEntities) ? watchlistEntities : [];
  const watchlistLines = watchlist.length
    ? watchlist.map((e) => `- ${e.name}${e.type ? ` (${e.type})` : ""}`).join("\n")
    : "(watchlist vide — aucune entité connue à rapprocher)";

  return `Tu es un analyste de veille stratégique pour Neurones Technologies CI (ESN, intégrateur
multi-éditeurs, Côte d'Ivoire / UEMOA). Analyse le texte source ci-dessous et réponds
UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte hors JSON) respectant
exactement ce schéma :

{
  "title": string,               // titre court et factuel du signal
  "summary": string,              // résumé en 2-3 phrases
  "axis": "partenaires" | "concurrents" | "clients_prospects" | "tech" | "reglementaire",
  "subtype": string,               // ex: product_launch, eol, supply, program_change, pricing, ma,
                                    // tender, funding, leadership, win, hire, regulation, trend, macro
  "impact": "high" | "medium" | "low",
  "stance": "opportunity" | "threat" | "neutral",
  "entity": string | null,         // nom de l'entité de la watchlist la plus proche, sinon null
  "geo": string | null,            // ex: "ci", "afrique_ouest", "afrique"
  "prox": "imminent" | "court" | "moyen" | "horizon", // imminence de l'échéance/impact
  "weakSignal": boolean,           // signal faible/précoce (encore incertain mais potentiellement important)
  "soWhat": string,                // "so-what" : pourquoi ce signal compte pour Neurones
  "recommendedAction": string,     // action recommandée, concrète et actionnable
  "confidence": "high" | "medium" | "low"
}

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
    subtype: coerceString(r.subtype, undefined),
    impact: coerceEnum(r.impact, VALID_IMPACTS, "low"),
    stance: coerceEnum(r.stance, VALID_STANCES, "neutral"),
    ent: coerceString(r.entity, undefined),
    geo: coerceString(r.geo, undefined),
    prox: coerceEnum(r.prox, VALID_PROX, "moyen"),
    neuf: r.weakSignal === true,
    soWhat: coerceString(r.soWhat, undefined),
    recommendedAction: coerceString(r.recommendedAction, undefined),
    confidence: coerceEnum(r.confidence, VALID_IMPACTS, undefined),
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
  AXIS_TO_DETECTION_CAT,
};
