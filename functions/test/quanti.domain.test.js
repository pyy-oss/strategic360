"use strict";

/**
 * Pure-function tests for functions/domain/quanti.js (BUILD_KIT.md §8.3 / DELTA_01 §5.3-5.4).
 * No emulator dependency (unlike test/firestore.rules.test.js) — these are plain JS functions
 * exercised with hand-built fixtures, since no real P&L/LIVE/Facturation/fiche workbook exists
 * in this sandbox (see functions/parsers/*.js header comments).
 *
 * Run: npx vitest run test/quanti.domain.test.js
 */

import { describe, it, expect } from "vitest";
import {
  computePorterForces,
  computeBcg,
  computeCasSummary,
  computePipeline,
  computeKris,
  computeValueAtStake,
  topNConcentration,
  bcgQuadrant,
} from "../domain/quanti.js";

describe("topNConcentration / Porter", () => {
  it("computes Top-3 concentration on a hand-verifiable 5-supplier example", () => {
    // Suppliers: A=500, B=300, C=100, D=60, E=40 → total=1000. Top-3 = A+B+C = 900 → 90%.
    const orders = [
      { fournisseur: "A", cas: 500 },
      { fournisseur: "B", cas: 300 },
      { fournisseur: "C", cas: 100 },
      { fournisseur: "D", cas: 60 },
      { fournisseur: "E", cas: 40 },
    ];
    expect(topNConcentration(orders, "fournisseur", "cas", 3)).toBe(90);
  });

  it("aggregates multiple rows for the same supplier before ranking", () => {
    // A: 200+200=400, B: 300, C: 300 → total=1000, Top-3 = all of them = 100%.
    const orders = [
      { fournisseur: "A", cas: 200 },
      { fournisseur: "A", cas: 200 },
      { fournisseur: "B", cas: 300 },
      { fournisseur: "C", cas: 300 },
    ];
    expect(topNConcentration(orders, "fournisseur", "cas", 3)).toBe(100);
  });

  it("returns null for empty/missing input", () => {
    expect(topNConcentration([], "fournisseur", "cas", 3)).toBeNull();
    expect(topNConcentration(undefined, "fournisseur", "cas", 3)).toBeNull();
  });

  it("computePorterForces: pouvoirFournisseurs from orders, pouvoirClients from opportunities", () => {
    const orders = [
      { fournisseur: "A", cas: 500 },
      { fournisseur: "B", cas: 300 },
      { fournisseur: "C", cas: 100 },
      { fournisseur: "D", cas: 60 },
      { fournisseur: "E", cas: 40 },
    ];
    // 5 clients, equal montant → Top-5 concentration = 100%.
    const opportunities = [
      { client: "X1", montant: 100 },
      { client: "X2", montant: 100 },
      { client: "X3", montant: 100 },
      { client: "X4", montant: 100 },
      { client: "X5", montant: 100 },
    ];
    const result = computePorterForces({ orders, opportunities });
    expect(result.pouvoirFournisseurs).toBe(90);
    expect(result.pouvoirClients).toBe(100);
  });

  it("computePorterForces: null fields when a source is entirely missing", () => {
    const result = computePorterForces({});
    expect(result.pouvoirFournisseurs).toBeNull();
    expect(result.pouvoirClients).toBeNull();
  });
});

