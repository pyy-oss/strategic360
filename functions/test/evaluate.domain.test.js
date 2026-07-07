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

  it("parseEvaluateResponse : borne le score 0-100, respecte `publier`, garde la raison", () => {
    expect(parseEvaluateResponse({ pertinence: 82, publier: true, raison: "AO imminent" })).toEqual({ pertinence: 82, publier: true, raison: "AO imminent" });
    expect(parseEvaluateResponse({ pertinence: 150, publier: false, raison: "hors sujet" }).pertinence).toBe(100);
    expect(parseEvaluateResponse({ pertinence: -5, publier: false, raison: "x" }).pertinence).toBe(0);
  });

  it("fail-open : `publier` absent → déduit du seuil ; score absent → publie ; réponse nulle → null", () => {
    // publier absent → score >= seuil publie, sinon non.
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN + 10, raison: "" }).publier).toBe(true);
    expect(parseEvaluateResponse({ pertinence: RELEVANCE_MIN - 10, raison: "" }).publier).toBe(false);
    // score ET publier absents → fail-open (publie).
    expect(parseEvaluateResponse({ raison: "?" }).publier).toBe(true);
    // réponse non-objet → null (l'appelant publiera par défaut).
    expect(parseEvaluateResponse(null)).toBeNull();
    expect(parseEvaluateResponse("nope")).toBeNull();
  });
});
