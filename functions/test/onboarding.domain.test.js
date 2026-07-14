"use strict";

/** Tests unitaires des prompts/parsers d'onboarding auto (Phase 1). PURS — pas d'appel Vertex. */

import { describe, it, expect } from "vitest";
import {
  buildOnboardingProfilePrompt, parseOnboardingProfileResponse,
  buildEcosystemMapPrompt, parseEcosystemMapResponse,
  buildVeillePlanPrompt, parseVeillePlanResponse,
  pickOnboardingLinks,
  buildConfigDocsFromDraft, sourceIdFromUrl,
} from "../domain/onboarding.js";

describe("onboarding — pickOnboardingLinks (crawler support, pur)", () => {
  const html = `
    <a href="/a-propos">À propos</a>
    <a href="/nos-services">Nos solutions</a>
    <a href="https://acme.fr/references">Nos clients</a>
    <a href="/contact">Contactez-nous</a>
    <a href="/a-propos">À propos (doublon)</a>
    <a href="https://twitter.com/acme">Twitter</a>
    <a href="/blog/article-1">Un article de blog</a>
  `;

  it("sélectionne un lien interne par groupe (about/offers/clients/contact), dédupliqué", () => {
    const links = pickOnboardingLinks(html, "https://www.acme.fr/");
    expect(links).toContain("https://www.acme.fr/a-propos");
    expect(links).toContain("https://www.acme.fr/nos-services");
    expect(links).toContain("https://acme.fr/references");
    expect(links).toContain("https://www.acme.fr/contact");
    expect(links.length).toBe(4); // un par groupe, pas de doublon
  });

  it("ignore les liens EXTERNES et les URLs invalides ; tolère un html vide", () => {
    const links = pickOnboardingLinks(html, "https://www.acme.fr/");
    expect(links.some((u) => u.includes("twitter.com"))).toBe(false);
    expect(pickOnboardingLinks("", "https://acme.fr")).toEqual([]);
    expect(pickOnboardingLinks("<a href='/x'>y</a>", "pas-une-url")).toEqual([]);
  });
});

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

describe("onboarding — buildConfigDocsFromDraft (mapping P4, pur)", () => {
  const draft = {
    profile: { companyName: "ACME Legal", sector: "Cabinet d'avocats", geographies: ["fr"] },
    contextText: "Cabinet d'avocats d'affaires basé à Paris.",
    ecosystem: {
      entities: [
        { name: "Concurrent SA", type: "concurrent", geo: "fr" },
        { name: "Client X", type: "client", geo: null },
        { name: "", type: "concurrent" }, // sans nom → écartée
      ],
      axes: [{ key: "reglementaire", label: "Réglementaire", alignWeight: 0.5, guetGuidance: "…" }],
      subtypes: ["litige", "ma"],
    },
    plan: {
      axes: [{ key: "clients_prospects", label: "Clients", alignWeight: 0.9, guetGuidance: "…" }],
      classifierGuidance: "AXES DE GUET : M&A, litiges.",
      homonymyRule: "Ignorer ACME Inc. (USA).",
      keywords: ["contentieux"],
      candidateSources: [
        { name: "AMF", url: "https://www.amf-france.org/actu", kind: "web", axis: "reglementaire", valid: true },
        { name: "Mort", url: "https://dead.example/rss", kind: "rss", valid: false }, // invalide → écartée
      ],
    },
  };

  it("mappe profil + taxonomie (axes union plan+éco, sous-types) + contexte", () => {
    const out = buildConfigDocsFromDraft(draft);
    expect(out.profileDoc.companyName).toBe("ACME Legal");
    const keys = out.taxonomyDoc.axes.map((a) => a.key);
    expect(keys).toContain("clients_prospects");
    expect(keys).toContain("reglementaire");
    expect(out.taxonomyDoc.axes[0]).toEqual({ key: "reglementaire", alignWeight: 0.5 }); // {key,alignWeight} seulement
    expect(out.taxonomyDoc.subtypes).toEqual(["litige", "ma"]);
    expect(out.contextText).toContain("AXES DE GUET");
    expect(out.contextText).toContain("Ignorer ACME Inc.");
    expect(out.contextText).toContain("CONCURRENTS : Concurrent SA.");
  });

  it("ne retient que les sources VALIDÉES quand une validation a eu lieu, ids déterministes", () => {
    const out = buildConfigDocsFromDraft(draft);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].url).toBe("https://www.amf-france.org/actu");
    expect(out.sources[0].id).toBe(sourceIdFromUrl("https://www.amf-france.org/actu"));
    expect(out.sources[0].id).toMatch(/^onb-/);
  });

  it("sans validation (valid absent) → toutes les sources retenues", () => {
    const d2 = { ...draft, plan: { ...draft.plan, candidateSources: [
      { name: "A", url: "https://a.fr", kind: "web" },
      { name: "B", url: "https://b.fr", kind: "rss" },
    ] } };
    expect(buildConfigDocsFromDraft(d2).sources).toHaveLength(2);
  });

  it("watchlist : entités nommées seulement, type borné", () => {
    const out = buildConfigDocsFromDraft(draft);
    expect(out.watchlist.map((w) => w.name)).toEqual(["Concurrent SA", "Client X"]);
    expect(out.watchlist[0].type).toBe("concurrent");
    expect(out.watchlist[1].type).toBe("client");
  });

  it("omet axes/subtypes vides (ne remplace pas un défaut par du vide)", () => {
    const out = buildConfigDocsFromDraft({ profile: { companyName: "X" }, ecosystem: {}, plan: {} });
    expect(out.taxonomyDoc.axes).toBeUndefined();
    expect(out.taxonomyDoc.subtypes).toBeUndefined();
    expect(out.sources).toEqual([]);
  });

  it("profil sans nom d'entreprise → null (rien à appliquer)", () => {
    expect(buildConfigDocsFromDraft({ profile: {}, ecosystem: {}, plan: {} })).toBeNull();
    expect(buildConfigDocsFromDraft(null)).toBeNull();
  });

  it("génère profileDoc.systemRole depuis le profil client (audit multi-tenant B1) — aucune trace Neurones", () => {
    const out = buildConfigDocsFromDraft(draft);
    expect(typeof out.profileDoc.systemRole).toBe("string");
    expect(out.profileDoc.systemRole).toContain("ACME Legal");
    expect(out.profileDoc.systemRole).not.toContain("Neurones");
  });

  it("ne réécrit pas un systemRole déjà fourni (édition manuelle préservée)", () => {
    const d = { ...draft, profile: { ...draft.profile, systemRole: "Rôle sur mesure édité à la main." } };
    expect(buildConfigDocsFromDraft(d).profileDoc.systemRole).toBe("Rôle sur mesure édité à la main.");
  });

  it("écrit contextMarkers pour NEUTRALISER le défaut Neurones (C2) : CONCURRENTS si concurrents, sinon []", () => {
    expect(buildConfigDocsFromDraft(draft).taxonomyDoc.contextMarkers).toEqual(["CONCURRENTS"]);
    const sansConc = { ...draft, ecosystem: { ...draft.ecosystem, entities: [{ name: "Client X", type: "client" }] } };
    expect(buildConfigDocsFromDraft(sansConc).taxonomyDoc.contextMarkers).toEqual([]);
  });
});