describe("bcgQuadrant / computeBcg", () => {
  it("labels quadrants per the maquette's QCOL thresholds (part/croissance >= 0.5)", () => {
    expect(bcgQuadrant(0.6, 0.6)).toBe("Vedette");
    expect(bcgQuadrant(0.6, 0.4)).toBe("Vache à lait");
    expect(bcgQuadrant(0.4, 0.6)).toBe("Dilemme");
    expect(bcgQuadrant(0.4, 0.4)).toBe("Poids mort");
    // Boundary: exactly 0.5 counts as ">=".
    expect(bcgQuadrant(0.5, 0.5)).toBe("Vedette");
  });

  it("computes part/croissance/marge per BU and labels the quadrant", () => {
    const orders = [
      // BU "Cyber": CAS_N=800, CAS_N1=400 → croissance=1.0 (clamped), mb=150
      { bu: "Cyber", fournisseur: "F1", cas: 500, casN1: 200, mb: 100 },
      { bu: "Cyber", fournisseur: "F2", cas: 300, casN1: 200, mb: 50 },
      // BU "ICT": CAS_N=1000 (the max, so part=1.0), CAS_N1=900 → croissance=0.111, mb=200
      { bu: "ICT", fournisseur: "F3", cas: 1000, casN1: 900, mb: 200 },
    ];
    const bcg = computeBcg({ orders });
    const cyber = bcg.find((b) => b.n === "Cyber");
    const ict = bcg.find((b) => b.n === "ICT");

    expect(cyber.marge).toBe(150);
    expect(cyber.part).toBeCloseTo(800 / 1000, 5); // relative to max BU CAS (ICT=1000)
    expect(cyber.croissance).toBeCloseTo((800 - 400) / 400, 5); // 1.0, clamped at 1 anyway
    expect(cyber.q).toBe("Vedette"); // part=0.8>=0.5, croissance=1.0>=0.5

    expect(ict.part).toBe(1); // is the max BU itself
    expect(ict.croissance).toBeCloseTo((1000 - 900) / 900, 5); // ~0.111
    expect(ict.q).toBe("Vache à lait"); // part>=0.5, croissance<0.5
  });

  it("returns [] for empty orders", () => {
    expect(computeBcg({ orders: [] })).toEqual([]);
    expect(computeBcg({})).toEqual([]);
  });

  it("treats a BU with no N-1 baseline (casN1<=0) as flat growth, not NaN/dropped", () => {
    const orders = [{ bu: "New", fournisseur: "F1", cas: 100, casN1: 0, mb: 10 }];
    const bcg = computeBcg({ orders });
    expect(bcg).toHaveLength(1);
    expect(bcg[0].croissance).toBe(0);
    expect(Number.isNaN(bcg[0].croissance)).toBe(false);
  });
});

describe("computePipeline", () => {
  it("weighted pipeline = OPEN deals only; won CA exposed separately via realise", () => {
    const opportunities = [
      { client: "A", montant: 1000, etape: "Qualification" }, // ×0.2 = 200
      { client: "B", montant: 500, etape: "Proposition" }, // ×0.4 = 200
      { client: "C", montant: 800, etape: "Négociation" }, // ×0.6 = 480
      { client: "D", montant: 300, etape: "Gagné" }, // fermé → réalisé, hors pondéré
      { client: "E", montant: 400, etape: "Perdu" }, // fermé → exclu
    ];
    // Pondéré (ouvertes) = 200+200+480 = 880 ; réalisé (Gagné) = 300.
    const { pipelinePondere, realise, winRate } = computePipeline({ opportunities });
    expect(pipelinePondere).toBe(880);
    expect(realise).toBe(300);
    // 1 Gagné out of 2 closed (Gagné+Perdu) = 0.5
    expect(winRate).toBe(0.5);
  });

  it("returns null winRate when there are no closed deals", () => {
    const opportunities = [{ client: "A", montant: 100, etape: "Qualification" }];
    const { winRate } = computePipeline({ opportunities });
    expect(winRate).toBeNull();
  });

  it("un pipeline 100% gagné a un pondéré nul (réalisé, pas prévision) et expose le réalisé", () => {
    const { pipelinePondere, realise } = computePipeline({
      opportunities: [
        { client: "A", montant: 1000, etape: "Gagné" },
        { client: "B", montant: 500, etape: "Gagné" },
      ],
    });
    expect(pipelinePondere).toBe(0); // rien d'ouvert → prévision nulle
    expect(realise).toBe(1500);
  });

  it("returns nulls for empty input", () => {
    const result = computePipeline({ opportunities: [] });
    expect(result.pipelinePondere).toBeNull();
    expect(result.winRate).toBeNull();
  });
});

