"use strict";

/** Tests unitaires du juge de pertinence (porte de qualité avant publication). PUR. */

import { describe, it, expect } from "vitest";
import { RELEVANCE_MIN, buildEvaluatePrompt, parseEvaluateResponse } from "../domain/evaluate.js";

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

  it("fail-open borné : `publier` absent → déduit du seuil ; score absent → publie ; réponse nulle → null", () => {
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN + 10, raison: "" }).publier).toBe(true);
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN - 10, raison: "" }).publier).toBe(false);
    // score ET publier absents → fail-open (publie).
    expect(parseEvaluateResponse({ raison: "?" }).publier).toBe(true);
    // réponse non-objet → null (l'appelant publiera par défaut).
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
