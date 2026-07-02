"use strict";

/**
 * Pure-function tests for functions/domain/enrich.js (AI enrichment of strategic artifacts —
 * SWOT/PESTEL, tech radar, battlecard moves). No Vertex AI call is made here — the parsers are
 * exercised with synthetic fixtures standing in for already-parsed Gemini responses, same pattern
 * as classify.domain.test.js.
 *
 * Run: npx vitest run test/enrich.domain.test.js
 */

import { describe, it, expect } from "vitest";
import {
  buildSwotPestelPrompt,
  parseSwotPestelResponse,
  buildTechRadarPrompt,
  parseTechRadarResponse,
  buildBattlecardMovesPrompt,
  parseBattlecardMovesResponse,
  buildOpportunitiesPrompt,
  parseOpportunitiesResponse,
  pickSignalsForEnrichment,
  slugId,
  SWOT_KEYS,
} from "../domain/enrich.js";

/** Recursively asserts that no value anywhere in the structure is undefined (Firestore rejects
 *  undefined outright — same production regression guarded in classify.domain.test.js). */
function expectNoUndefined(value, path = "root") {
  expect(value, `"${path}" must not be undefined`).not.toBeUndefined();
  if (Array.isArray(value)) {
    value.forEach((v, i) => expectNoUndefined(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) expectNoUndefined(v, `${path}.${k}`);
  }
}

const SIGNALS = [
  { title: "Orange CI lance une offre SOC managé", summary: "Offre SOC clé en main pour les banques.", axis: "concurrents", impact: "high", stance: "threat", soWhat: "Concurrence frontale sur les managed services cyber.", date: "2026-06-20" },
  { title: "BCEAO durcit les exigences de résilience IT", summary: "Nouvelle circulaire résilience.", axis: "reglementaire", impact: "high", stance: "opportunity", date: "2026-06-25" },
];

describe("prompt builders", () => {
  it("buildSwotPestelPrompt embeds company context, signals, and the exact SWOT/PESTEL contract", () => {
    const prompt = buildSwotPestelPrompt(SIGNALS);
    expect(prompt).toContain("Neurones Technologies S.A."); // contexte unique (domain/companyContext.js)
    expect(prompt).toContain("Orange CI lance une offre SOC managé");
    for (const key of SWOT_KEYS) expect(prompt).toContain(`"${key}"`);
    for (const f of ["Politique", "Économique", "Social", "Technologique", "Environnemental", "Légal"]) {
      expect(prompt).toContain(f);
    }
    expect(prompt).toContain("JSON");
  });

  it("buildTechRadarPrompt embeds quadrant semantics and ring enum", () => {
    const prompt = buildTechRadarPrompt(SIGNALS);
    expect(prompt).toContain("0=Cybersécurité");
    expect(prompt).toContain("3=Réseau");
    expect(prompt).toContain('"adopter" | "essayer" | "evaluer" | "suspendre"');
    expect(prompt).toContain("Orange CI lance une offre SOC managé");
  });

  it("buildBattlecardMovesPrompt embeds the moves schema and signals, handles empty input", () => {
    const prompt = buildBattlecardMovesPrompt(SIGNALS);
    expect(prompt).toContain('"competitor"');
    expect(prompt).toContain("YYYY-MM-DD");
    expect(prompt).toContain("BCEAO durcit les exigences");
    expect(buildBattlecardMovesPrompt([])).toContain("aucun signal disponible");
  });
});

describe("parseSwotPestelResponse", () => {
  it("passes through a fully valid response, preserving the exact frontend shapes", () => {
    const raw = {
      swot: {
        Forces: ["Partenariats multi-éditeurs solides"],
        Faiblesses: ["Dépendance aux constructeurs US"],
        Opportunités: ["Circulaire BCEAO → demande de résilience IT"],
        Menaces: ["Orange CI attaque le marché SOC managé"],
      },
      pestel: {
        factors: [
          { f: "Politique", imp: 0.6, tr: "→", d: "Stabilité relative en CI" },
          { f: "Légal", imp: 0.9, tr: "↑", d: "Durcissement ARTCI/BCEAO" },
        ],
      },
    };
    const parsed = parseSwotPestelResponse(raw);
    expect(parsed).toEqual(raw);
    expectNoUndefined(parsed);
  });

  it("fills missing SWOT quadrants with [] and always emits exactly the 4 keys", () => {
    const parsed = parseSwotPestelResponse({ swot: { Forces: ["a"], Bogus: ["x"] }, pestel: { factors: [] } });
    expect(Object.keys(parsed.swot).sort()).toEqual([...SWOT_KEYS].sort());
    expect(parsed.swot.Forces).toEqual(["a"]);
    expect(parsed.swot.Menaces).toEqual([]);
    expect(parsed.swot).not.toHaveProperty("Bogus");
  });

  it("strips non-string / empty entries from SWOT arrays", () => {
    const parsed = parseSwotPestelResponse({ swot: { Menaces: ["ok", "", "   ", 42, null, { x: 1 }] } });
    expect(parsed.swot.Menaces).toEqual(["ok"]);
  });

  it("clamps imp to [0,1], defaults tr to '→', coerces d, and drops invalid factor entries", () => {
    const raw = {
      pestel: {
        factors: [
          { f: "Économique", imp: 3.7, tr: "up", d: null },
          { f: "Technologique", imp: -1, tr: "↓", d: "d" },
          { f: "NotAFactor", imp: 0.5, tr: "↑", d: "x" }, // invalid name → dropped
          null, // null entry → dropped
          "junk", // non-object → dropped
          { imp: 0.5 }, // missing f → dropped
        ],
      },
    };
    const parsed = parseSwotPestelResponse(raw);
    expect(parsed.pestel.factors).toEqual([
      { f: "Économique", imp: 1, tr: "→", d: "" },
      { f: "Technologique", imp: 0, tr: "↓", d: "d" },
    ]);
    expectNoUndefined(parsed);
  });

  it("returns null for unusable input (non-object, or no content at all)", () => {
    expect(parseSwotPestelResponse(null)).toBeNull();
    expect(parseSwotPestelResponse("swot")).toBeNull();
    expect(parseSwotPestelResponse([])).toBeNull();
    expect(parseSwotPestelResponse({})).toBeNull();
    expect(parseSwotPestelResponse({ swot: { Forces: [] }, pestel: { factors: [] } })).toBeNull();
  });
});

describe("parseTechRadarResponse", () => {
  it("passes through valid blips and never emits undefined", () => {
    const raw = {
      blips: [
        { name: "SASE", quadrant: 0, ring: "essayer", momentum: "↑", rationale: "Signal Palo Alto" },
        { name: "FinOps", quadrant: 1, ring: "adopter", momentum: "→", rationale: "" },
      ],
    };
    const parsed = parseTechRadarResponse(raw);
    expect(parsed).toEqual(raw);
    expectNoUndefined(parsed);
  });

  it("coerces out-of-range quadrant, invalid ring/momentum, and missing rationale", () => {
    const parsed = parseTechRadarResponse({
      blips: [{ name: "Edge AI", quadrant: 7, ring: "hold", momentum: "up" }],
    });
    expect(parsed.blips).toEqual([{ name: "Edge AI", quadrant: 1, ring: "evaluer", momentum: "→", rationale: "" }]);
    expectNoUndefined(parsed);
  });

  it("drops entries without a usable name (and null/non-object entries)", () => {
    const parsed = parseTechRadarResponse({
      blips: [{ quadrant: 2, ring: "adopter" }, { name: "   " }, null, "x", { name: "Zero Trust", quadrant: "2" }],
    });
    expect(parsed.blips).toHaveLength(1);
    expect(parsed.blips[0]).toMatchObject({ name: "Zero Trust", quadrant: 2 });
  });

  it("returns null when unusable (non-object or zero valid blips)", () => {
    expect(parseTechRadarResponse(null)).toBeNull();
    expect(parseTechRadarResponse([1])).toBeNull();
    expect(parseTechRadarResponse({})).toBeNull();
    expect(parseTechRadarResponse({ blips: [{ ring: "adopter" }] })).toBeNull();
  });
});

describe("parseBattlecardMovesResponse", () => {
  it("keeps valid moves, drops entries missing competitor or move, never emits undefined", () => {
    const parsed = parseBattlecardMovesResponse({
      moves: [
        { competitor: "Orange CI", move: "Lancement offre SOC managé", date: "2026-06-20" },
        { competitor: "", move: "x" },
        { competitor: "Inova", move: "   " },
        { move: "sans concurrent" },
        null,
      ],
    });
    expect(parsed.moves).toEqual([{ competitor: "Orange CI", move: "Lancement offre SOC managé", date: "2026-06-20" }]);
    expectNoUndefined(parsed);
  });

  it("falls back to today's date when date is missing or malformed", () => {
    const parsed = parseBattlecardMovesResponse({
      moves: [
        { competitor: "Inova", move: "Recrutement d'un directeur cyber" },
        { competitor: "SNDI", move: "Contrat gagné", date: "juin 2026" },
      ],
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(parsed.moves.map((m) => m.date)).toEqual([today, today]);
  });

  it("returns {moves: []} for a legitimately empty week, null only for non-object input", () => {
    expect(parseBattlecardMovesResponse({ moves: [] })).toEqual({ moves: [] });
    expect(parseBattlecardMovesResponse({})).toEqual({ moves: [] });
    expect(parseBattlecardMovesResponse(null)).toBeNull();
    expect(parseBattlecardMovesResponse("moves")).toBeNull();
  });
});

describe("buildOpportunitiesPrompt", () => {
  it("embeds company context, the opportunities schema, the no-invention rule, and the signals", () => {
    const prompt = buildOpportunitiesPrompt(SIGNALS);
    expect(prompt).toContain("Neurones Technologies");
    expect(prompt).toContain('"opportunities"');
    expect(prompt).toContain('"ICT" | "FORMATION"');
    expect(prompt).toContain('"imminent" | "court" | "moyen" | "horizon"');
    expect(prompt).toContain("N'invente AUCUN montant");
    expect(prompt).toContain('{"opportunities": []}');
    expect(prompt).toContain("Orange CI lance une offre SOC managé");
    expect(buildOpportunitiesPrompt([])).toContain("aucun signal disponible");
  });
});

describe("parseOpportunitiesResponse", () => {
  const validOpp = {
    name: "Audit conformité SI AMF-UMOA — BRVM",
    client: "BRVM",
    bu: "ICT",
    offering: "Audit de conformité aux instructions SI AMF-UMOA",
    estAmount: null,
    deadline: "2026-09-30",
    horizon: "court",
    probability: "high",
    nextAction: "Contacter le DSI de la BRVM pour proposer un audit avant fin septembre",
    sourceSignals: [2],
    competitorsLikely: ["Talentys", "Atos"],
  };

  it("passes through a valid fixture, forcing status 'new' and never emitting undefined", () => {
    const parsed = parseOpportunitiesResponse({
      opportunities: [{ ...validOpp, status: "qualified" }], // AI must NOT be able to set status
    });
    expect(parsed.opportunities).toHaveLength(1);
    expect(parsed.opportunities[0]).toEqual({ ...validOpp, status: "new" });
    expectNoUndefined(parsed);
  });

  it("drops entries missing name, client, or nextAction (and null/non-object entries)", () => {
    const parsed = parseOpportunitiesResponse({
      opportunities: [
        validOpp,
        { ...validOpp, name: "   " },
        { ...validOpp, client: "" },
        { ...validOpp, nextAction: undefined },
        null,
        "junk",
      ],
    });
    expect(parsed.opportunities).toHaveLength(1);
    expect(parsed.opportunities[0].name).toBe(validOpp.name);
  });

  it("coerces invalid enums (bu→ICT, horizon→moyen, probability→medium) and junk fields", () => {
    const parsed = parseOpportunitiesResponse({
      opportunities: [
        {
          name: "Refresh FortiGate — SONAPIE",
          client: "SONAPIE",
          bu: "les_deux", // pas un bu d'opportunité valide → ICT
          offering: 42,
          estAmount: "  ", // vide → null (jamais inventé)
          deadline: 2026,
          horizon: "asap",
          probability: "sure",
          nextAction: "Qualifier le parc FortiGate série E avec le commercial du compte",
          sourceSignals: [1, 0, -3, 2.5, "2", null],
          competitorsLikely: ["Talentys", "", 7, null],
        },
      ],
    });
    expect(parsed.opportunities[0]).toEqual({
      name: "Refresh FortiGate — SONAPIE",
      client: "SONAPIE",
      bu: "ICT",
      offering: "",
      estAmount: null,
      deadline: null,
      horizon: "moyen",
      probability: "medium",
      nextAction: "Qualifier le parc FortiGate série E avec le commercial du compte",
      sourceSignals: [1],
      competitorsLikely: ["Talentys"],
      status: "new",
    });
    expectNoUndefined(parsed);
  });

  it("returns {opportunities: []} for a legitimately empty run, null only for non-object input", () => {
    expect(parseOpportunitiesResponse({ opportunities: [] })).toEqual({ opportunities: [] });
    expect(parseOpportunitiesResponse({})).toEqual({ opportunities: [] });
    expect(parseOpportunitiesResponse(null)).toBeNull();
    expect(parseOpportunitiesResponse([])).toBeNull();
    expect(parseOpportunitiesResponse("opps")).toBeNull();
  });
});

describe("pickSignalsForEnrichment", () => {
  const items = [
    { title: "B", summary: "s", axis: "tech", impact: "low", stance: "neutral", date: "2026-06-01", priorityScore: 50, status: "new" },
    { title: "Archived", summary: "s", axis: "tech", impact: "high", stance: "threat", date: "2026-06-30", priorityScore: 99, status: "archived" },
    { title: "A", summary: "s", axis: "concurrents", impact: "high", stance: "threat", date: "2026-06-15", priorityScore: 80, status: "reviewed", soWhat: "important" },
    { title: "C-newer", summary: "s", axis: "tech", impact: "low", stance: "neutral", date: "2026-06-28", status: "new" }, // no priorityScore
    { title: "C-older", summary: "s", axis: "tech", impact: "low", stance: "neutral", date: "2026-06-10", status: "new" },
  ];

  it("filters archived, sorts by priorityScore desc then date desc", () => {
    const picked = pickSignalsForEnrichment(items);
    expect(picked.map((s) => s.title)).toEqual(["A", "B", "C-newer", "C-older"]);
  });

  it("truncates to maxTotal and maps to the lightweight prompt shape", () => {
    const picked = pickSignalsForEnrichment(items, { maxTotal: 2 });
    expect(picked).toHaveLength(2);
    expect(picked[0]).toEqual({
      title: "A", summary: "s", axis: "concurrents", impact: "high", stance: "threat", date: "2026-06-15", soWhat: "important",
    });
    // soWhat absent (not undefined) when the item has none — Firestore/prompt hygiene.
    expect(Object.keys(picked[1])).not.toContain("soWhat");
    expectNoUndefined(picked);
  });

  it("propagates ent/subtype/prox/recommendedAction when present, omits them (not undefined) otherwise", () => {
    const picked = pickSignalsForEnrichment([
      {
        title: "AO BCEAO", summary: "s", axis: "clients_prospects", impact: "high", stance: "opportunity",
        date: "2026-06-29", status: "new", ent: "BCEAO", subtype: "tender", prox: "imminent",
        recommendedAction: "Constituer le dossier SIGOMAP avant le 15/07.",
      },
      { title: "Sans extras", summary: "s", axis: "tech", impact: "low", stance: "neutral", date: "2026-06-01", status: "new", ent: "  " },
    ]);
    expect(picked[0]).toMatchObject({ ent: "BCEAO", subtype: "tender", prox: "imminent", recommendedAction: "Constituer le dossier SIGOMAP avant le 15/07." });
    for (const key of ["ent", "subtype", "prox", "recommendedAction"]) {
      expect(Object.keys(picked[1])).not.toContain(key);
    }
    expectNoUndefined(picked);
  });

  it("truncates long summaries to ~300 chars and tolerates junk entries", () => {
    const long = "x".repeat(500);
    const picked = pickSignalsForEnrichment([
      { title: "Long", summary: long, axis: "tech", impact: "low", stance: "neutral", date: "2026-06-01", status: "new" },
      null,
      "junk",
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0].summary.length).toBeLessThanOrEqual(301); // 300 + ellipsis
  });
});

describe("slugId", () => {
  it("lowercases, strips accents, and collapses non-alphanumerics to '-'", () => {
    expect(slugId("Sécurité & Réseaux (Palo Alto)")).toBe("securite-reseaux-palo-alto");
    expect(slugId("  Orange CI  ")).toBe("orange-ci");
    expect(slugId("Zero Trust")).toBe(slugId("zero---trust")); // deterministic across runs
  });
});

describe("parseCanvasResponse", () => {
  it("keeps only canonical block titles with non-empty text, ordered per CANVAS_BLOCKS", async () => {
    const { parseCanvasResponse, CANVAS_BLOCKS } = await import("../domain/enrich.js");
    const parsed = parseCanvasResponse({
      blocks: [
        { t: "Canaux", d: "Vente directe + partenaires distributeurs." },
        { t: "Partenaires clés", d: "Cisco, Palo Alto, Westcon." },
        { t: "Partenaires clés", d: "doublon ignoré" },
        { t: "Bloc inventé", d: "à jeter" },
        { t: "Revenus", d: "  " },
        { t: "Propositions de valeur", d: "Intégration + managed services souverains." },
      ],
    });
    expect(parsed.blocks.map((b) => b.t)).toEqual(["Partenaires clés", "Propositions de valeur", "Canaux"]);
    expect(parsed.blocks[0].d).toBe("Cisco, Palo Alto, Westcon.");
    expect(CANVAS_BLOCKS).toHaveLength(9);
  });

  it("returns null under 3 valid blocks or on junk", async () => {
    const { parseCanvasResponse } = await import("../domain/enrich.js");
    expect(parseCanvasResponse({ blocks: [{ t: "Canaux", d: "x" }] })).toBeNull();
    expect(parseCanvasResponse(null)).toBeNull();
    expect(parseCanvasResponse({ blocks: "nope" })).toBeNull();
  });
});

describe("parseDiagnosticResponse", () => {
  it("coerces a full fixture: issue branches filtered, s7 canonical order, scores clamped 0-100", async () => {
    const { parseDiagnosticResponse, S7_DIMENSIONS } = await import("../domain/enrich.js");
    const parsed = parseDiagnosticResponse({
      issue: {
        q: "Comment doubler le CA managed services d'ici 2028 ?",
        branches: [
          { t: "Offre", h: ["Packager 3 offres managed", "SOC souverain"] },
          { t: "Sans hypothèses", h: [] },
        ],
      },
      s7: [
        { s: "Stratégie", v: 140 },
        { s: "Systèmes", v: -5 },
        { s: "Dimension inventée", v: 50 },
        { s: "Structure", v: 61.4 },
      ],
      maturite: [
        { c: "Cybersécurité", v: 70 },
        { c: "", v: 50 },
      ],
    });
    expect(parsed.issue.branches).toHaveLength(1);
    expect(parsed.s7.map((e) => e.s)).toEqual(["Stratégie", "Structure", "Systèmes"]); // canonical order
    expect(parsed.s7.map((e) => e.v)).toEqual([100, 61, 0]); // clamped/rounded
    expect(parsed.maturite).toEqual([{ c: "Cybersécurité", v: 70 }]);
    expect(S7_DIMENSIONS).toHaveLength(7);
  });

  it("drops empty sections and returns null when nothing survives; never emits undefined", async () => {
    const { parseDiagnosticResponse } = await import("../domain/enrich.js");
    expect(parseDiagnosticResponse({ issue: { q: "" }, s7: [], maturite: [] })).toBeNull();
    const partial = parseDiagnosticResponse({ maturite: [{ c: "Cloud", v: 40 }] });
    expect(partial).toEqual({ maturite: [{ c: "Cloud", v: 40 }] });
    expect("issue" in partial).toBe(false);
    const walk = (v) => {
      if (v && typeof v === "object") Object.values(v).forEach(walk);
      expect(v).not.toBeUndefined();
    };
    walk(partial);
  });
});

describe("contexte entreprise dynamique", () => {
  it("les builders acceptent un contexte custom injecté à la place du statique", async () => {
    const { buildSwotPestelPrompt, buildOpportunitiesPrompt } = await import("../domain/enrich.js");
    const custom = "CONTEXTE DE TEST DYNAMIQUE";
    expect(buildSwotPestelPrompt([], custom)).toContain(custom);
    expect(buildOpportunitiesPrompt([], custom)).toContain(custom);
  });

  it("parseContextRefreshResponse accepte une mise à jour valide et retourne text+changes", async () => {
    const { parseContextRefreshResponse, COMPANY_CONTEXT } = await import("../domain/enrich.js");
    const updated = COMPANY_CONTEXT.replace("OBJECTIF COMMERCIAL", "OBJECTIF COMMERCIAL (révisé)");
    const parsed = parseContextRefreshResponse({ context: updated, changes: ["révision objectif"] }, COMPANY_CONTEXT);
    expect(parsed).not.toBeNull();
    expect(parsed.text).toContain("HOMONYMIE");
    expect(parsed.changes).toEqual(["révision objectif"]);
  });

  it("rejette une réécriture qui perd les sections critiques ou raccourcit brutalement", async () => {
    const { parseContextRefreshResponse, COMPANY_CONTEXT } = await import("../domain/enrich.js");
    expect(parseContextRefreshResponse({ context: "trop court", changes: [] }, COMPANY_CONTEXT)).toBeNull();
    const sansHomonymie = COMPANY_CONTEXT.replace(/HOMONYMIE/g, "X");
    expect(parseContextRefreshResponse({ context: sansHomonymie, changes: [] }, COMPANY_CONTEXT)).toBeNull();
    expect(parseContextRefreshResponse(null, COMPANY_CONTEXT)).toBeNull();
  });
});
