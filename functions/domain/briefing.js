"use strict";

/**
 * Domain logic: IA-generated executive briefing ("Pyramide de Minto" — BUILD_KIT.md §2 row 15,
 * §10 "generateBriefing", §13 "V7 IA & sync: generateBriefing (IA): idée directrice + 3
 * arguments MECE + KPIs → briefings (revue humaine)").
 *
 * Pure functions only (no Vertex AI / Firestore access here) — `buildBriefingPrompt` builds the
 * prompt text from `summaries/veille` + `summaries/veille_exec` + top intelItems,
 * `parseBriefingResponse` maps an already-obtained JSON response onto a `briefings/{id}` doc body.
 * Both are unit-tested with synthetic fixtures in functions/test/briefing.domain.test.js without
 * ever calling Vertex AI.
 *
 * Output shape mirrors exactly what `docs/maquette_reference.jsx`'s `Briefing()` component renders
 * (governing thought + 3 MECE arguments + top-3 opportunities/threats + recommendations) so the
 * Briefing.tsx view (web/src/modules/veille/views/Briefing.tsx) can render AI-generated content
 * without any layout change — see that file's fallback-to-maquette-static-content wiring.
 */

const { COMPANY_CONTEXT } = require("./companyContext");
const { stripInvalidCitations } = require("./citations");

const VALID_AXES = ["1. La demande est là", "2. Nous pouvons gagner", "3. Il faut agir vite"];

/**
 * Builds the Minto-pyramid prompt for `generateBriefing`.
 * @param {{
 *   veilleSummary: object|null,        // summaries/veille
 *   veilleExecSummary: object|null,    // summaries/veille_exec
 *   topItems: Array<{title:string, axis?:string, impact?:string, stance?:string, soWhat?:string, priorityScore?:number, ent?:string, date?:string}>,
 *   period: string,                    // e.g. "semaine du 30/06/2026"
 * }} input
 * @returns {string}
 */
/**
 * Signaux NUMÉROTÉS [1..n] : table de sources pour le grounding — chaque affirmation du briefing doit
 * pouvoir citer le signal [n] qui la fonde. `ent`/`date` rendus quand présents (recommandations
 * nominatives et datées). Factorisé pour être réutilisé par le prompt de self-critique.
 */
function numberedItemsBlock(items) {
  return items.length
    ? items
        .map(
          (i, idx) =>
            `[${idx + 1}] [${i.stance ?? "?"}/${i.impact ?? "?"}${i.ent ? ` — ${i.ent}` : ""}${i.date ? ` — ${i.date}` : ""}] ${i.title}${i.soWhat ? ` — so-what: ${i.soWhat}` : ""} (score ${i.priorityScore ?? "?"})`
        )
        .join("\n")
    : "(aucun signal prioritaire disponible)";
}

function buildBriefingPrompt(input) {
  const { veilleSummary, veilleExecSummary, topItems, period, companyContext = COMPANY_CONTEXT } = input || {};
  const items = Array.isArray(topItems) ? topItems : [];

  const itemsBlock = numberedItemsBlock(items);

  const kpisBlock = veilleExecSummary?.boardKpis ? JSON.stringify(veilleExecSummary.boardKpis) : "(indisponible)";
  const countsBlock = veilleSummary?.countsByAxis ? JSON.stringify(veilleSummary.countsByAxis) : "(indisponible)";

  return `Tu es un consultant en stratégie qui prépare un briefing exécutif hebdomadaire pour le
comité de direction de l'entreprise suivante :
${companyContext}

Format attendu : "Pyramide de Minto" (idée directrice, puis 3 arguments MECE qui la soutiennent).

Période : ${period || "période courante"}

KPIs du board (summaries/veille_exec.boardKpis) : ${kpisBlock}
Répartition des signaux par axe (summaries/veille.countsByAxis) : ${countsBlock}

Top signaux prioritaires (triés par priorityScore), NUMÉROTÉS pour citation :
${itemsBlock}

ANCRAGE (grounding) — impératif :
- Fonde CHAQUE argument, opportunité, menace et recommandation UNIQUEMENT sur les signaux numérotés
  ci-dessus et sur les KPIs/répartitions fournis. N'invente aucun fait, chiffre, compte ni échéance.
- Cite le(s) signal(aux) source entre crochets — ex. « ... [2] » ou « ... [1][4] » — dans le "body"
  de chaque argument, le "narrative" et chaque "action". N'utilise que des numéros de la liste
  (1 à ${items.length || 0}) ; ne cite jamais un numéro absent.
- Si un point n'est soutenu par aucun signal listé, ne l'affirme pas.

Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de texte hors JSON)
respectant exactement ce schéma :

{
  "governingThought": string,        // idée directrice — 1 phrase forte, la recommandation centrale
  "arguments": [                      // EXACTEMENT 3 arguments MECE qui soutiennent l'idée directrice
    { "title": string, "body": string },
    { "title": string, "body": string },
    { "title": string, "body": string }
  ],
  "topOpportunities": [ { "title": string, "score": number } ],   // jusqu'à 3
  "topThreats": [ { "title": string, "score": number } ],          // jusqu'à 3
  "narrative": string,                // paragraphe de synthèse (contexte du trimestre)
  "recommendations": [                // 3 à 5, orientées DÉCISION
    { "action": string, "owner": string, "deadline": string, "expectedValue": string | null }
  ],
  "decisionsRequested": [ string ]    // 1 à 3 décisions explicites demandées au comité (go/no-go AO, budget certification Cisco 360 avant expiration CPI juillet 2026, agrément PASSI)
}

Consigne impérative : chaque recommandation doit nommer un compte, un AO, un programme partenaire
ou une obligation réglementaire précise issue des signaux.

Réponds avec le JSON uniquement.`;
}

