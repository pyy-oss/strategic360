"use strict";

/** Pure-function tests for functions/domain/dedupe.js (dédoublonnage intelligent — Vague C). */

import { describe, it, expect } from "vitest";
import { normalizeTitle, titleSimilarity, isNearDuplicate, discriminantKey, blocksMerge, dedupeByTitle, clusterNearDuplicates } from "../domain/dedupe.js";

describe("dedupe — discriminant fort (M3, audit intégral)", () => {
  it("discriminantKey lit la référence d'AO / l'acheteur / l'entité", () => {
    expect(discriminantKey({ tenderRef: "AO-2026-042" })).toBe("ao 2026 042");
    expect(discriminantKey({ businessAngle: { buyer: "Ministère de la Santé" } })).toBe("ministere de la sante");
    expect(discriminantKey({ ent: "ARTCI" })).toBe("artci");
    expect(discriminantKey({ title: "x" })).toBe("");
  });

  it("blocksMerge : deux discriminants forts divergents interdisent la fusion", () => {
    expect(blocksMerge({ tenderRef: "AO-1" }, { tenderRef: "AO-2" })).toBe(true);
    expect(blocksMerge({ tenderRef: "AO-1" }, { tenderRef: "AO-1" })).toBe(false);
    expect(blocksMerge({ tenderRef: "AO-1" }, { title: "sans disc" })).toBe(false); // l'un sans disc → pas de blocage
  });

  it("clusterNearDuplicates NE fusionne PAS deux AO distincts à titre générique", () => {
    const items = [
      { id: "a1", title: "Avis d'appel d'offres fourniture de matériel informatique", axis: "clients_prospects", tenderRef: "AO-2026-01", businessAngle: { buyer: "Ministère A" } },
      { id: "a2", title: "Avis d'appel d'offres fourniture de matériel informatique", axis: "clients_prospects", tenderRef: "AO-2026-99", businessAngle: { buyer: "Ministère B" } },
    ];
    expect(clusterNearDuplicates(items)).toEqual([]); // discriminants différents → pas de fusion
  });

  it("clusterNearDuplicates fusionne le MÊME AO vu deux fois (même référence)", () => {
    const items = [
      { id: "b1", title: "Appel d'offres réhabilitation réseau électrique Abidjan", axis: "marche", tenderRef: "AO-7" },
      { id: "b2", title: "Appel d'offres réhabilitation du réseau électrique à Abidjan", axis: "marche", tenderRef: "AO-7" },
    ];
    const clusters = clusterNearDuplicates(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((x) => x.id).sort()).toEqual(["b1", "b2"]);
  });
});

describe("dedupe — similarité de titres", () => {
  it("normalizeTitle : minuscule, sans accents, ponctuation → espaces", () => {
    expect(normalizeTitle("L'ARTCI publie un AVIS d'appel d'offres !")).toBe("l artci publie un avis d appel d offres");
  });

  it("titleSimilarity : proche de 1 pour deux formulations de la même actu, faible pour deux sujets distincts", () => {
    const a = "La BRVM lance un appel d'offres pour la refonte de son système d'information";
    const b = "Appel d'offres BRVM : refonte du système d'information";
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.6);
    const c = "Fortinet augmente ses tarifs de 8%";
    expect(titleSimilarity(a, c)).toBeLessThan(0.2);
  });

  it("isNearDuplicate : seuil paramétrable, titres vides → non-doublon", () => {
    expect(isNearDuplicate("EOL du switch Cisco Catalyst 3650", "Cisco Catalyst 3650 : fin de vie annoncée")).toBe(true);
    expect(isNearDuplicate("", "quoi que ce soit")).toBe(false);
  });

  it("dedupeByTitle : garde le premier de chaque grappe, préserve l'ordre, accepte objets et chaînes", () => {
    const items = [
      { title: "La BRVM lance un appel d'offres refonte SI" },
      { title: "Appel d'offres BRVM refonte du SI" }, // quasi-doublon → écarté
      { title: "Fortinet augmente ses tarifs" }, // distinct → gardé
    ];
    const out = dedupeByTitle(items);
    expect(out).toHaveLength(2);
    expect(out[0].title).toContain("BRVM lance");
    expect(out[1].title).toContain("Fortinet");
    // chaînes nues + entrée vide tolérée (titres partageant ≥2 jetons significatifs)
    expect(dedupeByTitle([
      "Nouvelle banque digitale lancée à Abidjan",
      "Lancement d'une nouvelle banque digitale à Abidjan",
      "Sujet totalement différent présenté ailleurs",
    ]).length).toBe(2);
    expect(dedupeByTitle([])).toEqual([]);
  });

  it("clusterNearDuplicates : regroupe les doublons même axe ET les doublons trans-axes à fort recouvrement", () => {
    const items = [
      { id: "a1", title: "La BRVM lance un appel d'offres refonte SI", axis: "clients_prospects" },
      { id: "a2", title: "Appel d'offres BRVM refonte du SI", axis: "clients_prospects" }, // doublon de a1 (même axe)
      { id: "b1", title: "Fortinet augmente ses tarifs de 8%", axis: "tech" },              // singleton → écarté
      { id: "a3", title: "BRVM refonte SI appel d'offres publié", axis: "tech" },           // MÊME événement, autre axe → fusionné (fort recouvrement, audit 2026-07)
    ];
    const clusters = clusterNearDuplicates(items);
    // Une seule grappe (a1+a2+a3, même événement classé sur 2 axes) ; b1 reste seul.
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((x) => x.id).sort()).toEqual(["a1", "a2", "a3"]);
    // Liste vide / sans doublon → aucune grappe.
    expect(clusterNearDuplicates([])).toEqual([]);
    expect(clusterNearDuplicates([{ id: "x", title: "Sujet unique", axis: "tech" }])).toEqual([]);
  });

  it("clusterNearDuplicates : deux AO PUREMENT génériques (jetons d'AO seuls) ne fusionnent pas trans-axes (audit 2026-07)", () => {
    const items = [
      { id: "g1", title: "Fourniture de matériel informatique", axis: "clients_prospects" },
      { id: "g2", title: "Acquisition de matériel informatique", axis: "tech" },
    ];
    // Seuls des jetons génériques d'AO sont partagés → pas de discriminant fort → aucune fusion.
    expect(clusterNearDuplicates(items)).toEqual([]);
  });
  it("isStrongDuplicate : un simple mot commun trans-axes ne suffit PAS à fusionner (≥3 jetons + 0.75)", () => {
    const items = [
      { id: "c1", title: "Cisco lance une nouvelle gamme de switches", axis: "tech" },
      { id: "c2", title: "Cisco remporte un contrat à la SGBCI", axis: "concurrents" },
    ];
    // Seul « cisco » est partagé → recouvrement faible → pas de fusion trans-axes.
    expect(clusterNearDuplicates(items)).toEqual([]);
  });
});
