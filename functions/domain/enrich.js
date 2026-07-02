"use strict";

/**
 * Domain logic: AI enrichment of the strategic artifacts (SWOT/PESTEL frameworks, tech radar,
 * battlecard competitor moves) from the accumulated real `intelItems` signals — user decision:
 * "100% des données externes issues automatiquement de l'IA". The AI generates/refreshes the
 * artifacts; humans EDIT afterwards via the existing forms, they never create from scratch.
 *
 * Pure functions only (no Vertex AI / Firestore access here) — same pattern as
 * domain/classify.js: `build*Prompt` builds the prompt text, `parse*Response` validates/coerces an
 * already-obtained JSON response. Both sides are unit-tested with synthetic fixtures in
 * functions/test/enrich.domain.test.js without ever calling Vertex AI. The only caller that hits
 * the network (`domain/vertex.js#generateJson`) lives in functions/index.js
 * (`enrichStrategicArtifacts` / `enrichNow`).
 *
 * FRONTEND CONTRACT (do not drift — these exact shapes are what the frontend editors read/write):
 * - SWOT content: `{ "Forces": string[], "Faiblesses": string[], "Opportunités": string[],
 *   "Menaces": string[] }` — exactly those 4 French keys.
 * - PESTEL content: `{ factors: [{ f, imp, tr, d }] }` where `f` is one of the 6 exact French
 *   factor names, `imp` ∈ [0,1], `tr` ∈ "↑"|"→"|"↓".
 * - Tech radar blips: quadrant 0=Cybersécurité, 1=Cloud & Infra, 2=Data & IA, 3=Réseau;
 *   ring ∈ "adopter"|"essayer"|"evaluer"|"suspendre".
 */

const SWOT_KEYS = ["Forces", "Faiblesses", "Opportunités", "Menaces"];
const PESTEL_FACTORS = ["Politique", "Économique", "Social", "Technologique", "Environnemental", "Légal"];
const RADAR_RINGS = ["adopter", "essayer", "evaluer", "suspendre"];
const TRENDS = ["↑", "→", "↓"];

/**
 * Company context embedded in every enrichment prompt so the synthesis is grounded in who
 * Neurones Technologies CI actually is (not a generic ESN).
 */
const COMPANY_CONTEXT =
  "Neurones Technologies CI — ESN/intégrateur multi-éditeurs (Cisco, Palo Alto, Fortinet, HPE, " +
  "Microsoft) en Côte d'Ivoire/UEMOA : intégration réseau/infra, cybersécurité, cloud, managed " +
  "services ; clients banques/télécoms/institutions ; enjeux : souveraineté, conformité " +
  "ARTCI/BCEAO, financements bailleurs (BAD), concurrence ESN régionales/telcos B2B.";

/**
 * Deterministic Firestore doc id from a display name: lowercase, NFD accent-strip,
 * non-alphanumerics collapsed to '-'. Used for techRadar blips and battlecards so the same
 * competitor/technology upserts into the same doc across runs.
 * @param {string} name
 * @returns {string}
 */
