import { describe, it, expect } from "vitest";
import {
  TENDER_ENRICH_SUBTYPES,
  buildTenderEnrichPrompt,
  parseTenderEnrichResponse,
  mergeBusinessAngle,
  isoDeadline,
  isAoSubtype,
  aoProvenanceRejectReason,
} from "../domain/tenderEnrich.js";

describe("tenderEnrich — prompt", () => {
  it("inclut le titre, le contenu, et la règle anti-invention", () => {
    const p = buildTenderEnrichPrompt("AO Datacenter", "Montant: 300 MFCFA, dépôt le 2026-09-01");
    expect(p).toContain("AO Datacenter");
    expect(p).toContain("300 MFCFA");
    expect(p).toMatch(/n'invente JAMAIS/i);
    expect(p).toContain("budgetIdentified");
  });
  it("tronque un contenu très long", () => {
    const p = buildTenderEnrichPrompt("x", "a".repeat(10000));
    expect(p.length).toBeLessThan(7000);
  });
});

describe("tenderEnrich — parse", () => {
  it("normalise les champs et neutralise les 'null' textuels", () => {
    expect(parseTenderEnrichResponse({ estAmount: "300 MFCFA", deadline: "null", tenderRef: "  AO-2026-12  ", buyer: "", budgetIdentified: true }))
      .toEqual({ estAmount: "300 MFCFA", deadline: null, tenderRef: "AO-2026-12", buyer: null, budgetIdentified: true });
  });
  it("tolère une entrée non-objet", () => {
    expect(parseTenderEnrichResponse(null)).toEqual({ estAmount: null, deadline: null, tenderRef: null, buyer: null, budgetIdentified: false });
  });
});

describe("tenderEnrich — merge (jamais d'écrasement)", () => {
  it("remplit uniquement les champs vides", () => {
    const existing = { estAmount: "déjà là", buyer: "" };
    const extracted = { estAmount: "300 MFCFA", deadline: "2026-09-01", tenderRef: null, buyer: "SNDI" };
    expect(mergeBusinessAngle(existing, extracted)).toEqual({ estAmount: "déjà là", buyer: "SNDI", deadline: "2026-09-01" });
  });
  it("tolère un existant absent", () => {
    expect(mergeBusinessAngle(undefined, { deadline: "2026-01-01" })).toEqual({ deadline: "2026-01-01" });
  });
});

describe("tenderEnrich — isoDeadline", () => {
  it("extrait une date ISO", () => { expect(isoDeadline("Dépôt avant le 2026-09-01 à 12h")).toBe("2026-09-01"); });
  it("convertit jj/mm/aaaa", () => { expect(isoDeadline("échéance 01/09/2026")).toBe("2026-09-01"); });
  it("renvoie null si aucune date", () => { expect(isoDeadline("bientôt")).toBeNull(); expect(isoDeadline(undefined)).toBeNull(); });
});

describe("tenderEnrich — constantes", () => {
  it("couvre les sous-types AO", () => { expect(TENDER_ENRICH_SUBTYPES).toEqual(["tender", "funding", "budget"]); });
});

describe("tenderEnrich — isAoSubtype", () => {
  it("reconnaît les subtypes AO (insensible à la casse)", () => {
    expect(isAoSubtype("tender")).toBe(true);
    expect(isAoSubtype("FUNDING")).toBe(true);
    expect(isAoSubtype("budget")).toBe(true);
  });
  it("ignore les autres subtypes et les valeurs absentes", () => {
    expect(isAoSubtype("trend")).toBe(false);
    expect(isAoSubtype("")).toBe(false);
    expect(isAoSubtype(undefined)).toBe(false);
  });
});

describe("tenderEnrich — porte de provenance AO", () => {
  it("rejette un AO sans URL source", () => {
    const r = aoProvenanceRejectReason({ subtype: "tender", url: "", businessAngle: { tenderRef: "AOOR N°2026-005" } });
    expect(r).toMatch(/sans URL/i);
  });
  it("rejette un AO dont l'URL n'est que des espaces", () => {
    expect(aoProvenanceRejectReason({ subtype: "funding", url: "   " })).toBeTruthy();
  });
  it("laisse passer un AO avec URL source", () => {
    expect(aoProvenanceRejectReason({ subtype: "tender", url: "https://boad.org/avis/123" })).toBeNull();
  });
  it("n'affecte PAS les signaux non-AO (même sans URL)", () => {
    expect(aoProvenanceRejectReason({ subtype: "trend", url: "" })).toBeNull();
    expect(aoProvenanceRejectReason({ subtype: "vulnerability" })).toBeNull();
  });
  it("tolère une entrée non-objet", () => {
    expect(aoProvenanceRejectReason(null)).toBeNull();
  });
});
