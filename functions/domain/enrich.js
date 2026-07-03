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

// Company context embedded in every enrichment prompt so the synthesis is grounded in who
// Neurones Technologies actually is (not a generic ESN). Single source of truth since Action 1.1
// (audit 2026-07): domain/companyContext.js — re-exported below for backward compatibility with
// existing consumers of `require("./enrich").COMPANY_CONTEXT`.
const { COMPANY_CONTEXT } = require("./companyContext");

const VALID_HORIZONS = ["imminent", "court", "moyen", "horizon"];
const VALID_PROBABILITIES = ["high", "medium", "low"];
const VALID_OPP_BUS = ["ICT", "FORMATION"];

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
 * date, ent, subtype, prox, recommendedAction} — everything else (urls, ratings, internal fields)
 * is deliberately excluded to keep the prompt compact. (ent/subtype/prox/recommendedAction added
 * by Action 4.4 so the opportunity detector and battlecards see the business framing the
 * classifier already produced.)
 * @param {Array<object>} items Raw intelItems doc bodies.
 * @param {{maxTotal?: number}} [options]
 * @returns {Array<{title:string, summary:string, axis:string, impact:string, stance:string, soWhat?:string, date:string, ent?:string, subtype?:string, prox?:string, recommendedAction?:string}>}
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
      // Action 4.4 — mêmes gardes que soWhat : champ présent seulement si non vide (jamais
      // undefined, contrainte Firestore/prompt).
      if (typeof it.ent === "string" && it.ent.trim()) signal.ent = it.ent;
      if (typeof it.subtype === "string" && it.subtype.trim()) signal.subtype = it.subtype;
      if (typeof it.prox === "string" && it.prox.trim()) signal.prox = it.prox;
      if (typeof it.recommendedAction === "string" && it.recommendedAction.trim()) {
        signal.recommendedAction = it.recommendedAction;
      }
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
        `${i + 1}. [${s.axis ?? "?"}/${s.impact ?? "?"}/${s.stance ?? "?"}${s.prox ? `/${s.prox}` : ""}${s.ent ? ` — ${s.ent}` : ""}${s.date ? ` — ${s.date}` : ""}] ${s.title ?? ""}`,
        s.summary ? `   Résumé : ${s.summary}` : null,
        s.soWhat ? `   So-what : ${s.soWhat}` : null,
        s.recommendedAction ? `   Action proposée : ${s.recommendedAction}` : null,
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
function buildSwotPestelPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un analyste de stratégie senior travaillant pour l'entreprise suivante :
${companyContext}

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
function buildTechRadarPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un analyste technologique senior travaillant pour l'entreprise suivante :
${companyContext}

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
function buildBattlecardMovesPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un analyste en intelligence concurrentielle travaillant pour l'entreprise suivante :
${companyContext}

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

/* ------------------------------------------------------------------------------------------- *
 * Détecteur d'opportunités business (Action 6.1, audit 2026-07 — "chaînon manquant n°1") :
 * transforme les signaux de veille en pipeline de leads qualifiés (`bizOpportunities`). Même
 * pattern build/parse que les battlecards ; statut `new` forcé côté parseur (revue humaine
 * obligatoire avant toute action commerciale — les montants/échéances restent déclaratifs).
 * ------------------------------------------------------------------------------------------- */

/**
 * Builds the Gemini prompt turning the accumulated signals into concrete business opportunities.
 * @param {Array<object>} items Lightweight signals from `pickSignalsForEnrichment`.
 * @returns {string}
 */
function buildOpportunitiesPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un directeur du développement commercial travaillant pour l'entreprise suivante :
${companyContext}

À partir des signaux de veille stratégique réels ci-dessous (numérotés), identifie les
opportunités business concrètes que l'entreprise devrait poursuivre (appels d'offres, obligations
réglementaires monétisables, refresh de parc en fin de vie, financements bailleurs, upsell chez
les clients références…). Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de
texte hors JSON) respectant STRICTEMENT ce schéma :