describe("computeKris", () => {
  it("derives conversion/saturation/délai KRIs and marks part-récurrent as an explicit caveat", () => {
    const orders = [
      { fournisseur: "A", cas: 500 },
      { fournisseur: "B", cas: 300 },
      { fournisseur: "C", cas: 100 },
      { fournisseur: "D", cas: 60 },
      { fournisseur: "E", cas: 40 },
    ];
    const opportunities = [
      { client: "A", montant: 100, etape: "Gagné" },
      { client: "B", montant: 100, etape: "Perdu" },
    ];
    const invoices = [
      { dateCommande: "2026-01-01", dateFacturation: "2026-01-31", montant: 100 }, // 30 days
      { dateCommande: "2026-02-01", dateFacturation: "2026-03-03", montant: 100 }, // 30 days
    ];
    const kris = computeKris({ orders, opportunities, invoices });
    const byName = Object.fromEntries(kris.map((k) => [k.n, k]));

    expect(byName["Taux de conversion"].val).toBe(50); // 1/2 → 50%
    expect(byName["Saturation lignes fournisseurs"].val).toBe(90); // same Top-3 as Porter test
    expect(byName["Délai commande→facturation"].val).toBe(30);
    expect(byName["Part de récurrent"].val).toBeNull();
    expect(byName["Part de récurrent"].caveat).toMatch(/récurrent\/projet manquant/);
  });
});

describe("computeValueAtStake", () => {
  it("derives p×impact rows from OPEN opportunities only, sorted by |ev| desc", () => {
    const opportunities = [
      { client: "A", idc: "OP1", montant: 1000, etape: "Négociation" }, // p=0.6 → ev=600
      { client: "B", idc: "OP2", montant: 2000, etape: "Qualification" }, // p=0.2 → ev=400
      { client: "C", idc: "OP3", montant: 500, etape: "Gagné" }, // excluded (closed)
      { client: "D", idc: "OP4", montant: 900, etape: "Perdu" }, // excluded (closed)
    ];
    const vas = computeValueAtStake({ opportunities });
    expect(vas).toHaveLength(2);
    expect(vas[0].impact).toBe(1000); // highest |ev| (600) first
    expect(vas[0].p).toBe(0.6);
    expect(vas[0].type).toBe("opp");
    expect(vas[1].impact).toBe(2000);
    expect(vas[1].p).toBe(0.2);
  });

  it("returns [] for empty/missing opportunities", () => {
    expect(computeValueAtStake({})).toEqual([]);
    expect(computeValueAtStake({ opportunities: [] })).toEqual([]);
  });
});

describe("computeCasSummary", () => {
  it("sums cas/casN1 across all orders, ignoring BU/fournisseur grouping", () => {
    // Same fixture spirit as the BCG per-BU test, but computeCasSummary is portfolio-wide.
    const orders = [
      { bu: "Cyber", fournisseur: "F1", cas: 500, casN1: 200, mb: 100 },
      { bu: "Cyber", fournisseur: "F2", cas: 300, casN1: 200, mb: 50 },
      { bu: "ICT", fournisseur: "F3", cas: 1200, casN1: 1000, mb: 200 },
    ];
    expect(computeCasSummary({ orders })).toEqual({ casTotal: 2000, casN1Total: 1400 });
  });

  it("tolerates rows with missing/non-numeric cas or casN1 (contributes 0, doesn't zero the total)", () => {
    const orders = [
      { fournisseur: "A", cas: 500, casN1: 300 },
      { fournisseur: "B", cas: "n/a", casN1: undefined },
      { fournisseur: "C" }, // no cas/casN1 fields at all
    ];
    expect(computeCasSummary({ orders })).toEqual({ casTotal: 500, casN1Total: 300 });
  });

  it("returns null (not 0) for empty/missing orders — 'no data yet' is not '0 CAS'", () => {
    expect(computeCasSummary({})).toEqual({ casTotal: null, casN1Total: null });
    expect(computeCasSummary({ orders: [] })).toEqual({ casTotal: null, casN1Total: null });
    expect(computeCasSummary(undefined)).toEqual({ casTotal: null, casN1Total: null });
  });
});
