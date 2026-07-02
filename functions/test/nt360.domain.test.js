import { describe, expect, it } from "vitest";
import {
  STAGE_TO_ETAPE,
  mapOrders,
  mapOpportunities,
  mapInvoices,
  mapBcLinesToSupplierRows,
  pickObjectives,
  pickCurrentFy,
} from "../domain/nt360.js";
import { computeBcg, computeCasSummary, computePipeline, computePorterForces } from "../domain/quanti.js";

const FY = 2026;

describe("mapOrders", () => {
  it("routes cas into cas (N) or casN1 (N-1) by yearPo, other years contribute to neither", () => {
    const rows = mapOrders(
      [
        { bu: "ICT", am: "AM1", cas: 100, mb: 10, yearPo: 2026 },
        { bu: "ICT", am: "AM1", cas: 80, mb: 8, yearPo: 2025 },
        { bu: "ICT", am: "AM1", cas: 999, mb: 99, yearPo: 2019 },
      ],
      FY
    );
    expect(rows[0]).toMatchObject({ bu: "ICT", cas: 100, casN1: 0, mb: 10 });
    expect(rows[1]).toMatchObject({ cas: 0, casN1: 80, mb: 0 }); // mb only counted for current FY
    expect(rows[2]).toMatchObject({ cas: 0, casN1: 0, mb: 0 });
  });

  it("feeds computeBcg/computeCasSummary with correct N/N-1 growth", () => {
    const rows = mapOrders(
      [
        { bu: "ICT", cas: 150, mb: 20, yearPo: 2026 },
        { bu: "ICT", cas: 100, mb: 15, yearPo: 2025 },
      ],
      FY
    );
    const { casTotal, casN1Total } = computeCasSummary({ orders: rows });
    expect(casTotal).toBe(150);
    expect(casN1Total).toBe(100);
    const bcg = computeBcg({ orders: rows });
    expect(bcg).toHaveLength(1);
    expect(bcg[0].croissance).toBeCloseTo(0.5); // (150-100)/100
    expect(bcg[0].marge).toBe(20);
  });

  it("tolerates junk input", () => {
    expect(mapOrders(undefined, FY)).toEqual([]);
    expect(mapOrders([null, "x", {}], FY)).toHaveLength(1); // only the {} survives the object filter
  });
});

describe("mapOpportunities", () => {
  it("maps stage 6/7 exactly to Gagné/Perdu (win rate 6 vs 7) and amount to montant", () => {
    const opps = mapOpportunities([
      { client: "SONAPIE", amount: 100, stage: 6, oppId: "a" },
      { client: "BRVM", amount: 50, stage: 7, oppId: "b" },
      { client: "ORANGE", amount: 200, stage: 2, oppId: "c", closingDate: "2026-09-30", marginPct: 0.2 },
    ]);
    expect(opps[0].etape).toBe("Gagné");
    expect(opps[1].etape).toBe("Perdu");
    expect(opps[2]).toMatchObject({ etape: "Proposition", montant: 200, idc: "c", datePrev: "2026-09-30", mbPct: 0.2 });
    const { winRate } = computePipeline({ opportunities: opps });
    expect(winRate).toBe(0.5); // 1 won / 2 closed
  });

  it("falls back to the stageLabel's leading digit, unknown stages stay undefined", () => {
    const opps = mapOpportunities([
      { client: "X", amount: 10, stageLabel: "3-Négociation" },
      { client: "Y", amount: 10, stage: 42 },
    ]);
    expect(opps[0].etape).toBe(STAGE_TO_ETAPE[3]);
    expect(opps[1].etape).toBeUndefined(); // computePipeline applies its 0.3 default
  });
});

describe("mapInvoices", () => {
  it("keeps dateCommande null (absent from nt360) so the delay KRI stays honestly null", () => {
    const invoices = mapInvoices([{ amountHt: 1000, date: "2021-03-15" }]);
    expect(invoices[0]).toEqual({ dateCommande: null, dateFacturation: "2021-03-15", montant: 1000 });
  });
});

describe("mapBcLinesToSupplierRows", () => {
  it("builds fournisseur/cas pseudo-rows for Porter and drops supplier-less lines", () => {
    const rows = mapBcLinesToSupplierRows([
      { supplier: "WESTCON", amountXof: 1000 },
      { supplier: "", amountXof: 5 },
      { amountXof: 5 },
    ]);
    expect(rows).toEqual([{ fournisseur: "WESTCON", cas: 1000 }]);
    const { pouvoirFournisseurs } = computePorterForces({ orders: rows });
    expect(pouvoirFournisseurs).toBe(100);
  });
});

describe("pickObjectives / pickCurrentFy", () => {
  it("prefers the global objectives doc for the current fiscal year", () => {
    const obj = pickObjectives(
      [
        { fiscalYear: 2025, scope: "global", targetCas: 1 },
        { fiscalYear: 2026, scope: "bu", targetCas: 2 },
        { fiscalYear: 2026, scope: "global", targetCas: 12000000000, targetInvoiced: 10000000000, targetMargin: 2000000000 },
      ],
      2026
    );
    expect(obj).toMatchObject({ fiscalYear: 2026, targetCas: 12000000000 });
  });

  it("returns null when there are no objectives at all", () => {
    expect(pickObjectives([], 2026)).toBeNull();
    expect(pickObjectives(undefined, 2026)).toBeNull();
  });

  it("reads currentFy from whichever config doc carries it, with fallback", () => {
    expect(pickCurrentFy([{ matrix: {} }, { currentFy: 2026 }], 2030)).toBe(2026);
    expect(pickCurrentFy([], 2030)).toBe(2030);
  });
});

describe("computeGranularite (via mapOrders)", () => {
  it("decomposes growth by BU in raw XOF, sorted by delta descending, negatives allowed", async () => {
    const { computeGranularite } = await import("../domain/quanti.js");
    const rows = mapOrders(
      [
        { bu: "ICT", cas: 150, yearPo: 2026 },
        { bu: "ICT", cas: 100, yearPo: 2025 },
        { bu: "FORMATION", cas: 20, yearPo: 2026 },
        { bu: "FORMATION", cas: 60, yearPo: 2025 },
      ],
      2026
    );
    const gran = computeGranularite({ orders: rows });
    expect(gran).toEqual([
      { seg: "ICT", casN: 150, casN1: 100, delta: 50 },
      { seg: "FORMATION", casN: 20, casN1: 60, delta: -40 },
    ]);
    expect(computeGranularite({ orders: [] })).toEqual([]);
  });
});