{
  "opportunities": [
    {
      "name": string,               // ex: "Audit conformité SI AMF-UMOA — BRVM"
      "client": string,             // compte cible nommé
      "bu": "ICT" | "FORMATION",
      "offering": string,           // ex: "SOC managé", "mise en conformité RGSSI", "refresh FortiGate série E"
      "estAmount": string | null,   // UNIQUEMENT si un chiffre figure dans un signal
      "deadline": string | null,
      "horizon": "imminent" | "court" | "moyen" | "horizon",
      "probability": "high" | "medium" | "low",
      "nextAction": string,         // première action commerciale concrète et nominative
      "sourceSignals": number[],    // indices 1-based des signaux fondateurs
      "competitorsLikely": string[]
    }
  ]
}

Consignes impératives :
- Rédige tout en français.
- N'invente AUCUN montant ni échéance : "estAmount" et "deadline" sont null si aucun signal ne
  cite de chiffre/date.
- Chaque opportunité doit citer AU MOINS un signal source dans "sourceSignals".
- Entre 0 et 10 opportunités ; s'il n'y en a aucune de crédible, réponds {"opportunities": []}.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/**
 * Validates/coerces the opportunities JSON response (same pattern as
 * `parseBattlecardMovesResponse`). Drops entries missing a non-empty `name`, `client` or
 * `nextAction`; coerces `bu` to "ICT"|"FORMATION" (default "ICT"), `horizon` to its enum (default
 * "moyen"), `probability` to its enum (default "medium"); `estAmount`/`deadline` become trimmed
 * strings or null (never undefined — Firestore rejects undefined); `sourceSignals` filtered to
 * positive integers; `competitorsLikely` filtered to non-empty strings.
 *
 * HARD RULE (human-review gate): `status` is ALWAYS forced to `"new"` on every opportunity —
 * no AI output can mark itself as already qualified/dropped.
 *
 * Returns `{opportunities: []}` for a legitimately empty run; null only for non-object input.
 * @param {unknown} raw
 * @returns {{opportunities: Array<object>} | null}
 */
function parseOpportunitiesResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const oppsRaw = Array.isArray(raw.opportunities) ? raw.opportunities : [];

  const opportunities = [];
  for (const entry of oppsRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const client = typeof entry.client === "string" ? entry.client.trim() : "";
    const nextAction = typeof entry.nextAction === "string" ? entry.nextAction.trim() : "";
    // name identifies the upsert doc (slugId), client/nextAction are what make the lead
    // actionable — an opportunity missing any of them is not worth persisting.
    if (!name || !client || !nextAction) continue;

    opportunities.push({
      name,
      client,
      bu: VALID_OPP_BUS.includes(entry.bu) ? entry.bu : "ICT",
      offering: typeof entry.offering === "string" ? entry.offering.trim() : "",
      // Montants/échéances déclaratifs : null (pas undefined) quand absents ou non-string.
      estAmount: typeof entry.estAmount === "string" && entry.estAmount.trim() ? entry.estAmount.trim() : null,
      deadline: typeof entry.deadline === "string" && entry.deadline.trim() ? entry.deadline.trim() : null,
      horizon: VALID_HORIZONS.includes(entry.horizon) ? entry.horizon : "moyen",
      probability: VALID_PROBABILITIES.includes(entry.probability) ? entry.probability : "medium",
      nextAction,
      sourceSignals: (Array.isArray(entry.sourceSignals) ? entry.sourceSignals : []).filter(
        (n) => Number.isInteger(n) && n >= 1
      ),
      competitorsLikely: coerceStringArray(entry.competitorsLikely),
      // Non-negotiable human review gate — see function doc comment above.
      status: "new",
    });
  }

  return { opportunities };
}

/* ------------------------------------------------------------------------------------------- *
 * Business Model Canvas + Diagnostic (MECE / 7S / maturité) — added 2026-07-02 ("encore des vues
 * vides"): the Cadres>Canvas and Diagnostic views read frameworks/{canvas,diagnostic}, which only
 * a Direction form used to fill. Same pattern as SWOT/PESTEL: AI first-jet from real signals +
 * company context, humans edit afterwards (writeFrameworkDoc's human-guard applies).
 * ------------------------------------------------------------------------------------------- */

