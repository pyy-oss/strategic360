import { describe, it, expect } from "vitest";
import {
  CLIENT_AO_MONITOR_PREFIX,
  tierRank,
  accountPriority,
  clientMonitorSourceId,
  clientTenderSourceUrl,
  selectMonitoredClients,
  buildClientTenderSource,
  planClientTenderMonitors,
} from "../domain/clientTenderMonitor.js";

describe("clientTenderMonitor — tierRank / accountPriority", () => {
  it("classe stratégique > clé > standard > inconnu", () => {
    expect(tierRank("Stratégique")).toBe(3);
    expect(tierRank("Clé")).toBe(2);
    expect(tierRank("Standard")).toBe(1);
    expect(tierRank("")).toBe(0);
  });
  it("le tier domine le CAS dans la priorité", () => {
    const strategiqueFaible = { tier: "Stratégique", nt360: { casTotal: 1 } };
    const standardEnorme = { tier: "Standard", nt360: { casTotal: 1e12 } };
    expect(accountPriority(strategiqueFaible)).toBeGreaterThan(accountPriority(standardEnorme));
  });
});

describe("clientTenderMonitor — id & url", () => {
  it("id déterministe préfixé, null si vide", () => {
    expect(clientMonitorSourceId("Groupe BSIC")).toBe(CLIENT_AO_MONITOR_PREFIX + "groupe-bsic");
    expect(clientMonitorSourceId("  ")).toBeNull();
  });
  it("url Google News scopée AO, nom entre guillemets", () => {
    const u = clientTenderSourceUrl("SNDI");
    expect(u).toContain("news.google.com/rss/search");
    expect(decodeURIComponent(u)).toContain('"SNDI"');
    expect(decodeURIComponent(u)).toMatch(/appel d'offres/i);
  });
});

describe("clientTenderMonitor — selectMonitoredClients", () => {
  const accounts = [
    { nom: "Client Strat", tier: "Stratégique", nt360: { casTotal: 100 } },
    { nom: "Client Cle", tier: "Clé", nt360: { casTotal: 5000 } },
    { nom: "Client Std", tier: "Standard", nt360: { casTotal: 999999 } },
  ];
  it("auto : prend les meilleurs par valeur (tier d'abord)", () => {
    const sel = selectMonitoredClients(accounts, { auto: true, max: 2 });
    expect(sel.map((s) => s.nom)).toEqual(["Client Strat", "Client Cle"]);
  });
  it("include ajoute des comptes hors top, exclude en retire", () => {
    const sel = selectMonitoredClients(accounts, { auto: true, max: 1, include: ["Client Std"], exclude: ["Client Cle"] });
    const noms = sel.map((s) => s.nom);
    expect(noms).toContain("Client Std");   // inclus explicitement
    expect(noms).toContain("Client Strat"); // top auto
    expect(noms).not.toContain("Client Cle"); // exclu
  });
  it("exclude l'emporte sur include", () => {
    const sel = selectMonitoredClients(accounts, { auto: false, include: ["Client Strat"], exclude: ["Client Strat"] });
    expect(sel).toEqual([]);
  });
  it("déduplique par slug", () => {
    const sel = selectMonitoredClients([{ nom: "SNDI" }, { nom: "s n d i" }, { nom: "SNDI " }], { auto: true, max: 10 });
    expect(sel).toHaveLength(2); // "sndi" et "s-n-d-i" sont deux slugs distincts, mais "SNDI"/"SNDI " fusionnent
  });
});

describe("clientTenderMonitor — planClientTenderMonitors", () => {
  const accounts = [{ nom: "Groupe BSIC", tier: "Stratégique", nt360: { casTotal: 9 } }];
  it("nouvelle source → upsert activé", () => {
    const { upserts, deactivateIds } = planClientTenderMonitors(accounts, { auto: true, max: 5 }, {});
    expect(upserts).toHaveLength(1);
    expect(upserts[0].activate).toBe(true);
    expect(upserts[0].id).toBe(CLIENT_AO_MONITOR_PREFIX + "groupe-bsic");
    expect(upserts[0].axis).toBe("clients_prospects");
    expect(deactivateIds).toEqual([]);
  });
  it("source inchangée → aucun upsert (anti-churn)", () => {
    const src = buildClientTenderSource({ nom: "Groupe BSIC" });
    const existing = { [src.id]: { active: true, url: src.url, name: src.name, consecutiveFailures: 0 } };
    const { upserts } = planClientTenderMonitors(accounts, { auto: true, max: 5 }, existing);
    expect(upserts).toEqual([]);
  });
  it("ne ressuscite pas une source désactivée pour échecs", () => {
    const src = buildClientTenderSource({ nom: "Groupe BSIC" });
    const existing = { [src.id]: { active: false, url: src.url, name: src.name, consecutiveFailures: 7 } };
    const { upserts } = planClientTenderMonitors(accounts, { auto: true, max: 5 }, existing, { failureThreshold: 5 });
    expect(upserts).toEqual([]);
  });
  it("désactive une source dont le client n'est plus sélectionné", () => {
    const existing = { [CLIENT_AO_MONITOR_PREFIX + "ancien-client"]: { active: true, url: "x", name: "y", consecutiveFailures: 0 } };
    const { deactivateIds } = planClientTenderMonitors(accounts, { auto: true, max: 5 }, existing);
    expect(deactivateIds).toEqual([CLIENT_AO_MONITOR_PREFIX + "ancien-client"]);
  });
});