function slugId(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Filters/sorts/truncates real `intelItems` docs into the lightweight signal shape the enrichment
 * prompts consume: drops archived items, sorts by priorityScore desc then date desc, keeps at
 * most `maxTotal`, and maps each to {title, summary (≤~300 chars), axis, impact, stance, soWhat,
 * date} — everything else (urls, ratings, internal fields) is deliberately excluded to keep the
 * prompt compact.
 * @param {Array<object>} items Raw intelItems doc bodies.
 * @param {{maxTotal?: number}} [options]
 * @returns {Array<{title:string, summary:string, axis:string, impact:string, stance:string, soWhat?:string, date:string}>}
 */
function pickSignalsForEnrichment(items, options) {
  const maxTotal = options && Number.isFinite(options.maxTotal) ? options.maxTotal : 60;
  const list = Array.isArray(items) ? items : [];

  return list
    .filter((it) => it && typeof it === "object" && it.status !== "archived")
    .sort((a, b) => {
      const scoreA = typeof a.priorityScore === "number" ? a.priorityScore : -Infinity;
      const scoreB = typeof b.priorityScore === "number" ? b.priorityScore : -Infinity;
      if (scoreA !== scoreB) return scoreB - scoreA;
      const dateA = typeof a.date === "string" ? a.date : "";
      const dateB = typeof b.date === "string" ? b.date : "";
      return dateB.localeCompare(dateA);
    })
    .slice(0, maxTotal)
    .map((it) => {
      const summary = typeof it.summary === "string" ? it.summary : "";
      const signal = {
        title: typeof it.title === "string" ? it.title : "",
        summary: summary.length > 300 ? `${summary.slice(0, 300)}…` : summary,
        axis: it.axis,
        impact: it.impact,
        stance: it.stance,
        date: it.date,
      };
      if (typeof it.soWhat === "string" && it.soWhat.trim()) signal.soWhat = it.soWhat;
      return signal;
    });
}

/** Renders the signals block shared by all three prompts. */
function signalsBlock(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "(aucun signal disponible)";
  return list
    .map((s, i) => {
      const parts = [
        `${i + 1}. [${s.axis ?? "?"}/${s.impact ?? "?"}/${s.stance ?? "?"}${s.date ? ` — ${s.date}` : ""}] ${s.title ?? ""}`,
        s.summary ? `   Résumé : ${s.summary}` : null,
        s.soWhat ? `   So-what : ${s.soWhat}` : null,
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n");
}

/**
 * Builds the Gemini prompt producing the SWOT + PESTEL strategic synthesis from real signals.
 * @param {Array<object>} items Lightweight signals from `pickSignalsForEnrichment`.
 * @returns {string}
 */
function buildSwotPestelPrompt(items) {
  return `Tu es un analyste de stratégie senior travaillant pour l'entreprise suivante :
${COMPANY_CONTEXT}

À partir des signaux de veille stratégique réels ci-dessous (accumulés par l'équipe de veille),
produis une synthèse stratégique SWOT + PESTEL pour cette entreprise. Réponds UNIQUEMENT avec un
objet JSON valide (pas de markdown, pas de texte hors JSON) respectant STRICTEMENT ce schéma :

{
  "swot": {
    "Forces": string[],
    "Faiblesses": string[],
    "Opportunités": string[],
    "Menaces": string[]
  },
  "pestel": {
    "factors": [
      {
        "f": "Politique" | "Économique" | "Social" | "Technologique" | "Environnemental" | "Légal",
        "imp": number,      // importance/impact du facteur, entre 0 et 1
        "tr": "↑" | "→" | "↓",  // tendance du facteur
        "d": string         // description courte du facteur pour cette entreprise
      }
    ]
  }
}

Consignes impératives :
- Rédige tout en français.
- Les clés du SWOT doivent être EXACTEMENT "Forces", "Faiblesses", "Opportunités", "Menaces".
- 3 à 6 puces par quadrant SWOT, chacune une phrase courte et factuelle.
- Ancre chaque affirmation dans les signaux fournis chaque fois que possible (cite l'entité ou le
  fait concerné) ; complète par le contexte entreprise uniquement quand les signaux ne suffisent pas.
- Le PESTEL doit contenir LES 6 facteurs, chacun exactement une fois, avec les noms français exacts
  ci-dessus.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

function coerceStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.trim());
}

/**
 * Validates/coerces the SWOT+PESTEL JSON response. Guarantees: exactly the 4 SWOT keys (missing
 * quadrant → []), arrays of non-empty strings; `pestel.factors` entries only carry valid factor
 * names, `imp` clamped to [0,1], `tr` coerced to ↑/→/↓ (default "→"), `d` a string; invalid
 * entries dropped; no `undefined` values anywhere (Firestore rejects them). Returns null when the
 * response is unusable (not an object, or carries neither a single SWOT bullet nor a single valid
 * PESTEL factor).
 * @param {unknown} raw
 * @returns {{swot: object, pestel: {factors: Array<object>}} | null}
 */
function parseSwotPestelResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const swotRaw = raw.swot && typeof raw.swot === "object" && !Array.isArray(raw.swot) ? raw.swot : {};
  const swot = {};
  for (const key of SWOT_KEYS) {
    swot[key] = coerceStringArray(swotRaw[key]);
  }

  const factorsRaw = Array.isArray(raw.pestel?.factors) ? raw.pestel.factors : [];
  const factors = [];
  for (const entry of factorsRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (typeof entry.f !== "string" || !PESTEL_FACTORS.includes(entry.f)) continue;
    const impRaw = typeof entry.imp === "number" && Number.isFinite(entry.imp) ? entry.imp : 0.5;
    factors.push({
      f: entry.f,
      imp: Math.min(1, Math.max(0, impRaw)),
      tr: TRENDS.includes(entry.tr) ? entry.tr : "→",
      d: typeof entry.d === "string" ? entry.d : "",
    });
  }

  const hasSwotContent = SWOT_KEYS.some((key) => swot[key].length > 0);
  if (!hasSwotContent && factors.length === 0) return null;

  return { swot, pestel: { factors } };
}

/**
 * Builds the Gemini prompt producing tech-radar blips from tech-axis signals.
 * @param {Array<object>} items Lightweight signals (typically axis === 'tech').
 * @returns {string}
 */
function buildTechRadarPrompt(items) {
  return `Tu es un analyste technologique senior travaillant pour l'entreprise suivante :
${COMPANY_CONTEXT}

À partir des signaux de veille technologique réels ci-dessous, propose les entrées ("blips") d'un
radar technologique pour cette entreprise. Réponds UNIQUEMENT avec un objet JSON valide (pas de
markdown, pas de texte hors JSON) respectant STRICTEMENT ce schéma :

{
  "blips": [
    {
      "name": string,        // nom court de la technologie/pratique
      "quadrant": 0 | 1 | 2 | 3,  // 0=Cybersécurité, 1=Cloud & Infra, 2=Data & IA, 3=Réseau
      "ring": "adopter" | "essayer" | "evaluer" | "suspendre",
      "momentum": "↑" | "→" | "↓",
      "rationale": string    // justification courte, ancrée dans les signaux fournis
    }
  ]
}

Consignes impératives :
- Rédige tout en français.
- Entre 5 et 12 blips, chacun distinct.
- Chaque blip doit être justifié par les signaux fournis chaque fois que possible.
- "ring" reflète la recommandation pour cette entreprise (adopter = en production ;
  essayer = pilote ; evaluer = à étudier ; suspendre = éviter/désinvestir).

Signaux de veille technologique :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/**
 * Validates/coerces the tech-radar JSON response. Drops entries without a non-empty `name`;
 * coerces `quadrant` to an int in [0,3] (default 1), `ring`/`momentum` to their enums (defaults
 * "evaluer"/"→"), `rationale` to a string; no undefined values. Returns null when unusable (not
 * an object, or zero valid blips).
 * @param {unknown} raw
 * @returns {{blips: Array<object>} | null}
 */
function parseTechRadarResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const blipsRaw = Array.isArray(raw.blips) ? raw.blips : [];

  const blips = [];
  for (const entry of blipsRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) continue; // name is required — no way to identify/upsert the blip without it

    let quadrant = Number(entry.quadrant);
    quadrant = Number.isFinite(quadrant) ? Math.trunc(quadrant) : 1;
    if (quadrant < 0 || quadrant > 3) quadrant = 1;

    blips.push({
      name,
      quadrant,
      ring: RADAR_RINGS.includes(entry.ring) ? entry.ring : "evaluer",
      momentum: TRENDS.includes(entry.momentum) ? entry.momentum : "→",
      rationale: typeof entry.rationale === "string" ? entry.rationale : "",
    });
  }

  if (!blips.length) return null;
  return { blips };
}

/**
 * Builds the Gemini prompt extracting recent competitor moves from concurrent-axis signals.
 * @param {Array<object>} items Lightweight signals (typically axis === 'concurrents').
 * @returns {string}
 */
function buildBattlecardMovesPrompt(items) {
  return `Tu es un analyste en intelligence concurrentielle travaillant pour l'entreprise suivante :
${COMPANY_CONTEXT}

À partir des signaux de veille concurrentielle réels ci-dessous, extrais les mouvements récents des
concurrents (annonces, contrats gagnés, recrutements clés, partenariats, expansions, offres…).
Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte hors JSON) respectant
STRICTEMENT ce schéma :

{
  "moves": [
    {
      "competitor": string,   // nom du concurrent
      "move": string,          // description courte et factuelle du mouvement, en français
      "date": "YYYY-MM-DD"    // date du mouvement (celle du signal si inconnue)
    }
  ]
}

Consignes impératives :
- N'invente RIEN : chaque mouvement doit provenir directement d'un signal fourni.
- Un mouvement par entrée ; regroupe par concurrent uniquement si le signal le fait.
- Si aucun mouvement concurrent n'est identifiable, réponds {"moves": []}.

Signaux de veille concurrentielle :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/**
 * Validates the battlecard-moves JSON response. Drops entries missing a non-empty
 * `competitor` or `move`; coerces `date` to a YYYY-MM-DD-looking string (falls back to today);
 * no undefined values. Returns null when unusable (not an object). An empty-but-valid
 * `{moves: []}` is returned as such (a week with no competitor moves is a legitimate outcome,
 * unlike SWOT/radar where emptiness means the response failed).
 * @param {unknown} raw
 * @returns {{moves: Array<{competitor:string, move:string, date:string}>} | null}
 */
function parseBattlecardMovesResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const movesRaw = Array.isArray(raw.moves) ? raw.moves : [];

  const today = new Date().toISOString().slice(0, 10);
  const moves = [];
  for (const entry of movesRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const competitor = typeof entry.competitor === "string" ? entry.competitor.trim() : "";
    const move = typeof entry.move === "string" ? entry.move.trim() : "";
    if (!competitor || !move) continue;
    const date =
      typeof entry.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date.trim())
        ? entry.date.trim()
        : today;
    moves.push({ competitor, move, date });
  }

  return { moves };
}

module.exports = {
  buildSwotPestelPrompt,
  parseSwotPestelResponse,
  buildTechRadarPrompt,
  parseTechRadarResponse,
  buildBattlecardMovesPrompt,
  parseBattlecardMovesResponse,
  pickSignalsForEnrichment,
  slugId,
  SWOT_KEYS,
  PESTEL_FACTORS,
  RADAR_RINGS,
  TRENDS,
  COMPANY_CONTEXT,
};