/** Exact block titles the Cadres>Canvas editor renders (web/src/modules/veille/views/Cadres.tsx
 * CANVAS_BLOCKS) — the parser drops anything not in this list. */
const CANVAS_BLOCKS = [
  "Partenaires clés",
  "Activités clés",
  "Propositions de valeur",
  "Relations clients",
  "Segments clients",
  "Ressources clés",
  "Canaux",
  "Structure de coûts",
  "Revenus",
];

/** Canonical 7S dimensions (French) for the Diagnostic radar. */
const S7_DIMENSIONS = ["Stratégie", "Structure", "Systèmes", "Valeurs partagées", "Compétences", "Style", "Équipes"];

/**
 * Builds the Gemini prompt producing a Business Model Canvas first-jet.
 * @param {Array<object>} items Lightweight signals from `pickSignalsForEnrichment`.
 * @returns {string}
 */
function buildCanvasPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un consultant en stratégie travaillant pour l'entreprise suivante :
${companyContext}

À partir de ce contexte d'entreprise et des signaux de veille réels ci-dessous, rédige un
Business Model Canvas synthétique pour cette entreprise. Réponds UNIQUEMENT avec un objet JSON
valide (pas de markdown, pas de texte hors JSON) respectant STRICTEMENT ce schéma :

{
  "blocks": [
    { "t": string, "d": string }
  ]
}

Contraintes :
- "t" doit être EXACTEMENT l'un des 9 intitulés suivants (tous présents, une seule fois chacun) :
  ${CANVAS_BLOCKS.map((b) => `"${b}"`).join(", ")}.
- "d" : 2-4 phrases concrètes en français, ancrées dans le contexte de l'entreprise et, quand
  c'est pertinent, dans les signaux fournis.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/**
 * parseCanvasResponse(raw) -> {blocks: [{t, d}]} | null
 * Keeps only blocks whose "t" is one of CANVAS_BLOCKS (deduped, ordered per CANVAS_BLOCKS) with a
 * non-empty string "d". Null when fewer than 3 valid blocks survive (an emptier canvas than that
 * isn't worth persisting). Never emits undefined values.
 */
function parseCanvasResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.blocks)) return null;
  const byTitle = new Map();
  for (const b of raw.blocks) {
    if (!b || typeof b !== "object") continue;
    const t = typeof b.t === "string" ? b.t.trim() : "";
    const d = typeof b.d === "string" ? b.d.trim() : "";
    if (!CANVAS_BLOCKS.includes(t) || !d || byTitle.has(t)) continue;
    byTitle.set(t, { t, d });
  }
  if (byTitle.size < 3) return null;
  return { blocks: CANVAS_BLOCKS.filter((t) => byTitle.has(t)).map((t) => byTitle.get(t)) };
}

/**
 * Builds the Gemini prompt producing the Diagnostic first-jet (arbre MECE + 7S + maturité des
 * capacités) — shapes mirror web/src/modules/veille/views/Diagnostic.tsx's DiagnosticContent
 * (scores on a 0-100 radar).
 * @param {Array<object>} items Lightweight signals from `pickSignalsForEnrichment`.
 * @returns {string}
 */
function buildDiagnosticPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un consultant en stratégie travaillant pour l'entreprise suivante :
${companyContext}

À partir de ce contexte et des signaux de veille réels ci-dessous, produis un diagnostic
stratégique en trois volets. Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown,
pas de texte hors JSON) respectant STRICTEMENT ce schéma :

{
  "issue": {
    "q": string,                       // la question stratégique centrale (une phrase)
    "branches": [
      { "t": string, "h": string[] }  // 3-4 branches MECE ; "t" = intitulé, "h" = 2-4 hypothèses testables
    ]
  },
  "s7": [
    { "s": string, "v": number }      // les 7 dimensions McKinsey 7S, score 0-100
  ],
  "maturite": [
    { "c": string, "v": number }      // 4-6 capacités clés (ex: Cybersécurité, Managed Services, Cloud, Avant-vente, Delivery, Partenariats), score 0-100
  ]
}

