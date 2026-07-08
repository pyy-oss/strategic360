"use strict";

/**
 * Tests du PROFIL CLIENT (Phase 0 produit). Deux objectifs :
 *  1. NON-RÉGRESSION : le DEFAULT_PROFILE doit être une VUE EXACTE des constantes métier actuelles
 *     (Neurones) — c'est ce qui garantit qu'un déploiement sans config se comporte à l'identique.
 *  2. Sémantique de fusion : mergeProfile surcharge en profondeur sans écraser un défaut par un vide.
 * PUR.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_PROFILE, mergeProfile, buildClientProfile } from "../domain/profile.js";
import { COMPANY_CONTEXT, NT_DIFFERENCIATEURS } from "../domain/companyContext.js";
import { VALID_AXES, VALID_BUS, VALID_SUBTYPES, SUBTYPE_SYNONYMS, OFFICIAL_DOMAIN_MARKERS, REPUTABLE_DOMAIN_MARKERS, AGGREGATOR_DOMAIN_MARKERS } from "../domain/classify.js";
import { SUBTYPE_BUSINESS, AXIS_ALIGN, ANCHOR_REQUIRED_SUBTYPES, UNANCHORED_DECOTE } from "../domain/scoring.js";
import { SUBTYPE_OFFER_MARKERS, MANAGED_MARKERS, PLACEHOLDER_BU } from "../domain/nt360.js";
import { NT_ROLE } from "../domain/copilote.js";

describe("DEFAULT_PROFILE — vue exacte des constantes NT actuelles (non-régression)", () => {
  it("identité & différenciateurs", () => {
    expect(DEFAULT_PROFILE.profile.differentiators).toBe(NT_DIFFERENCIATEURS);
    expect(DEFAULT_PROFILE.profile.systemRole).toBe(NT_ROLE);
    expect(DEFAULT_PROFILE.profile.currency).toBe("XOF");
    expect(DEFAULT_PROFILE.profile.timezone).toBe("Africa/Abidjan");
    expect(DEFAULT_PROFILE.contextText).toBe(COMPANY_CONTEXT);
  });

  it("taxonomie de veille = axes/subtypes/BU du classifieur", () => {
    expect(DEFAULT_PROFILE.taxonomy.axes.map((a) => a.key)).toEqual(VALID_AXES);
    // le poids d'alignement de chaque axe reflète AXIS_ALIGN
    for (const a of DEFAULT_PROFILE.taxonomy.axes) {
      expect(a.alignWeight).toBe(AXIS_ALIGN[a.key] ?? 0.6);
    }
    expect(DEFAULT_PROFILE.taxonomy.subtypes).toEqual([...VALID_SUBTYPES]);
    expect(DEFAULT_PROFILE.taxonomy.subtypeSynonyms).toEqual(SUBTYPE_SYNONYMS);
    expect(DEFAULT_PROFILE.taxonomy.businessUnits).toEqual(VALID_BUS);
  });

  it("tables de scoring = scoring.js", () => {
    expect(DEFAULT_PROFILE.scoring.subtypeBusiness).toEqual(SUBTYPE_BUSINESS);
    expect(DEFAULT_PROFILE.scoring.anchorRequiredSubtypes).toEqual([...ANCHOR_REQUIRED_SUBTYPES]);
    expect(DEFAULT_PROFILE.scoring.unanchoredDecote).toBe(UNANCHORED_DECOTE);
    expect(DEFAULT_PROFILE.scoring.defaultBusiness).toBe(0.4);
  });

  it("mapping veille→offre & sources = nt360/classify", () => {
    expect(DEFAULT_PROFILE.offerMapping.subtypeOfferMarkers).toEqual(SUBTYPE_OFFER_MARKERS);
    expect(DEFAULT_PROFILE.offerMapping.managedMarkers).toEqual(MANAGED_MARKERS);
    expect(DEFAULT_PROFILE.offerMapping.placeholderBu).toEqual([...PLACEHOLDER_BU]);
    expect(DEFAULT_PROFILE.sourceAuthority.officialDomains).toEqual(OFFICIAL_DOMAIN_MARKERS);
    expect(DEFAULT_PROFILE.sourceAuthority.reputableDomains).toEqual(REPUTABLE_DOMAIN_MARKERS);
    expect(DEFAULT_PROFILE.sourceAuthority.aggregatorDomains).toEqual(AGGREGATOR_DOMAIN_MARKERS);
  });
});

describe("mergeProfile / buildClientProfile — fusion profonde conservatrice", () => {
  it("sans surcharge → profil par défaut inchangé", () => {
    expect(buildClientProfile()).toEqual(DEFAULT_PROFILE);
    expect(buildClientProfile({})).toEqual(DEFAULT_PROFILE);
  });

  it("surcharge un champ profond sans toucher au reste", () => {
    const p = buildClientProfile({ profile: { companyName: "Cabinet Juridique X", sector: "Droit des affaires" } });
    expect(p.profile.companyName).toBe("Cabinet Juridique X");
    expect(p.profile.sector).toBe("Droit des affaires");
    // les autres champs profile restent ceux du défaut
    expect(p.profile.currency).toBe("XOF");
    expect(p.profile.timezone).toBe("Africa/Abidjan");
    // les autres sections restent intactes
    expect(p.scoring.subtypeBusiness).toEqual(SUBTYPE_BUSINESS);
  });

  it("un tableau surcharge EN BLOC (pas de fusion d'éléments)", () => {
    const p = buildClientProfile({ taxonomy: { businessUnits: ["CONSEIL", "CONTENTIEUX"] } });
    expect(p.taxonomy.businessUnits).toEqual(["CONSEIL", "CONTENTIEUX"]);
    expect(p.taxonomy.subtypes).toEqual([...VALID_SUBTYPES]); // reste du défaut
  });

  it("null/undefined n'écrase JAMAIS un défaut", () => {
    const p = buildClientProfile({ profile: { differentiators: null, currency: undefined, companyName: "Y" } });
    expect(p.profile.differentiators).toBe(NT_DIFFERENCIATEURS); // conservé
    expect(p.profile.currency).toBe("XOF"); // conservé
    expect(p.profile.companyName).toBe("Y"); // surchargé
  });

  it("ne mute pas DEFAULT_PROFILE", () => {
    const before = JSON.stringify(DEFAULT_PROFILE);
    buildClientProfile({ scoring: { defaultBusiness: 0.9 }, profile: { companyName: "Z" } });
    expect(JSON.stringify(DEFAULT_PROFILE)).toBe(before);
  });
});
