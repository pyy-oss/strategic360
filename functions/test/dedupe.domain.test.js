"use strict";

/** Pure-function tests for functions/domain/dedupe.js (dédoublonnage intelligent — Vague C). */

import { describe, it, expect } from "vitest";
import { normalizeTitle, titleSimilarity, isNearDuplicate, dedupeByTitle } from "../domain/dedupe.js";

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
});