Contraintes :
- "s7" doit contenir EXACTEMENT ces 7 dimensions : ${S7_DIMENSIONS.map((s) => `"${s}"`).join(", ")}.
- Les scores (0-100) sont des estimations honnêtes justifiables par le contexte/les signaux — pas
  de complaisance (une ESN régionale n'a pas 90 partout).
- Tout le texte en français, concret, spécifique à cette entreprise.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

function clamp100(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(100, n)));
}

/**
 * parseDiagnosticResponse(raw) -> {issue?, s7?, maturite?} | null
 * Coercions: issue kept only with a non-empty q and ≥1 branch carrying a title + ≥1 hypothesis;
 * s7 entries restricted to S7_DIMENSIONS with a clampable 0-100 score; maturite entries need a
 * non-empty name + clampable score. Null when NO section survives. Never emits undefined values
 * (sections that don't survive are simply absent).
 */
function parseDiagnosticResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};

  const issue = raw.issue;
  if (issue && typeof issue === "object" && typeof issue.q === "string" && issue.q.trim()) {
    const branches = (Array.isArray(issue.branches) ? issue.branches : [])
      .filter((b) => b && typeof b === "object" && typeof b.t === "string" && b.t.trim())
      .map((b) => ({ t: b.t.trim(), h: coerceStringArray(b.h) }))
      .filter((b) => b.h.length > 0);
    if (branches.length > 0) out.issue = { q: issue.q.trim(), branches };
  }

  const s7 = (Array.isArray(raw.s7) ? raw.s7 : [])
    .filter((e) => e && typeof e === "object" && S7_DIMENSIONS.includes(e.s) && clamp100(e.v) != null)
    .map((e) => ({ s: e.s, v: clamp100(e.v) }));
  if (s7.length > 0) {
    // dedupe by dimension, keep S7 canonical order
    const byDim = new Map(s7.map((e) => [e.s, e]));
    out.s7 = S7_DIMENSIONS.filter((s) => byDim.has(s)).map((s) => byDim.get(s));
  }

  const maturite = (Array.isArray(raw.maturite) ? raw.maturite : [])
    .filter((e) => e && typeof e === "object" && typeof e.c === "string" && e.c.trim() && clamp100(e.v) != null)
    .map((e) => ({ c: e.c.trim(), v: clamp100(e.v) }));
  if (maturite.length > 0) out.maturite = maturite;

  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------------------------------------------------------------------------- *
 * Portefeuille & Croissance (« Portefeuille & Croissance vide », 2026-07) — deux artefacts IA :
 * - frameworks/ge9 : matrice GE-McKinsey. La position concurrentielle vient des données internes
 *   (part relative BCG), l'ATTRACTIVITÉ DU MARCHÉ — introuvable en interne — est ESTIMÉE par
 *   l'IA depuis les signaux + le contexte (taille/croissance des marchés adressés en CI/UEMOA).
 * - frameworks/horizons : suggestions d'initiatives H1/H2/H3 dérivées des signaux/opportunités —
 *   l'humain les adopte en créant l'initiative réelle dans Exécution & Décisions.
 * Même garde anti-écrasement humain (writeFrameworkDoc) que les autres frameworks.
 * ------------------------------------------------------------------------------------------- */

const VALID_H = ["H1", "H2", "H3"];

/**
 * @param {Array<object>} items Lightweight signals (pickSignalsForEnrichment).
 * @param {Array<{seg:string, casN:number, casN1:number, delta:number}>} [granularite] CAS réels
 *   par BU (summaries/quanti.granularite) — la position/taille de chaque segment part du réel.
 * @param {string} [companyContext]
 */
