"use strict";

/**
 * Pure-function tests for functions/domain/classify.js (BUILD_KIT.md §9.C / §10 classifyAI).
 * No Vertex AI call is made here — `parseClassificationResponse` is exercised with synthetic
 * JSON fixtures standing in for an already-parsed Gemini response.
 *
 * Run: npx vitest run test/classify.domain.test.js
 */

import { describe, it, expect } from "vitest";
import { buildClassificationPrompt, parseClassificationResponse } from "../domain/classify.js";
import { intelItemId } from "../domain/ids.js";

describe("buildClassificationPrompt", () => {
  it("includes the raw text and watchlist entities in the prompt", () => {
    const prompt = buildClassificationPrompt("Cisco annonce l'EOL du switch X", [{ name: "Cisco", type: "partner_constructor" }]);
    expect(prompt).toContain("Cisco annonce l'EOL du switch X");
    expect(prompt).toContain("Cisco (partner_constructor)");
    expect(prompt).toContain("JSON");
  });

  it("handles an empty watchlist gracefully", () => {
    const prompt = buildClassificationPrompt("Un texte quelconque", []);
    expect(prompt).toContain("watchlist vide");
  });

  it("embeds the full company context, the homonymy rule, and the business-angle schema", () => {
    const prompt = buildClassificationPrompt("Un texte quelconque", []);
    expect(prompt).toContain("Neurones Technologies S.A.");
    expect(prompt).toContain("HOMONYMIE");
    expect(prompt).toContain('"businessAngle"');
    expect(prompt).toContain('"dueDate"');
    expect(prompt).toContain('"budgetIdentified"');
    expect(prompt).toContain("imminent = < 1 mois");
  });

  it("renders the watchlist note when present (Action 4.5)", () => {
    const prompt = buildClassificationPrompt("Un texte", [
      { name: "Talentys", type: "Concurrent", note: "Concurrent cyber le plus direct" },
      { name: "Odoo" },
    ]);
    expect(prompt).toContain("- Talentys (Concurrent) — Concurrent cyber le plus direct");
    expect(prompt).toContain("- Odoo");
  });
});

describe("parseClassificationResponse — valid fixture", () => {
  it("maps a well-formed AI JSON response onto the IntelItem shape, status forced to 'new'", () => {
    const raw = {
      title: "Fortinet augmente ses tarifs de 8%",
      summary: "Fortinet annonce une hausse tarifaire mondiale de 8% à compter du T3.",
      axis: "partenaires",
      subtype: "pricing",
      impact: "medium",
      stance: "threat",
      entity: "Fortinet",
      geo: "afrique_ouest",
      prox: "court",
      weakSignal: false,
      soWhat: "Impact direct sur la marge des offres cyber intégrant Fortinet.",
      recommendedAction: "Renégocier les conditions avec le distributeur avant l'entrée en vigueur.",
      confidence: "high",
      status: "reviewed", // AI should NOT be able to set this — must be forced to 'new'
    };
    const item = parseClassificationResponse(raw, { sourceName: "Fortinet Newsroom", url: "https://example.com/a" });

    expect(item).not.toBeNull();
    expect(item.status).toBe("new");
    expect(item.title).toBe(raw.title);
    expect(item.axis).toBe("partenaires");
    expect(item.cat).toBe("marche"); // detection-radar category derived from axis
    expect(item.impact).toBe("medium");
    expect(item.stance).toBe("threat");
    expect(item.ent).toBe("Fortinet");
    expect(item.neuf).toBe(false);
    expect(item.sourceName).toBe("Fortinet Newsroom");
    expect(item.url).toBe("https://example.com/a");
  });
});

describe("parseClassificationResponse — missing fields", () => {
  it("coerces/defaults missing optional fields sensibly, still forces status 'new'", () => {
    const raw = { title: "Signal partiel" }; // no summary, no axis, no impact, etc.
    const item = parseClassificationResponse(raw, {});

    expect(item).not.toBeNull();
    expect(item.status).toBe("new");
    expect(item.title).toBe("Signal partiel");
    expect(item.summary).toBe("Signal partiel"); // falls back to title
    expect(item.axis).toBe("tech"); // default axis
    expect(item.cat).toBe("tech"); // detection category always derived, even from the default axis
    expect(item.impact).toBe("low"); // default impact
    expect(item.stance).toBe("neutral"); // default stance
    expect(item.prox).toBe("moyen"); // default prox
    expect(item.sourceRating).toBe("C3"); // default admiralty rating
    expect(typeof item.date).toBe("string");
  });

  it("falls back to a truncated summary as the title when title is missing", () => {
    const raw = { summary: "Un résumé assez long qui sert aussi de titre par défaut." };
    const item = parseClassificationResponse(raw, {});
    expect(item).not.toBeNull();
    expect(item.status).toBe("new");
    expect(item.title.length).toBeLessThanOrEqual(80);
  });

  it("never emits undefined-valued keys (Firestore rejects them — hit in production)", () => {
    // Gemini legitimately returns entity:null when a signal matches no watchlist entry; the
    // resulting doc must simply OMIT `ent` (and every other absent optional field), because
    // Firestore throws 'Cannot use "undefined" as a Firestore value' on write otherwise.
    const raw = { title: "Signal sans entité", entity: null };
    const item = parseClassificationResponse(raw, {});
    expect(item).not.toBeNull();
    expect(Object.keys(item)).not.toContain("ent");
    for (const [key, value] of Object.entries(item)) {
      expect(value, `field "${key}" must not be undefined`).not.toBeUndefined();
    }
  });
});

describe("parseClassificationResponse — malformed input", () => {
  it("returns null for a non-object response", () => {
    expect(parseClassificationResponse("just a string", {})).toBeNull();
    expect(parseClassificationResponse(42, {})).toBeNull();
    expect(parseClassificationResponse(null, {})).toBeNull();
    expect(parseClassificationResponse(undefined, {})).toBeNull();
    expect(parseClassificationResponse([1, 2, 3], {})).toBeNull();
  });

  it("returns null when neither title nor summary carry any usable text", () => {
    expect(parseClassificationResponse({ axis: "tech", impact: "high" }, {})).toBeNull();
    expect(parseClassificationResponse({ title: "   ", summary: "" }, {})).toBeNull();
  });

  it("ignores an invalid enum value and defaults it rather than throwing", () => {
    const raw = { title: "x", axis: "not-a-real-axis", impact: "catastrophic", stance: "who-knows" };
    const item = parseClassificationResponse(raw, {});
    expect(item.axis).toBe("tech");
    expect(item.impact).toBe("low");
    expect(item.stance).toBe("neutral");
    expect(item.status).toBe("new");
  });
});

describe("intelItemId (server-side, functions/domain/ids.js)", () => {
  it("matches the deterministic id scheme documented in BUILD_KIT.md §10 (prefers url)", () => {
    const id1 = intelItemId({ url: "https://example.com/eol-switch", title: "EOL switch", date: "2026-07-01" });
    const id2 = intelItemId({ url: "https://example.com/eol-switch", title: "Different title", date: "2026-08-01" });
    // Same URL → same id, regardless of title/date differences (idempotent re-ingestion).
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^item_[0-9a-f]{8}$/);
  });

  it("falls back to title+date when url is absent", () => {
    const id1 = intelItemId({ title: "Signal sans URL", date: "2026-07-02" });
    const id2 = intelItemId({ title: "Signal sans URL", date: "2026-07-02" });
    const id3 = intelItemId({ title: "Signal sans URL", date: "2026-07-03" });
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });
});
