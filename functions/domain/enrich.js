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
 * - Tech radar blips: quadrant 0=IA & Automatisation, 1=Data & Plateformes métier,
 *   2=Cloud & Infrastructures, 3=Cybersécurité & Confiance (recadré 2026-07 — l'innovation ne se
 *   réduit pas à cyber+cloud) ; ring ∈ "adopter"|"essayer"|"evaluer"|"suspendre".
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
function buildTechRadarPrompt(items, companyContext = COMPANY_CONTEXT, existingBlipNames) {
  const existing = Array.isArray(existingBlipNames) && existingBlipNames.length
    ? `\nRadar actuel (générés par IA — ta réponse REMPLACE cette liste, consolide/fusionne les doublons, retire ce qui n'est plus pertinent) :\n${existingBlipNames.map((n) => `- ${n}`).join("\n")}\n`
    : "";
  return `Tu es un analyste technologique senior travaillant pour l'entreprise suivante :
${companyContext}
${existing}
À partir des signaux de veille technologique réels ci-dessous, produis le radar technologique
CONSOLIDÉ de cette entreprise. Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown,
pas de texte hors JSON) respectant STRICTEMENT ce schéma :

{
  "blips": [
    {
      "name": string,        // nom court de la technologie/pratique
      "quadrant": 0 | 1 | 2 | 3,  // 0=IA & Automatisation, 1=Data & Plateformes métier, 2=Cloud & Infrastructures, 3=Cybersécurité & Confiance
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

VISION ÉLARGIE DE L'INNOVATION (impératif — ne PAS réduire la tech à cyber+cloud) : l'innovation
qui crée de la DEMANDE chez les clients de NT dépasse largement l'infrastructure. Couvre les forces
qui transforment leurs MÉTIERS et que NT peut adresser : IA générative & agents métier, automatisation
(RPA/BPA), data & analytics/BI, plateformes & API (open banking, mobile money/fintech, e-commerce/omnicanal),
IoT & edge (industrie, logistique, énergie/smart grid, villes), identité numérique & e-gov, ainsi que
les enablers cloud et cybersécurité. Les quadrants 0 (IA & Automatisation) et 1 (Data & Plateformes métier)
doivent être RÉELLEMENT représentés, pas seulement 2 (Cloud) et 3 (Cyber).

Contraintes impératives :
- Chaque blip est une TECHNOLOGIE ou famille de technologies/pratiques (ex: "IA générative d'entreprise",
  "Agents IA métier", "RPA/automatisation", "Open banking / API", "Mobile money & fintech", "Analytics/BI",
  "IoT industriel", "Cloud souverain", "SASE", "EDR/XDR managé") — JAMAIS une action ou tâche
  ("patching X", "mise à jour Y", "audit Z" sont INTERDITS comme blips).
- Nom court : 4 mots maximum, pas de doublons ni de quasi-doublons.
- 6 à 10 blips au TOTAL, ÉQUILIBRÉS sur les 4 quadrants (au moins un blip en IA & Automatisation et un
  en Data & Plateformes métier) — surtout PAS tout en cybersécurité/cloud.
- "rationale" : justification courte ancrée dans les signaux.

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
- "issue.branches" doit être RÉELLEMENT MECE : les branches ne doivent PAS se chevaucher
  (mutuellement exclusives — une même cause n'apparaît que dans une seule branche) ET couvrir
  l'ensemble du problème (collectivement exhaustives — aucune dimension majeure omise). Chaque
  intitulé "t" nomme un axe de cause distinct ; chaque hypothèse "h" est testable par les données.
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
    // Garde MECE structurelle (m3 audit) : on déduplique les branches dont l'intitulé normalisé
    // est identique (mutuelle exclusivité minimale — deux branches « Coûts » sont fusionnées).
    const seenTitles = new Set();
    const branches = (Array.isArray(issue.branches) ? issue.branches : [])
      .filter((b) => b && typeof b === "object" && typeof b.t === "string" && b.t.trim())
      .map((b) => ({ t: b.t.trim(), h: coerceStringArray(b.h) }))
      .filter((b) => b.h.length > 0)
      .filter((b) => {
        const key = b.t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      });
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

Construis une matrice GE-McKinsey (attractivité du marché × position concurrentielle). Elle doit
couvrir DEUX familles de segments :
(A) les BU/offres ÉTABLIES (avec CAS interne) : réseaux/infra, cybersécurité/SOC, cloud & services
    managés, formation… ;
(B) les SEGMENTS D'OPPORTUNITÉ ÉMERGENTS (whitespace) — marchés à forte attractivité où l'entreprise
    n'a encore PEU ou PAS de chiffre d'affaires mais que les signaux rendent capturables. Tu DOIS
    en faire ressortir au moins 3, en priorité (mais sans t'y limiter) : « IA / GenAI appliquée »
    (copilots, automatisation, IA souveraine, data), « Cloud souverain » (distinct des services
    managés classiques), « SD-WAN / SASE / connectivité managée (WAN) ». N'AGRÈGE PAS une offre
    émergente à fort potentiel dans « services managés » — donne-lui son propre segment.
Réponds UNIQUEMENT avec un objet JSON valide :

{
  "items": [
    {
      "n": string,          // nom du segment
      "attr": number,       // attractivité du marché, 0-100 (taille, croissance, intensité concurrentielle, leviers réglementaires — justifiable par les signaux/contexte)
      "pos": number,        // position concurrentielle de l'entreprise sur ce segment, 0-100 (parts internes, références, certifications ; FAIBLE pour un segment émergent à construire)
      "size": number,       // poids relatif du segment, 0-100 (CAS réel si connu ; pour un émergent : potentiel de marché estimé)
      "emerging": boolean,  // true = segment d'opportunité émergent (famille B), false = BU établie (famille A)
      "note": string        // justification courte (1-2 phrases) citant signaux/faits ; pour un émergent, dire le déclencheur et l'angle de capture
    }
  ]
}

Contraintes : 6 à 9 segments AU TOTAL dont AU MOINS 3 émergents (emerging:true) ; scores honnêtes et
différenciés (pas tout à 70) ; un segment émergent a typiquement attr élevé et pos faible ; ancre
chaque note dans les signaux et les données internes fournies.

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
      emerging: e.emerging === true,
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
 * Porter — 3 forces qualitatives estimées par l'IA (M3 audit 2026-07). Les deux forces
 * quantifiées (pouvoir fournisseurs/clients) restent calculées depuis les données internes ;
 * l'IA complète rivalité, substituts et menace de nouveaux entrants depuis les signaux + contexte,
 * sur une échelle 0-100 (intensité de la force). Écrit dans frameworks/porter (garde humaine).
 * ------------------------------------------------------------------------------------------- */

/**
 * @param {Array<object>} items Lightweight signals.
 * @param {string} [companyContext]
 */
function buildPorterPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es un consultant en stratégie (analyse concurrentielle de Porter) pour l'entreprise suivante :
${companyContext}

Estime l'INTENSITÉ (0-100) de TROIS des cinq forces de Porter — celles qui ne se déduisent pas des
données financières internes (le pouvoir des fournisseurs et des clients est déjà calculé ailleurs).
Fonde chaque estimation sur les signaux réels et le contexte (concurrents, désintermédiation
éditeurs/hyperscalers, nouveaux entrants). Réponds UNIQUEMENT avec un objet JSON valide :

{
  "rivalite": { "v": number, "note": string },        // intensité de la rivalité entre ESN/intégrateurs de la zone
  "substituts": { "v": number, "note": string },      // menace de substitution (vente directe éditeurs, hyperscalers, SaaS, offres télécoms)
  "nouveauxEntrants": { "v": number, "note": string } // menace de nouveaux entrants (pure players, acteurs étrangers, filiales)
}

Contraintes : v entre 0 et 100 (100 = force très intense/menaçante) ; chaque note en 1-2 phrases
cite un fait/signal précis (concurrent nommé, mouvement, tendance). Français. JSON uniquement.`;
}