/**
 * buildBriefingCritiquePrompt(input, draft) -> prompt de SELF-CRITIQUE (fiabilité 2026-07). 2ᵉ passe
 * OPTIONNELLE (activée par flag côté appelant) : on redonne au modèle les signaux numérotés + le
 * BROUILLON de briefing et on lui demande de CORRIGER — retirer toute affirmation non étayée par un
 * signal, corriger les chiffres incohérents, ne garder que des citations [n] valides — puis de
 * renvoyer le MÊME schéma JSON. La sortie se parse avec parseBriefingResponse (mêmes garde-fous).
 * PUR (aucun appel réseau ici). `draft` = corps de briefing déjà parsé (governingThought, arguments,
 * content{narrative,recommendations,decisionsRequested,topOpportunities,topThreats}).
 */
function buildBriefingCritiquePrompt(input, draft) {
  const { topItems } = input || {};
  const items = Array.isArray(topItems) ? topItems : [];
  const d = draft || {};
  const c = d.content || {};
  const draftJson = JSON.stringify(
    {
      governingThought: d.governingThought,
      arguments: d.arguments,
      narrative: c.narrative,
      topOpportunities: c.topOpportunities,
      topThreats: c.topThreats,
      recommendations: c.recommendations,
      decisionsRequested: c.decisionsRequested,
    },
    null,
    2
  );
  return `Tu es un relecteur exigeant. Voici un BROUILLON de briefing exécutif et les SIGNAUX NUMÉROTÉS
[1..${items.length || 0}] qui étaient censés le fonder.

SIGNAUX (seule source autorisée) :
${numberedItemsBlock(items)}

BROUILLON à corriger :
${draftJson}

CORRIGE le brouillon, sans le réécrire inutilement :
- SUPPRIME ou nuance toute affirmation, tout chiffre, compte ou échéance NON étayé par un signal ci-dessus.
- CORRIGE toute incohérence chiffrée (montant/date/score contredits par les signaux ou les KPIs).
- Ne garde que des citations [n] présentes dans la liste (1 à ${items.length || 0}) ; retire les autres.
- Conserve ce qui est correct et bien sourcé (ne dégrade pas un bon brouillon).

Renvoie UNIQUEMENT le MÊME schéma JSON que le brouillon (governingThought, arguments[3],
topOpportunities, topThreats, narrative, recommendations, decisionsRequested), corrigé. JSON uniquement.`;
}

function coerceString(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function coerceArgumentTriple(rawArguments) {
  const arr = Array.isArray(rawArguments) ? rawArguments : [];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const a = arr[i];
    const title = coerceString(a && a.title, VALID_AXES[i]);
    const body = coerceString(a && a.body, "");
    out.push({ title, body });
  }
  return out;
}

