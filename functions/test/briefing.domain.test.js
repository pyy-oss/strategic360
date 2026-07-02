"use strict";

/**
 * Pure-function tests for functions/domain/briefing.js (BUILD_KIT.md §10 generateBriefing / §13
 * V7 "idée directrice + 3 arguments MECE + KPIs → briefings (revue humaine)").
 * No Vertex AI call is made here — `parseBriefingResponse` is exercised with synthetic JSON
 * fixtures standing in for an already-parsed Gemini response.
 *
 * Run: npx vitest run test/briefing.domain.test.js
 */

import { describe, it, expect } from "vitest";
import { buildBriefingPrompt, parseBriefingResponse } from "../domain/briefing.js";

describe("buildBriefingPrompt", () => {
  it("includes the period, KPIs and top items in the prompt", () => {
    const prompt = buildBriefingPrompt({
      period: "semaine du 30/06/2026",
      veilleSummary: { countsByAxis: { partenaires: 3, tech: 2 } },
      veilleExecSummary: { boardKpis: { menacesTotal: 4, opportunites: 6 } },
      topItems: [{ title: "Programme BAD 200M$", stance: "opportunity", impact: "high", priorityScore: 91 }],
    });
    expect(prompt).toContain("semaine du 30/06/2026");
    expect(prompt).toContain("Programme BAD 200M$");
    expect(prompt).toContain("menacesTotal");
    expect(prompt).toContain("JSON");
  });

  it("handles missing summaries/items gracefully", () => {
    const prompt = buildBriefingPrompt({ period: "x", veilleSummary: null, veilleExecSummary: null, topItems: [] });
    expect(prompt).toContain("indisponible");
    expect(prompt).toContain("aucun signal prioritaire");
  });
});

describe("parseBriefingResponse — valid fixture", () => {
  it("maps a well-formed AI JSON response onto the briefings/{id} shape, status forced to 'draft'", () => {
    const raw = {
      governingThought: "Neurones doit basculer son mix vers le récurrent.",
      arguments: [
        { title: "1. La demande est là", body: "Réglementation + financements convergent." },
        { title: "2. Nous pouvons gagner", body: "Expertise cyber, certifications, références." },
        { title: "3. Il faut agir vite", body: "Fenêtre d'action limitée ce trimestre." },
      ],
      topOpportunities: [{ title: "Programme BAD", score: 91 }],
      topThreats: [{ title: "EOL Cisco", score: 78 }],
      narrative: "Le trimestre est porté par une fenêtre d'opportunités réglementaires.",
      recommendations: ["Constituer un consortium.", "Accélérer le SOC managé."],
      status: "published", // AI should NOT be able to set this — must be forced to 'draft'
      reviewedBy: "someone@neurones.ci", // AI should NOT be able to set this either
    };
    const briefing = parseBriefingResponse(raw, { period: "semaine du 30/06/2026", generatedBy: "vertex-ai", kpis: { menacesTotal: 4 } });

    expect(briefing).not.toBeNull();
    expect(briefing.status).toBe("draft");
    expect(briefing.reviewedBy).toBeNull();
    expect(briefing.period).toBe("semaine du 30/06/2026");
    expect(briefing.governingThought).toBe(raw.governingThought);
    expect(briefing.arguments).toHaveLength(3);
    expect(briefing.arguments[0].title).toBe("1. La demande est là");
    expect(briefing.content.topOpportunities).toHaveLength(1);
    expect(briefing.content.topThreats).toHaveLength(1);
    expect(briefing.content.recommendations).toHaveLength(2);
    expect(briefing.kpis).toEqual({ menacesTotal: 4 });
    expect(briefing.generatedBy).toBe("vertex-ai");
  });
});

describe("parseBriefingResponse — missing fields", () => {
  it("coerces/defaults missing arguments/lists, still forces status 'draft' and reviewedBy null", () => {
    const raw = { governingThought: "Idée partielle." }; // no arguments, no topOpportunities/Threats, etc.
    const briefing = parseBriefingResponse(raw, { period: "x" });

    expect(briefing).not.toBeNull();
    expect(briefing.status).toBe("draft");
    expect(briefing.reviewedBy).toBeNull();
    expect(briefing.arguments).toHaveLength(3); // always exactly 3, padded with defaults
    expect(briefing.content.topOpportunities).toEqual([]);
    expect(briefing.content.topThreats).toEqual([]);
    expect(briefing.content.recommendations).toEqual([]);
  });

  it("truncates topOpportunities/topThreats to at most 3 entries", () => {
    const raw = {
      governingThought: "x",
      topOpportunities: [{ title: "a", score: 1 }, { title: "b", score: 2 }, { title: "c", score: 3 }, { title: "d", score: 4 }],
    };
    const briefing = parseBriefingResponse(raw, { period: "x" });
    expect(briefing.content.topOpportunities).toHaveLength(3);
    expect(briefing.status).toBe("draft");
  });
});

describe("parseBriefingResponse — malformed input", () => {
  it("returns null for a non-object response", () => {
    expect(parseBriefingResponse("just a string", { period: "x" })).toBeNull();
    expect(parseBriefingResponse(42, { period: "x" })).toBeNull();
    expect(parseBriefingResponse(null, { period: "x" })).toBeNull();
    expect(parseBriefingResponse(undefined, { period: "x" })).toBeNull();
    expect(parseBriefingResponse([1, 2, 3], { period: "x" })).toBeNull();
  });

  it("defaults a completely empty object rather than throwing, status still 'draft'", () => {
    const briefing = parseBriefingResponse({}, { period: "x" });
    expect(briefing).not.toBeNull();
    expect(briefing.status).toBe("draft");
    expect(briefing.reviewedBy).toBeNull();
    expect(briefing.governingThought).toContain("non disponible");
  });
});