/** parsePorterResponse(raw) -> {rivalite:{v,note}, substituts:{v,note}, nouveauxEntrants:{v,note}} | null */
function parsePorterResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const one = (o) => {
    if (!o || typeof o !== "object") return null;
    const v = clamp100(o.v);
    if (v == null) return null;
    return { v, note: typeof o.note === "string" ? o.note.trim() : "" };
  };
  const rivalite = one(raw.rivalite);
  const substituts = one(raw.substituts);
  const nouveauxEntrants = one(raw.nouveauxEntrants);
  if (!rivalite && !substituts && !nouveauxEntrants) return null;
  const out = {};
  if (rivalite) out.rivalite = rivalite;
  if (substituts) out.substituts = substituts;
  if (nouveauxEntrants) out.nouveauxEntrants = nouveauxEntrants;
  return out;
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


/* ------------------------------------------------------------------------------------------- *
 * Paris d'innovation (RICE) — suggestions IA (« portefeuille d'innovation vide », 2026-07).
 * L'IA propose 3-6 paris chiffrés RICE dérivés des signaux ; écrits dans innovationPortfolio
 * avec generatedBy:"ai" — l'humain les édite/supprime via le formulaire existant.
 * ------------------------------------------------------------------------------------------- */

const VALID_STAGES = ["idée", "exploration", "poc", "pilote", "scale"];

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * @param {Array<object>} items Lightweight signals.
 * @param {string} [companyContext]
 */
function buildInnovationBetsPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es responsable innovation pour l'entreprise suivante :
${companyContext}

Propose des PARIS D'INNOVATION (nouvelles offres/capacités à explorer) dérivés des signaux réels
ci-dessous, chiffrés selon RICE. Réponds UNIQUEMENT avec un objet JSON valide :

{
  "bets": [
    {
      "title": string,        // intitulé court du pari (ex: "Offre SOC managé souverain")
      "reach": number,        // 1-10 : combien de clients/segments touchés
      "impact": number,       // 1-10 : impact business si succès
      "confidence": number,   // 0-1 : confiance dans les estimations
      "effort": number,       // 1-10 : effort de mise en œuvre
      "stage": "idée" | "exploration" | "poc" | "pilote" | "scale",
      "horizon": string       // ex: "H2" ou "2027"
    }
  ]
}

Contraintes : 3 à 6 paris, chacun justifiable par un signal/fait fourni (réglementation, EOL,
financement, tendance techno monétisable en CI/UEMOA) ; estimations honnêtes et différenciées.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/** parseInnovationBetsResponse(raw) -> {bets:[{title, reach, impact, confidence, effort, rice, stage, horizon}]} | null */
function parseInnovationBetsResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.bets)) return null;
  const bets = raw.bets
    .filter((b) => b && typeof b === "object" && typeof b.title === "string" && b.title.trim())
    .map((b) => {
      const reach = clamp(b.reach, 1, 10) ?? 5;
      const impact = clamp(b.impact, 1, 10) ?? 5;
      const effort = clamp(b.effort, 1, 10) ?? 5;
      let confidence = Number(b.confidence);
      confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5;
      return {
        title: b.title.trim(),
        reach,
        impact,
        confidence: Math.round(confidence * 100) / 100,
        effort,
        // RICE = (reach·impact·confidence)/effort — même formule que web/lib/innovation.ts.
        rice: Math.round(((reach * impact * confidence) / effort) * 10) / 10,
        stage: VALID_STAGES.includes(b.stage) ? b.stage : "idée",
        horizon: typeof b.horizon === "string" && b.horizon.trim() ? b.horizon.trim() : "H2",
      };
    });
  return bets.length >= 2 ? { bets } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * Battlecards complètes — top 10 concurrents de la watchlist (« pas assez riche », 2026-07).
 * L'IA génère positionnement/forces/faiblesses/axes de victoire pour chaque concurrent ;
 * écrites avec generatedBy:"ai" — une carte éditée par un humain n'est jamais écrasée.
 * ------------------------------------------------------------------------------------------- */

/**
 * @param {Array<object>} items Lightweight signals.
 * @param {Array<{name: string, note?: string}>} competitors Watchlist competitors (top 10).
 * @param {string} [companyContext]
 */