/**
 * Coerces one recommendation to the decision-oriented shape (Action 4.3):
 * `{action, owner, deadline, expectedValue}`. RÉTRO-COMPATIBILITÉ : si le modèle renvoie encore
 * une string simple (ancien schéma), elle devient `{action: s, owner: "—", deadline: "—",
 * expectedValue: null}`. Entrées inexploitables → null (droppées par le filter appelant).
 * `expectedValue` reste explicitement null quand absent — jamais undefined (contrainte Firestore).
 * @param {unknown} raw
 * @returns {{action:string, owner:string, deadline:string, expectedValue:string|null} | null}
 */
function coerceRecommendation(raw) {
  if (typeof raw === "string" && raw.trim()) {
    return { action: raw.trim(), owner: "—", deadline: "—", expectedValue: null };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const action = coerceString(raw.action, null);
  if (!action) return null;
  return {
    action,
    owner: coerceString(raw.owner, "—"),
    deadline: coerceString(raw.deadline, "—"),
    expectedValue: coerceString(raw.expectedValue, null),
  };
}

function coerceTopList(rawList) {
  const arr = Array.isArray(rawList) ? rawList : [];
  return arr
    .filter((x) => x && typeof x === "object")
    .slice(0, 3)
    .map((x) => ({
      title: coerceString(x.title, "—"),
      score: typeof x.score === "number" && Number.isFinite(x.score) ? x.score : 0,
    }));
}

/**
 * Validates/maps a raw JSON response (already parsed) onto a `briefings/{id}` doc body
 * (BUILD_KIT.md §6: `{ period, governingThought, arguments[3], content, kpis, generatedBy,
 * reviewedBy, status }`).
 *
 * HARD RULE (BUILD_KIT.md §1/§9.C human-review gate): `status` is ALWAYS forced to `"draft"` and
 * `reviewedBy` ALWAYS forced to `null` here, regardless of anything the AI response claims — no
 * AI-generated briefing is ever auto-published to the board.
 *
 * Returns `null` for completely unusable input (not an object at all).
 *
 * @param {unknown} rawJsonResponse
 * @param {{period: string, generatedBy?: string, kpis?: object}} context
 * @returns {object | null}
 */
function parseBriefingResponse(rawJsonResponse, context) {
  if (!rawJsonResponse || typeof rawJsonResponse !== "object" || Array.isArray(rawJsonResponse)) {
    return null;
  }

  const r = rawJsonResponse;
  const ctx = context || {};

  // Vérification des citations (fiabilité 2026-07) : le prompt numérote les signaux [1..citationsMax].
  // On retire toute citation hors plage (hallucinée) des textes rédigés, pour ne jamais afficher une
  // « preuve » [n] qui ne pointe sur aucun signal. `citationsMax` absent → 0 → toutes retirées.
  const maxCite = Number.isFinite(Number(ctx.citationsMax)) ? Number(ctx.citationsMax) : 0;
  const cite = (s) => stripInvalidCitations(s, maxCite);

  const governingThought = cite(coerceString(r.governingThought, "Analyse en cours — idée directrice non disponible."));
  const args = coerceArgumentTriple(r.arguments).map((a) => ({ title: a.title, body: cite(a.body) }));
  const topOpportunities = coerceTopList(r.topOpportunities);
  const topThreats = coerceTopList(r.topThreats);
  const narrative = cite(coerceString(r.narrative, ""));
  const recommendations = (Array.isArray(r.recommendations)
    ? r.recommendations.map(coerceRecommendation).filter(Boolean)
    : []
  ).map((rec) => ({ ...rec, action: cite(rec.action) }));
  const decisionsRequested = Array.isArray(r.decisionsRequested)
    ? r.decisionsRequested.filter((x) => typeof x === "string" && x.trim()).map((x) => cite(x.trim()))
    : [];

  return {
    period: ctx.period || "période courante",
    governingThought,
    arguments: args,
    content: {
      narrative,
      topOpportunities,
      topThreats,
      recommendations,
      decisionsRequested,
    },
    kpis: ctx.kpis || null,
    generatedBy: ctx.generatedBy || "vertex-ai",
    // Non-negotiable human review gate — see function doc comment above.
    reviewedBy: null,
    status: "draft",
  };
}

module.exports = { buildBriefingPrompt, buildBriefingCritiquePrompt, parseBriefingResponse, VALID_AXES };
