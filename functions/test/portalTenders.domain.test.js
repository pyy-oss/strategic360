"use strict";

/** Tests de l'extracteur d'AO portail (BOAD/BCEAO) — sur des liens réels capturés (sourceDiag 2026-07-19). PUR. */

import { describe, it, expect } from "vitest";
import { deSlug, refFromSlug, extractPortalTenders } from "../domain/portalTenders.js";

describe("portalTenders — deSlug / refFromSlug", () => {
  it("déslugifie en titre lisible", () => {
    expect(deSlug("aaon-029-2026-menuiserie-aluminium-double-vitrage-boad")).toContain("Menuiserie Aluminium");
    expect(deSlug("")).toBe("");
  });
  it("extrait la référence de dossier du slug quand présente", () => {
    expect(refFromSlug("aaon-029-2026-menuiserie-aluminium")).toBe("AAON-029-2026");
    expect(refFromSlug("aoon-012-2026-refection-voirie-siege-boad")).toBe("AOON-012-2026");
    expect(refFromSlug("equipements-laboratoire-realite-virtuelle-universite")).toBeNull();
  });
});

describe("portalTenders — extractPortalTenders (BOAD, DOM réel)", () => {
  const boadHtml = `
    <a href="/fr/opportunites/appels-doffre/">Appels d'offres</a>
    <a href="/fr/opportunites/appels-doffre/aaon-029-2026-menuiserie-aluminium-double-vitrage-boad/">AAON 029</a>
    <a href="/fr/opportunites/appels-doffre/equipements-laboratoire-realite-virtuelle-universite-virtuelle-burkina-faso/">VR</a>
    <a href="/fr/opportunites/appels-doffre/aoon-012-2026-refection-voirie-siege-boad/">Voirie</a>
    <a href="/en/opportunities/calls-for-tender/">EN</a>
    <a href="/fr/contacts/">Contacts</a>
    <a href="https://twitter.com/boad">Twitter</a>`;
  const items = extractPortalTenders(boadHtml, {
    baseUrl: "https://www.boad.org/fr/opportunites/appels-doffre/",
    detailPrefix: "/fr/opportunites/appels-doffre/",
    excludePaths: ["/fr/opportunites/appels-doffre/"],
    max: 15,
  });

  it("capte 3 avis (liens de détail), pas la page liste ni les liens hors sujet", () => {
    expect(items.length).toBe(3);
    expect(items.every((i) => i.url.startsWith("https://www.boad.org/fr/opportunites/appels-doffre/"))).toBe(true);
  });
  it("chaque avis a une URL propre + un titre + (si dispo) une référence", () => {
    const ref = items.find((i) => i.ref === "AAON-029-2026");
    expect(ref).toBeTruthy();
    expect(ref.title).toMatch(/Menuiserie/i);
    const vr = items.find((i) => /Realite Virtuelle/i.test(i.title));
    expect(vr).toBeTruthy();
    expect(vr.ref).toBeNull(); // pas de réf dans le slug → null (pas inventée)
  });
  it("ignore les liens sortants et la page EN", () => {
    expect(items.some((i) => i.url.includes("twitter"))).toBe(false);
    expect(items.some((i) => i.url.includes("/en/"))).toBe(false);
  });
});

describe("portalTenders — extractPortalTenders (BCEAO)", () => {
  const bceaoHtml = `
    <a href="/fr/appels-offres/appels-offres-marches-publics-achats">Liste</a>
    <a href="/fr/appels-offres/appel-candidatures-pour-la-49e-promotion-du-cycle-diplomant-du-cofeb">COFEB</a>
    <a href="/fr/content/presentation-de-lumoa">Hors sujet</a>`;
  it("capte l'avis de détail, exclut la page liste configurée", () => {
    const items = extractPortalTenders(bceaoHtml, {
      baseUrl: "https://www.bceao.int/fr/appels-offres/appels-offres-marches-publics-achats",
      detailPrefix: "/fr/appels-offres/",
      excludePaths: ["/fr/appels-offres/appels-offres-marches-publics-achats"],
    });
    expect(items.length).toBe(1);
    expect(items[0].url).toContain("appel-candidatures-pour-la-49e-promotion");
  });
});

describe("portalTenders — robustesse", () => {
  it("entrée vide / options manquantes → []", () => {
    expect(extractPortalTenders("", { baseUrl: "https://x.org", detailPrefix: "/a/" })).toEqual([]);
    expect(extractPortalTenders("<a href=/a/b>x</a>", {})).toEqual([]);
  });
  it("respecte le plafond max", () => {
    const many = Array.from({ length: 30 }, (_, i) => `<a href="/ao/dossier-${i}/">x</a>`).join("");
    const r = extractPortalTenders(many, { baseUrl: "https://p.org/ao/", detailPrefix: "/ao/", max: 10 });
    expect(r.length).toBe(10);
  });
});