function buildFullBattlecardsPrompt(items, competitors, companyContext = COMPANY_CONTEXT) {
  const list = competitors
    .map((c) => `- ${c.name}${c.note ? ` — ${c.note}` : ""}`)
    .join("\n");
  return `Tu es analyste en intelligence concurrentielle pour l'entreprise suivante :
${companyContext}

Rédige une BATTLECARD COMPLÈTE pour CHACUN des concurrents listés ci-dessous (tous, sans exception).
Réponds UNIQUEMENT avec un objet JSON valide :

{
  "cards": [
    {
      "competitor": string,       // le nom EXACT tel que fourni dans la liste
      "positioning": string,      // 1-2 phrases : positionnement marché, segments, points d'appui
      "strengths": [string],      // 2 à 4 forces concrètes (références, partenariats, capacités)
      "weaknesses": [string],     // 2 à 4 faiblesses exploitables
      "ourWinThemes": [string],   // 2 à 4 axes concrets pour gagner contre lui
      "theirLikelyMoves": [string],   // 2 à 3 coups probables du concurrent (ce qu'il va tenter)
      "objectionHandling": [string]   // 2 à 3 objections clients typiques face à nous + la réponse à donner
    }
  ]
}

Contraintes :
- Ancre chaque affirmation dans des faits connus du marché ivoirien/UEMOA ou les notes fournies ;
  pas de généralités interchangeables ("bon service client", "prix compétitifs" sans contexte).
- Les axes de victoire doivent s'appuyer sur NOS atouts réels (partenariats, certifications,
  proximité, Academy, références) face aux faiblesses de CE concurrent précis.
- Tout en français.

Concurrents à traiter :
${list}

Signaux de veille récents (utilise ceux qui concernent ces concurrents) :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

/** parseFullBattlecardsResponse(raw) -> {cards:[{competitor, positioning, strengths, weaknesses, ourWinThemes, theirLikelyMoves, objectionHandling}]} | null */
function parseFullBattlecardsResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.cards)) return null;
  const cards = raw.cards
    .filter((c) => c && typeof c === "object" && typeof c.competitor === "string" && c.competitor.trim())
    .map((c) => ({
      competitor: c.competitor.trim(),
      positioning: typeof c.positioning === "string" ? c.positioning.trim() : "",
      strengths: coerceStringArray(c.strengths),
      weaknesses: coerceStringArray(c.weaknesses),
      ourWinThemes: coerceStringArray(c.ourWinThemes),
      theirLikelyMoves: coerceStringArray(c.theirLikelyMoves),
      objectionHandling: coerceStringArray(c.objectionHandling),
    }))
    .filter((c) => c.strengths.length || c.weaknesses.length || c.ourWinThemes.length);
  return cards.length ? { cards } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * Cadres stratégiques additionnels (audit 2026-07 — cadres attendus d'un cabinet mais absents) :
 * Ansoff (produit × marché), VRIO (avantages ressources), Chaîne de valeur (Porter). Générés par
 * l'IA depuis les signaux + contexte, écrits dans frameworks/{ansoff,vrio,valueChain} (garde humaine).
 * ------------------------------------------------------------------------------------------- */

function buildAnsoffPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es consultant en stratégie (matrice d'Ansoff) pour l'entreprise suivante :
${companyContext}

Propose des initiatives de croissance réparties dans les 4 cases de la matrice d'Ansoff, dérivées
des signaux réels. Réponds UNIQUEMENT avec un objet JSON valide :

{
  "penetration": [string],     // marchés actuels × offres actuelles (gagner des parts)
  "devProduit": [string],      // marchés actuels × nouvelles offres (ex: SOC managé, cloud souverain)
  "devMarche": [string],       // nouveaux marchés/géos × offres actuelles (ex: Burkina, Sénégal)
  "diversification": [string]  // nouveaux marchés × nouvelles offres (pari plus risqué)
}

Contraintes : 2 à 3 initiatives concrètes par case, chacune ancrée dans un signal/fait (AO, EOL,
obligation, tendance, mouvement concurrent). Français. JSON uniquement.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

function parseAnsoffResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const keys = ["penetration", "devProduit", "devMarche", "diversification"];
  const out = {};
  let total = 0;
  for (const k of keys) {
    out[k] = coerceStringArray(raw[k]);
    total += out[k].length;
  }
  return total >= 2 ? out : null;
}

function buildVrioPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es consultant en stratégie (analyse VRIO des ressources et capacités) pour l'entreprise suivante :
${companyContext}

Évalue les ressources/capacités DISTINCTIVES de l'entreprise (ex : agrément PASSI, statut WALLIX
Premier, Neurones Academy, références bancaires, proximité régulateurs). Pour chacune, indique si
elle est Valorisable, Rare, Inimitable et si l'entreprise est Organisée pour l'exploiter, puis un
verdict d'avantage. Réponds UNIQUEMENT avec un objet JSON valide :

{
  "resources": [
    {
      "resource": string,        // nom de la ressource/capacité
      "valuable": boolean,
      "rare": boolean,
      "inimitable": boolean,
      "organized": boolean,
      "verdict": "avantage durable" | "avantage temporaire" | "parité concurrentielle" | "désavantage",
      "note": string             // 1 phrase justifiant, ancrée dans un fait
    }
  ]
}

Contraintes : 4 à 6 ressources, honnêtes (toutes ne sont pas des avantages durables). Français. JSON uniquement.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

const VRIO_VERDICTS = ["avantage durable", "avantage temporaire", "parité concurrentielle", "désavantage"];
function parseVrioResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.resources)) return null;
  const resources = raw.resources
    .filter((r) => r && typeof r === "object" && typeof r.resource === "string" && r.resource.trim())
    .map((r) => ({
      resource: r.resource.trim(),
      valuable: r.valuable === true,
      rare: r.rare === true,
      inimitable: r.inimitable === true,
      organized: r.organized === true,
      verdict: VRIO_VERDICTS.includes(r.verdict) ? r.verdict : "parité concurrentielle",
      note: typeof r.note === "string" ? r.note.trim() : "",
    }));
  return resources.length >= 3 ? { resources } : null;
}

function buildValueChainPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es consultant en stratégie (chaîne de valeur de Porter) pour l'entreprise suivante :
${companyContext}

Évalue la chaîne de valeur d'un intégrateur IT (avant-vente/conseil → approvisionnement →
intégration/déploiement → services managés → support & formation) et les activités de soutien
(RH/talents, achats/distributeurs, technologie/certifications, infrastructure). Pour chaque
activité, donne une force 0-100 et un levier d'amélioration. Réponds UNIQUEMENT avec un objet JSON valide :

{
  "primary": [ { "activity": string, "strength": number, "lever": string } ],   // 4 à 6 activités principales
  "support": [ { "activity": string, "strength": number, "lever": string } ]    // 3 à 4 activités de soutien
}

Contraintes : strength 0-100 honnête et différenciée ; lever = 1 action concrète ancrée dans le
contexte/les signaux. Français. JSON uniquement.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

function parseValueChainResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mapActs = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((a) => a && typeof a === "object" && typeof a.activity === "string" && a.activity.trim())
      .map((a) => ({
        activity: a.activity.trim(),
        strength: clamp100(a.strength) ?? 50,
        lever: typeof a.lever === "string" ? a.lever.trim() : "",
      }));
  const primary = mapActs(raw.primary);
  const support = mapActs(raw.support);
  if (primary.length + support.length < 4) return null;
  return { primary, support };
}

/* ------------------------------------------------------------------------------------------- *
 * Scénarios prospectifs (M4 audit 2026-07 : les scénarios étaient inertes — pas de signaux
 * précurseurs). L'IA propose 2 axes d'incertitude, 4 mondes probabilisés, et pour chacun des
 * SIGNPOSTS (signaux précurseurs à guetter) + une réponse préparée. Écrit dans frameworks/scenarios
 * (advisory, comme horizons — l'humain adopte en créant un scénario réel dans la vue Scénarios).
 * ------------------------------------------------------------------------------------------- */

function buildScenariosPrompt(items, companyContext = COMPANY_CONTEXT) {
  return `Tu es consultant en planification par scénarios (méthode GBN/Shell) pour l'entreprise suivante :
${companyContext}

Construis un exercice de scénarios à partir des incertitudes clés révélées par les signaux.
Réponds UNIQUEMENT avec un objet JSON valide :

{
  "axisX": string,   // 1re incertitude structurante (ex: "Rythme d'application des obligations PASSI")
  "axisY": string,   // 2e incertitude structurante et INDÉPENDANTE (ex: "Arrivée directe des hyperscalers")
  "worlds": [
    {
      "title": string,        // nom évocateur du monde
      "probability": number,  // 0-1
      "narrative": string,    // 1-2 phrases décrivant ce monde
      "signposts": [string],  // 2-3 signaux précurseurs concrets à guetter dans la veille (early-warning)
      "response": string      // la réponse stratégique préparée si ce monde advient
    }
  ]
}

Contraintes : EXACTEMENT 4 mondes (les 4 combinaisons des 2 axes), probabilités sommant ~1,
signposts ancrés dans des faits observables. Français. JSON uniquement.

Signaux de veille :
${signalsBlock(items)}

Réponds avec le JSON uniquement.`;
}

function parseScenariosResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.worlds)) return null;
  const axisX = typeof raw.axisX === "string" ? raw.axisX.trim() : "";
  const axisY = typeof raw.axisY === "string" ? raw.axisY.trim() : "";
  const worlds = raw.worlds
    .filter((w) => w && typeof w === "object" && typeof w.title === "string" && w.title.trim())
    .map((w) => {
      let p = Number(w.probability);
      p = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.25;
      return {
        title: w.title.trim(),
        probability: Math.round(p * 100) / 100,
        narrative: typeof w.narrative === "string" ? w.narrative.trim() : "",
        signposts: coerceStringArray(w.signposts),
        response: typeof w.response === "string" ? w.response.trim() : "",
      };
    });
  if (worlds.length < 3) return null;
  return { axisX, axisY, worlds };
}

module.exports = {
  buildSwotPestelPrompt,
  parseSwotPestelResponse,
  buildScenariosPrompt,
  parseScenariosResponse,
  buildAnsoffPrompt,
  parseAnsoffResponse,
  buildVrioPrompt,
  parseVrioResponse,
  buildValueChainPrompt,
  parseValueChainResponse,
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
  buildInnovationBetsPrompt,
  parseInnovationBetsResponse,
  buildFullBattlecardsPrompt,
  parseFullBattlecardsResponse,
  buildHorizonsPrompt,
  parseHorizonsResponse,
  buildPorterPrompt,
  parsePorterResponse,
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
