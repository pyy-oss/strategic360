import { describe, expect, it } from "vitest";
import { computePipelineInfluenced, normalizeEntityName, computeValueAtStake } from "../domain/quanti.js";

describe("normalizeEntityName", () => {
  it("uppercases, strips accents and punctuation", () => {
    expect(normalizeEntityName("Orange-CI (Télécoms)")).toBe("ORANGE CI TELECOMS");
    expect(normalizeEntityName(null)).toBe("");
  });
});

describe("computePipelineInfluenced", () => {
  const vas = [
    { client: "ORANGE CI SA", impact: 100 },
    { client: "BRVM", impact: 50 },
    { client: "SONAPIE", impact: 7 },
    { client: null, impact: 999 },
  ];

  it("sums impact of rows whose client token-matches a veille entity, either direction", () => {
    expect(computePipelineInfluenced({ valueAtStake: vas, entities: ["Orange CI", "BRVM Bourse"] })).toBe(150);
  });

  it("does not substring-match partial tokens (BAD ≠ SINBAD)", () => {
    expect(computePipelineInfluenced({ valueAtStake: [{ client: "SINBAD", impact: 10 }], entities: ["BAD"] })).toBe(0);
  });

  it("returns null with no value-at-stake data, 0 with data but no entities", () => {
    expect(computePipelineInfluenced({ valueAtStake: [], entities: ["X"] })).toBeNull();
    expect(computePipelineInfluenced({ valueAtStake: vas, entities: [] })).toBe(0);
  });

  it("consumes computeValueAtStake output directly (client kept as its own field)", () => {
    const rows = computeValueAtStake({ opportunities: [{ client: "BCEAO", montant: 40, etape: "Proposition", idc: "x1" }] });
    expect(rows[0].client).toBe("BCEAO");
    expect(computePipelineInfluenced({ valueAtStake: rows, entities: ["BCEAO"] })).toBe(40);
  });
});
