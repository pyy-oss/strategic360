"use strict";

/**
 * Pure-function tests for functions/domain/classify.js (BUILD_KIT.md §9.C / §10 classifyAI).
 * No Vertex AI call is made here — `parseClassificationResponse` is exercised with synthetic
 * JSON fixtures standing in for an already-parsed Gemini response.
 *
 * Run: npx vitest run test/classify.domain.test.js
 */

import { describe, it, expect } from "vitest";
import { buildClassificationPrompt, parseClassificationResponse, deriveProxFromDueDate } from "../domain/classify.js";
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

describe("parseClassificationResponse — businessAngle / dueDate / budgetIdentified (Action 4.2)", () => {
  it("persists a valid business block: trimmed businessAngle, ISO dueDate, boolean budgetIdentified", () => {
    const item = parseClassificationResponse(
      {
        title: "AO PADCI — lot cybersécurité",
        businessAngle: {
          buyer: "  Banque mondiale / MTND  ",
          bu: "ICT",
          estAmount: "152 M$",
          deadline: "dépôt avant mi-septembre 2026",
          tenderRef: "SIGOMAP",
        },
        dueDate: "2026-09-15",
        budgetIdentified: true,
      },
      {}
    );
    expect(item.businessAngle).toEqual({
      buyer: "Banque mondiale / MTND",
      bu: "ICT",
      estAmount: "152 M$",
      deadline: "dépôt avant mi-septembre 2026",
      tenderRef: "SIGOMAP",
    });
    expect(item.dueDate).toBe("2026-09-15");
    expect(item.budgetIdentified).toBe(true);
  });

  it("rejects a non-ISO dueDate (regex YYYY-MM-DD) — the key must be absent, not undefined", () => {
    for (const bad of ["15/09/2026", "septembre 2026", "2026-9-5", 20260915, null]) {
      const item = parseClassificationResponse({ title: "x", dueDate: bad }, {});
      expect(Object.keys(item)).not.toContain("dueDate");
    }
    // trims surrounding whitespace before validating
    expect(parseClassificationResponse({ title: "x", dueDate: " 2026-09-15 " }, {}).dueDate).toBe("2026-09-15");
  });

  it("dérive dueDate depuis businessAngle.deadline (ISO) quand dueDate est absente (audit pertinence)", () => {
    // deadline ISO stricte présente, dueDate absente → promue en dueDate.
    const it1 = parseClassificationResponse({ title: "AO", businessAngle: { buyer: "BCEAO", deadline: "2026-08-15" } }, {});
    expect(it1.dueDate).toBe("2026-08-15");
    // deadline textuelle contenant une date ISO → on extrait la date.
    const it2 = parseClassificationResponse({ title: "AO", businessAngle: { buyer: "BCEAO", deadline: "dépôt avant le 2026-08-15" } }, {});
    expect(it2.dueDate).toBe("2026-08-15");
    // dueDate explicite fournie → on ne l'écrase pas avec la deadline.
    const it3 = parseClassificationResponse({ title: "AO", dueDate: "2026-09-01", businessAngle: { buyer: "X", deadline: "2026-08-15" } }, {});
    expect(it3.dueDate).toBe("2026-09-01");
    // deadline sans date ISO → pas de dueDate dérivée.
    const it4 = parseClassificationResponse({ title: "AO", businessAngle: { buyer: "X", deadline: "septembre 2026" } }, {});
    expect(Object.keys(it4)).not.toContain("dueDate");
  });

  it("coerces businessAngle sub-fields: invalid bu dropped, empty strings dropped, junk block absent", () => {
    const item = parseClassificationResponse(
      { title: "x", businessAngle: { buyer: "BCEAO", bu: "MARKETING", estAmount: "   ", deadline: 42, tenderRef: null } },
      {}
    );
    expect(item.businessAngle).toEqual({ buyer: "BCEAO" }); // seul champ exploitable
    for (const junk of [null, "angle", [], { buyer: "", bu: "autre" }]) {
      const it2 = parseClassificationResponse({ title: "x", businessAngle: junk }, {});
      expect(Object.keys(it2)).not.toContain("businessAngle");
    }
  });

  it("defaults budgetIdentified to false and never emits undefined anywhere in the business block", () => {
    const item = parseClassificationResponse({ title: "Signal sans bloc business" }, {});
    expect(item.budgetIdentified).toBe(false);
    expect(Object.keys(item)).not.toContain("businessAngle");
    expect(Object.keys(item)).not.toContain("dueDate");
    const walk = (v, path) => {
      expect(v, `"${path}" must not be undefined`).not.toBeUndefined();
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(item, "item");
    // budgetIdentified: "oui" (non-booléen) → false strict
    expect(parseClassificationResponse({ title: "x", budgetIdentified: "oui" }, {}).budgetIdentified).toBe(false);
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

describe("anti-obsolescence — repères temporels & dérivation d'imminence", () => {
  const NOW = Date.parse("2026-07-02T00:00:00Z");

  it("buildClassificationPrompt injecte la date du jour + la date de publication et la règle passé≠imminent", () => {
    const p = buildClassificationPrompt("texte", [], "CTX", { today: "2026-07-02", pubDate: "2025-08-01" });
    expect(p).toContain("date du jour = 2026-07-02");
    expect(p).toContain("date de publication de la source = 2025-08-01");
    expect(p).toContain("DÉJÀ PASSÉ");
    expect(p).toContain("une échéance dépassée = \"horizon\"");
  });

  it("deriveProxFromDueDate : passé → horizon+past ; buckets imminent/court/moyen/horizon", () => {
    expect(deriveProxFromDueDate("2025-07-02", NOW)).toEqual({ prox: "horizon", past: true }); // il y a un an
    expect(deriveProxFromDueDate("2026-07-10", NOW)).toEqual({ prox: "imminent", past: false }); // 8 j
    expect(deriveProxFromDueDate("2026-08-15", NOW)).toEqual({ prox: "court", past: false }); // ~44 j
    expect(deriveProxFromDueDate("2026-11-01", NOW)).toEqual({ prox: "moyen", past: false }); // ~122 j
    expect(deriveProxFromDueDate("2028-01-01", NOW)).toEqual({ prox: "horizon", past: false }); // >1 an
    expect(deriveProxFromDueDate("pas une date", NOW)).toBeNull();
  });

  it("parseClassificationResponse : une échéance dépassée force prox=horizon et marque stale", () => {
    const r = parseClassificationResponse(
      { title: "Élection passée", summary: "scrutin tenu", prox: "imminent", stance: "opportunity", dueDate: "2025-07-02" },
      { now: NOW }
    );
    expect(r.prox).toBe("horizon"); // le label IA « imminent » est écrasé par la date réelle
    expect(r.stale).toBe(true);
  });

  it("parseClassificationResponse : une échéance future dérive prox et ne marque pas stale", () => {
    const r = parseClassificationResponse(
      { title: "AO à venir", summary: "dépôt", prox: "moyen", dueDate: "2026-07-09" },
      { now: NOW }
    );
    expect(r.prox).toBe("imminent"); // 7 j → imminent, prime sur le label IA « moyen »
    expect(r.stale).toBeUndefined();
  });

  it("sans dueDate exploitable : garde le label IA (pas de stale)", () => {
    const r = parseClassificationResponse({ title: "Sig", summary: "s", prox: "court" }, { now: NOW });
    expect(r.prox).toBe("court");
    expect(r.stale).toBeUndefined();
  });
});

describe("anti-obsession cyber — équilibre sectoriel (2026-07)", () => {
  it("l'axe technologique ne ramène plus tout à la cybersécurité", () => {
    const p = buildClassificationPrompt("texte", []);
    expect(p).toContain("NE PAS tout ramener à la cybersécurité");
    expect(p).toContain("open banking");
    expect(p).toContain("ENABLERS");
  });
});
