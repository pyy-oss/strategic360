"use strict";

/** Tests unitaires du juge de pertinence (porte de qualité avant publication). PUR. */

import { describe, it, expect } from "vitest";
import { RELEVANCE_MIN, buildEvaluatePrompt, parseEvaluateResponse, deterministicPublishFloor } from "../domain/evaluate.js";

describe("evaluate — porte de pertinence des signaux de veille", () => {
  it("buildEvaluatePrompt ancre sur NT + le marché, cite les champs du signal et demande un JSON pertinence/publier/raison", () => {
    const p = buildEvaluatePrompt(
      { title: "Faille Fortinet chez une banque à Abidjan", summary: "CVE critique", axis: "tech", subtype: "vulnerability", ent: "SGBCI", geo: "ci" },
      "Neurones Technologies — intégrateur IT/cyber."
    );
    expect(p).toContain("NEURONES TECHNOLOGIES");
    expect(p).toContain("PERTINENCE");
    expect(p).toContain("Faille Fortinet chez une banque à Abidjan");
    expect(p).toContain("SGBCI");
    expect(p).toContain('"pertinence"');
    expect(p).toContain('"publier"');
    expect(p).toContain('"raison"');
    // Contexte entreprise injecté quand fourni.
    expect(p).toContain("intégrateur IT/cyber");
  });

  it("buildEvaluatePrompt surface les champs d'actionnabilité (so-what, action, businessAngle) et demande de fonder le verdict dessus", () => {
    const p = buildEvaluatePrompt(
      {
        title: "AO refonte SI", summary: "x", axis: "clients_prospects", subtype: "tender", ent: "BCEAO", geo: "ci",
        impact: "high", stance: "opportunity", prox: "imminent", dueDate: "2026-08-15",
        soWhat: "fenêtre pour un SOC managé", recommendedAction: "Constituer le dossier avant le 15/08",
        businessAngle: { buyer: "BCEAO", estAmount: "152 M XOF", deadline: "2026-08-15", tenderRef: "AO-2026-07" },
      },
      ""
    );
    expect(p).toContain("ACTIONNABILITÉ");
    expect(p).toContain("fenêtre pour un SOC managé"); // so-what
    expect(p).toContain("Constituer le dossier avant le 15/08"); // action
    expect(p).toContain("2026-08-15"); // échéance
    expect(p).toContain("acheteur : BCEAO"); // businessAngle sérialisé
    expect(p).toContain("152 M XOF");
    expect(p).toContain("AO-2026-07");
    expect(p).toMatch(/GÉNÉRIQUE/); // consigne de pénalisation du générique
    // Recall (2026-07) : un AO IT/télécom/cyber en zone, même petit acheteur, doit être noté haut.
    expect(p).toMatch(/CŒUR DE MÉTIER/);
    expect(p).toMatch(/cellule d'exécution/);
  });

  it("généricisation : sans identité → défaut Neurones ; avec profil client → identité/marché du client", () => {
    // Défaut (aucune identité) = comportement Neurones verbatim.
    const def = buildEvaluatePrompt({ title: "x" }, "");
    expect(def).toContain("NEURONES TECHNOLOGIES CI");
    expect(def).toContain("Côte d'Ivoire, UEMOA et Afrique de l'Ouest");
    expect(def).toContain("POUR NT");
    // Profil client → l'identité et le marché suivent le profil, plus aucune mention « NEURONES ».
    const acme = buildEvaluatePrompt({ title: "x" }, "", { companyName: "Acme Retail", sector: "distributeur omnicanal", geographies: ["France", "Bénélux"] });
    expect(acme).toContain("Acme Retail");
    expect(acme).toContain("distributeur omnicanal");
    expect(acme).toContain("France, Bénélux");
    expect(acme).toContain("POUR Acme Retail");
    expect(acme).not.toContain("NEURONES");
  });

  it("parseEvaluateResponse : borne le score 0-100, garde la raison", () => {
    expect(parseEvaluateResponse({ pertinence: 82, publier: true, raison: "AO imminent" })).toEqual({ pertinence: 82, publier: true, raison: "AO imminent" });
    expect(parseEvaluateResponse({ pertinence: 150, publier: false, raison: "hors sujet" }).pertinence).toBe(100);
    expect(parseEvaluateResponse({ pertinence: -5, publier: false, raison: "x" }).pertinence).toBe(0);
  });

  it("publication COUPLÉE au score : un `publier:true` sous le seuil est requalifié non publié ; `publier:false` respecté", () => {
    // publier:true mais score < seuil → NON publié (la porte mord).
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN - 5, publier: true, raison: "médiocre" }).publier).toBe(false);
    // publier:true et score >= seuil → publié.
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN + 5, publier: true, raison: "ok" }).publier).toBe(true);
    // publier:false explicite → toujours rejeté, même score élevé.
    expect(parseEvaluateResponse({ pertinence: 95, publier: false, raison: "doublon" }).publier).toBe(false);
  });

  it("anti-injection : `publier` absent → déduit du seuil ; score absent → INEXPLOITABLE (null) ; rejet explicite honoré même sans score", () => {
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN + 10, raison: "" }).publier).toBe(true);
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN - 10, raison: "" }).publier).toBe(false);
    // Score absent dans un objet parsé → NULL (auparavant « publie ») : un contenu externe hostile ne
    // peut plus émettre {"publier":true} sans note pour forcer la publication ; l'appelant garde `pending`.
    expect(parseEvaluateResponse({ publier: true, raison: "?" })).toBeNull();
    expect(parseEvaluateResponse({ raison: "?" })).toBeNull();
    // Mais un rejet EXPLICITE reste honoré même sans score (on n'a pas besoin de note pour écarter).
    expect(parseEvaluateResponse({ publier: false, raison: "spam" })).toEqual({ pertinence: null, publier: false, raison: "spam" });
    // réponse non-objet → null (l'appelant applique son fail-closed borné).
    expect(parseEvaluateResponse(null)).toBeNull();
    expect(parseEvaluateResponse("nope")).toBeNull();
  });

  it("m10 : booléen stringifié « false »/0/« non » est un rejet (Gemini JSON stringifie souvent)", () => {
    expect(parseEvaluateResponse({ pertinence: 95, publier: "false", raison: "doublon" }).publier).toBe(false);
    expect(parseEvaluateResponse({ pertinence: 95, publier: "non", raison: "hs" }).publier).toBe(false);
    expect(parseEvaluateResponse({ pertinence: 95, publier: 0, raison: "hs" }).publier).toBe(false);
    // « true » stringifié ou toute autre valeur non-falsey → couplé au seuil (ici publié).
    expect(parseEvaluateResponse({ pertinence: 95, publier: "true", raison: "ok" }).publier).toBe(true);
  });
});