function buildGe9Prompt(items, granularite, companyContext = COMPANY_CONTEXT) {
  const granBlock = Array.isArray(granularite) && granularite.length
    ? granularite.map((g) => `- ${g.seg}: CAS N=${g.casN} XOF, CAS N-1=${g.casN1} XOF, delta=${g.delta} XOF`).join("\n")
    : "(données internes indisponibles)";
  return `Tu es un consultant en stratégie travaillant pour l'entreprise suivante :
${companyContext}

Construis une matrice GE-McKinsey (attractivité du marché × position concurrentielle) pour les
segments d'activité de cette entreprise (BU internes, et si pertinent 2-4 segments d'offre plus
fins : cybersécurité/SOC, cloud, réseaux/infra, managed services, formation…). Réponds UNIQUEMENT
avec un objet JSON valide :

{
  "items": [
    {
      "n": string,        // nom du segment
      "attr": number,     // attractivité du marché, 0-100 (taille, croissance, intensité concurrentielle, leviers réglementaires — justifiable par les signaux/contexte)
      "pos": number,      // position concurrentielle de l'entreprise sur ce segment, 0-100 (parts internes, références, certifications)
      "size": number,     // poids relatif du segment pour l'entreprise, 0-100 (CAS réel si connu, sinon estimation)
      "note": string      // justification courte (1-2 phrases) citant signaux/faits
    }
  ]
}

Contraintes : 4 à 8 segments ; scores honnêtes et différenciés (pas tout à 70) ; ancre les notes
dans les signaux et les données internes fournies.

Données internes réelles (CAS par BU) :
${granBlock}

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/** parseGe9Response(raw) -> {items:[{n, attr, pos, size, note}]} | null — clamp 0-100, drop sans nom, null si <3 segments. */
function parseGe9Response(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter((e) => e && typeof e === "object" && typeof e.n === "string" && e.n.trim())
    .map((e) => ({
      n: e.n.trim(),
      attr: clamp100(e.attr) ?? 50,
      pos: clamp100(e.pos) ?? 50,
      size: clamp100(e.size) ?? 30,
      note: typeof e.note === "string" ? e.note.trim() : "",
    }));
  return items.length >= 3 ? { items } : null;
}

/**
 * @param {Array<object>} items Lightweight signals.
 * @param {string} [companyContext]
 */
function buildHorizonsPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un consultant en stratégie travaillant pour l'entreprise suivante :
${companyContext}

Propose des INITIATIVES stratégiques réparties sur les Three Horizons de McKinsey, dérivées des
signaux réels ci-dessous. Réponds UNIQUEMENT avec un objet JSON valide :

{
  "items": [
    {
      "h": "H1" | "H2" | "H3",  // H1 = défendre/optimiser le cœur, H2 = moteurs de croissance émergents, H3 = options de rupture
      "title": string,           // intitulé court et actionnable de l'initiative
      "d": string                // 1-2 phrases : pourquoi maintenant, ancré dans un signal/fait précis
    }
  ]
}

Contraintes : 5 à 9 initiatives au total, chaque horizon représenté ; chaque initiative doit
citer un fait/signal concret (AO, obligation réglementaire, EOL, mouvement concurrent,
financement) — pas de généralités.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/** parseHorizonsResponse(raw) -> {items:[{h, title, d}]} | null — h coercé (défaut H2), drop sans titre, null si <3. */
function parseHorizonsResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter((e) => e && typeof e === "object" && typeof e.title === "string" && e.title.trim())
    .map((e) => ({
      h: VALID_H.includes(e.h) ? e.h : "H2",
      title: e.title.trim(),
      d: typeof e.d === "string" ? e.d.trim() : "",
    }));
  return items.length >= 3 ? { items } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * Rafraîchissement du CONTEXTE ENTREPRISE (dynamique — décision 2026-07 : « le contexte est
 * aussi censé être dynamique »). Le contexte vit dans frameworks/companyContext (versionné,
 * éditable par la Direction dans Cadres) ; l'enrichissement hebdo le met à jour à partir des
 * signaux accumulés (programmes partenaires qui évoluent, nouveaux concurrents, nouvelles
 * obligations…) SAUF si un humain l'a édité (garde writeFrameworkDoc). Le fichier statique
 * companyContext.js reste le seed initial + le repli si le doc est absent.
 * ------------------------------------------------------------------------------------------- */

/** Marqueurs structurels que tout contexte régénéré DOIT conserver — garde-fous contre une
 * réécriture IA qui perdrait les sections critiques (le parseur rejette sinon). */
const CONTEXT_REQUIRED_MARKERS = ["BUSINESS UNITS", "CONCURRENTS", "HOMONYMIE", "OBJECTIF COMMERCIAL"];

/**
 * Builds the Gemini prompt that refreshes the company context from recent signals.
 * @param {string} currentContext Texte actuel de frameworks/companyContext (ou le seed statique).
 * @param {Array<object>} items Lightweight signals from `pickSignalsForEnrichment`.
 * @returns {string}
 */
function buildContextRefreshPrompt(currentContext, items) {
  return `Tu maintiens le CONTEXTE ENTREPRISE de référence utilisé par tous les agents d'analyse
de Neurones Technologies. Voici sa version actuelle :

"""
${currentContext}
"""

À partir des signaux de veille récents ci-dessous, produis une version MISE À JOUR de ce contexte.
Réponds UNIQUEMENT avec un objet JSON valide : { "context": string, "changes": string[] }.

Règles impératives :
- CONSERVE la structure et TOUTES les sections existantes (BUSINESS UNITS, MODÈLE ÉCONOMIQUE,
  PARTENARIATS, CONTEXTE PARTENAIRE, CLIENTS, CONCURRENTS, LEVIERS RÉGLEMENTAIRES, GRILLE DE
  LECTURE, OBJECTIF COMMERCIAL, ATTENTION HOMONYMIE).
- Mets à jour UNIQUEMENT ce que les signaux justifient factuellement : dates de programmes
  partenaires passées/nouvelles, nouveaux concurrents ou mouvements notables, nouvelles
  obligations réglementaires, EOL/pénuries. N'invente RIEN ; ne supprime pas d'informations
  encore valables ; en cas de doute, ne change pas.
- "changes" : la liste courte (0-8) des modifications apportées, en français ("ajout du
  concurrent X", "date Y passée — retirée"...). Si rien ne justifie de changement, renvoie le
  contexte inchangé et "changes": [].

Signaux de veille récents :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/**
 * parseContextRefreshResponse(raw, currentContext) -> {text, changes} | null
 * Garde-fous : contexte non vide, longueur ≥ 60% de l'actuel (une réécriture qui raccourcit
 * brutalement a probablement perdu des sections), tous les CONTEXT_REQUIRED_MARKERS présents.
 * Retourne null (aucune écriture) si la réponse ne passe pas — le contexte courant reste en place.
 */
function parseContextRefreshResponse(raw, currentContext) {
  if (!raw || typeof raw !== "object" || typeof raw.context !== "string") return null;
  const text = raw.context.trim();
  const current = typeof currentContext === "string" ? currentContext : "";
  if (!text || (current && text.length < current.length * 0.6)) return null;
  for (const marker of CONTEXT_REQUIRED_MARKERS) {
    if (!text.includes(marker)) return null;
  }
  const changes = coerceStringArray(raw.changes);
  return { text, changes };
}

module.exports = {
  buildSwotPestelPrompt,
  parseSwotPestelResponse,
  buildTechRadarPrompt,
  parseTechRadarResponse,
  buildBattlecardMovesPrompt,
  parseBattlecardMovesResponse,
  buildOpportunitiesPrompt,
  parseOpportunitiesResponse,
  buildCanvasPrompt,
  parseCanvasResponse,
  buildDiagnosticPrompt,
  parseDiagnosticResponse,
  buildContextRefreshPrompt,
  parseContextRefreshResponse,
  buildGe9Prompt,
  parseGe9Response,
  buildHorizonsPrompt,
  parseHorizonsResponse,
  CONTEXT_REQUIRED_MARKERS,
  pickSignalsForEnrichment,
  slugId,
  SWOT_KEYS,
  CANVAS_BLOCKS,
  S7_DIMENSIONS,
  PESTEL_FACTORS,
  RADAR_RINGS,
  TRENDS,
  COMPANY_CONTEXT,
};
