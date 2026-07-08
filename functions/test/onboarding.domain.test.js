"use strict";

/** Tests unitaires des prompts/parsers d'onboarding auto (Phase 1). PURS — pas d'appel Vertex. */

import { describe, it, expect } from "vitest";
import {
  buildOnboardingProfilePrompt, parseOnboardingProfileResponse,
  buildEcosystemMapPrompt, parseEcosystemMapResponse,
  buildVeillePlanPrompt, parseVeillePlanResponse,
} from "../domain/onboarding.js";

describe("onboarding — profil depuis le site", () => {
  it("buildOnboardingProfilePrompt : injecte indices, texte du site et exige un JSON anti-invention", () => {
    const p = buildOnboardingProfilePrompt("ACME est un cabinet conseil basé à Paris.", "", { name: "ACME", sector: "conseil" });
    expect(p).toContain("Nom présumé : ACME");
    expect(p).toContain("Secteur présumé : conseil");
    expect(p).toContain("cabinet conseil basé à Paris");
    expect(p).toContain("OBJECTIVITÉ");
    expect(p).toContain('"contextText"');
  });

  it("parseOnboardingProfileResponse : coerce, normalise la géo, null si vide", () => {
    const out = parseOnboardingProfileResponse({
      profile: { companyName: "ACME", legalName: "ACME SAS", sector: "Conseil", geographies: ["FR", "BE"], currency: "EUR", homonyms: ["ACME Inc"], differentiators: "réseau", regulators: ["CNIL"] },
      contextText: "Cabinet de conseil…",
    });
    expect(out.profile.companyName).toBe("ACME");
    expect(out.profile.geographies).toEqual(["fr", "be"]); // minusculé
    expect(out.profile.currency).toBe("EUR");
    expect(out.contextText).toContain("Cabinet");
    // Vide → null.
    expect(parseOnboardingProfileResponse({ profile: {} })).toBeNull();
    expect(parseOnboardingProfileResponse(null)).toBeNull();
  });
});

describe("onboarding — cartographie d'écosystème", () => {
  it("parseEcosystemMapResponse : type d'entité borné, axes normalisés, alignWeight clampé", () => {
    const out = parseEcosystemMapResponse({
      entities: [
        { name: "Concurrent X", type: "concurrent", geo: "fr", note: "leader" },
        { name: "Sans type", type: "bidon" }, // type invalide → défaut "concurrent"
        { type: "client" }, // sans nom → écarté
      ],
      axes: [{ key: "Clients Prospects", label: "Clients", alignWeight: 5, guetGuidance: "AO, levées" }],
      subtypes: ["Tender", "M&A"],
    });
    expect(out.entities).toHaveLength(2);
    expect(out.entities[1].type).toBe("concurrent"); // borné
    expect(out.axes[0].key).toBe("clients_prospects"); // snake_case
    expect(out.axes[0].alignWeight).toBe(1); // clampé 0-1
    expect(out.subtypes).toContain("tender");
    expect(out.subtypes).toContain("ma"); // "M&A" normalisé
  });

  it("parseEcosystemMapResponse : rien d'exploitable → null", () => {
    expect(parseEcosystemMapResponse({ entities: [], axes: [] })).toBeNull();
    expect(parseEcosystemMapResponse("x")).toBeNull();
  });
});

describe("onboarding — plan de veille", () => {
  it("buildVeillePlanPrompt : liste l'écosystème et demande des sources réalistes (validées ensuite)", () => {
    const p = buildVeillePlanPrompt({ companyName: "ACME", sector: "conseil", geographies: ["fr"] }, [{ name: "Concurrent X", type: "concurrent" }]);
    expect(p).toContain("ACME");
    expect(p).toContain("Concurrent X (concurrent)");
    expect(p).toContain('"candidateSources"');
    expect(p).toMatch(/VALID[ÉE]/i); // mention de validation technique
  });

  it("parseVeillePlanResponse : ne garde que les sources à URL http(s) valide, kind borné", () => {
    const out = parseVeillePlanResponse({
      axes: [{ key: "reglementaire", label: "Réglementaire", alignWeight: 0.8, guetGuidance: "jurisprudences" }],
      classifierGuidance: "AXES DE GUET : …",
      homonymyRule: "Ignorer ACME Inc.",
      keywords: ["contentieux", "M&A"],
      candidateSources: [
        { name: "AMF", url: "https://www.amf-france.org", kind: "web", axis: "reglementaire" },
        { name: "Bidon", url: "pas-une-url", kind: "web" },       // URL invalide → écartée
        { name: "Flux", url: "https://x.fr/rss", kind: "inconnu" }, // kind invalide → "web"
      ],
    });
    expect(out.candidateSources).toHaveLength(2);
    expect(out.candidateSources[0].url).toBe("https://www.amf-france.org");
    expect(out.candidateSources[1].kind).toBe("web"); // borné
    expect(out.classifierGuidance).toContain("AXES DE GUET");
    expect(out.keywords).toContain("contentieux");
  });

  it("parseVeillePlanResponse : rien d'exploitable → null", () => {
    expect(parseVeillePlanResponse({ axes: [], candidateSources: [] })).toBeNull();
  });
});