describe("deterministicPublishFloor — plancher AO IT ouvert en zone (audit alignement 2026-07)", () => {
  const NOW = Date.parse("2026-07-20T00:00:00Z");
  const openAo = {
    subtype: "tender", url: "https://boad.org/avis/soc-ci", title: "Avis d'appel d'offres — SOC managé",
    geo: "ci", businessAngle: { deadline: "2026-09-30" },
  };
  it("publie d'office un AO IT ouvert, ancré en zone, traçable, échéance future", () => {
    expect(deterministicPublishFloor(openAo, { nowMs: NOW })).toBe(true);
    // Ancrage par compte nommé (ent) suffit aussi.
    expect(deterministicPublishFloor({ subtype: "funding", url: "https://x/y", title: "AMI", ent: "BCEAO" }, { nowMs: NOW })).toBe(true);
    // Zone UEMOA hors-CI acceptée.
    expect(deterministicPublishFloor({ ...openAo, geo: "sn" }, { nowMs: NOW })).toBe(true);
  });
  it("ne s'applique PAS hors du cœur AO ou sans traçabilité", () => {
    expect(deterministicPublishFloor({ ...openAo, subtype: "trend" }, { nowMs: NOW })).toBe(false); // pas un AO
    expect(deterministicPublishFloor({ ...openAo, url: "" }, { nowMs: NOW })).toBe(false); // pas d'URL
    expect(deterministicPublishFloor({ ...openAo, geo: "international", ent: "" }, { nowMs: NOW })).toBe(false); // hors zone
    expect(deterministicPublishFloor({ ...openAo, geo: "", ent: "" }, { nowMs: NOW })).toBe(false); // aucun ancrage
  });
  it("ne force PAS un avis d'ATTRIBUTION ni un AO manifestement expiré", () => {
    // Attribution (award) : ce n'est pas une opportunité ouverte.
    expect(deterministicPublishFloor({ ...openAo, title: "PV d'attribution du marché SOC" }, { nowMs: NOW })).toBe(false);
    // Échéance passée → ne force pas.
    expect(deterministicPublishFloor({ ...openAo, businessAngle: { deadline: "2026-06-01" } }, { nowMs: NOW })).toBe(false);
    // Échéance absente/non datée → toléré (avis ouvert, on ne peut prouver l'expiration).
    expect(deterministicPublishFloor({ ...openAo, businessAngle: {} }, { nowMs: NOW })).toBe(true);
  });
});
