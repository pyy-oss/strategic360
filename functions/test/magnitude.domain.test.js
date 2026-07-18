import { describe, it, expect } from "vitest";
import { labelForPct, appreciateAmount, clientScaleNote, buildMagnitudeGuide } from "../domain/magnitude.js";

describe("magnitude — labelForPct", () => {
  it("borne les labels par seuils de % du CA", () => {
    expect(labelForPct(0.1)).toBe("dérisoire");
    expect(labelForPct(5)).toBe("modeste");
    expect(labelForPct(20)).toBe("significatif");
    expect(labelForPct(60)).toBe("majeur");
    expect(labelForPct(150)).toBe("transformationnel");
  });
  it("null si non exploitable", () => {
    expect(labelForPct(NaN)).toBeNull();
    expect(labelForPct(-1)).toBeNull();
  });
});

describe("magnitude — appreciateAmount (l'exemple 3 M vs milliards)", () => {
  it("un montant faible face à un gros CA compte → dérisoire", () => {
    const a = appreciateAmount(3_000_000, { accountCas: 5_000_000_000, portfolioMedian: 40_000_000 });
    expect(a.label).toBe("dérisoire");
    expect(a.pctOfCas).toBeCloseTo(0.1, 1);
    expect(a.phrase).toMatch(/dérisoire/);
  });
  it("un montant du même ordre que le CA → transformationnel", () => {
    const a = appreciateAmount(6_000_000, { accountCas: 5_000_000 });
    expect(a.label).toBe("transformationnel");
  });
  it("sans CA compte → pas de label, phrase honnête", () => {
    const a = appreciateAmount(3_000_000, {});
    expect(a.label).toBeNull();
    expect(a.phrase).toMatch(/inconnue/i);
  });
  it("montant nul/invalide → null", () => {
    expect(appreciateAmount(0, { accountCas: 100 })).toBeNull();
    expect(appreciateAmount("x", { accountCas: 100 })).toBeNull();
  });
});

describe("magnitude — clientScaleNote", () => {
  it("grand compte (télécom / stratégique) → marge pour viser plus haut", () => {
    expect(clientScaleNote("Télécom", "")).toMatch(/viser plus haut/i);
    expect(clientScaleNote("", "Stratégique")).toMatch(/viser plus haut/i);
  });
  it("compte intermédiaire → calibrer", () => {
    expect(clientScaleNote("Commerce", "Standard")).toMatch(/calibrer/i);
  });
});

describe("magnitude — buildMagnitudeGuide", () => {
  it("apprécie tous les montants clés + note d'échelle", () => {
    const g = buildMagnitudeGuide({
      compte: "MTN CI", secteur: "Télécom", tier: "Stratégique",
      casTotal: 5_000_000_000, portfolioMedian: 40_000_000,
      recommendation: { offre: "Cloud souverain", montantEstime: 120_000_000 },
      whitespacePotential: 300_000_000,
      deals: [{ nom: "Datacenter", montant: 3_000_000 }],
      signauxCompte: [{ titre: "AO cybersécurité", estAmount: "80 000 000" }],
    });
    expect(g.echelleCompte.casTotal).toBe(5_000_000_000);
    expect(g.echelleCompte.note).toMatch(/viser plus haut/i);
    const deal = g.montants.find((m) => /Datacenter/.test(m.libelle));
    expect(deal.label).toBe("dérisoire"); // 3M vs 5 Md
    const ao = g.montants.find((m) => /cybersécurité/.test(m.libelle));
    expect(ao.montant).toBe(80_000_000);
  });
  it("robuste à un compte pauvre (aucun montant)", () => {
    const g = buildMagnitudeGuide({ compte: "X" });
    expect(g.montants).toEqual([]);
    expect(g.echelleCompte.note).toBeTruthy();
  });
});
