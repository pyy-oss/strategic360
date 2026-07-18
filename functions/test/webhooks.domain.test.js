import { describe, it, expect } from "vitest";
import {
  OUTBOUND_EVENTS,
  INBOUND_ACTIONS,
  signPayload,
  verifySignature,
  generateSecret,
  maskSecret,
  sanitizeEndpoint,
  sanitizeInboundSource,
  endpointMatchesEvent,
  buildEventEnvelope,
} from "../domain/webhooks.js";

const SECRET = "test-secret-0123456789abcdef";
const TS = 1_700_000_000; // horodatage fixe (déterministe)

describe("webhooks — signature HMAC", () => {
  it("signe de façon déterministe et vérifie une signature valide", () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = signPayload(body, SECRET, TS);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(sig).toBe(signPayload(body, SECRET, TS)); // déterministe
    expect(
      verifySignature({ body, secret: SECRET, signature: sig, timestamp: TS, nowMs: TS * 1000 })
    ).toBe(true);
  });

  it("rejette une signature au mauvais secret", () => {
    const body = "x";
    const sig = signPayload(body, SECRET, TS);
    expect(
      verifySignature({ body, secret: "autre-secret", signature: sig, timestamp: TS, nowMs: TS * 1000 })
    ).toBe(false);
  });

  it("rejette un corps altéré (intégrité)", () => {
    const sig = signPayload("payload-original", SECRET, TS);
    expect(
      verifySignature({ body: "payload-altéré", secret: SECRET, signature: sig, timestamp: TS, nowMs: TS * 1000 })
    ).toBe(false);
  });

  it("rejette un horodatage hors tolérance (anti-rejeu)", () => {
    const body = "x";
    const sig = signPayload(body, SECRET, TS);
    // 10 min plus tard, tolérance 300 s par défaut → rejeté
    expect(
      verifySignature({ body, secret: SECRET, signature: sig, timestamp: TS, nowMs: (TS + 600) * 1000 })
    ).toBe(false);
    // 4 min plus tard → dans la tolérance
    expect(
      verifySignature({ body, secret: SECRET, signature: sig, timestamp: TS, nowMs: (TS + 240) * 1000 })
    ).toBe(true);
  });

  it("rejette les entrées manquantes/invalides sans lever", () => {
    expect(verifySignature({ body: "x", secret: "", signature: "s", timestamp: TS })).toBe(false);
    expect(verifySignature({ body: "x", secret: SECRET, signature: "", timestamp: TS })).toBe(false);
    expect(verifySignature({ body: "x", secret: SECRET, signature: "s", timestamp: "abc" })).toBe(false);
    expect(verifySignature({ body: "x", secret: SECRET, signature: "s", timestamp: null })).toBe(false);
  });

  it("signe un corps objet comme sa version JSON canonique", () => {
    const obj = { a: 1, b: 2 };
    expect(signPayload(obj, SECRET, TS)).toBe(signPayload(JSON.stringify(obj), SECRET, TS));
  });
});

describe("webhooks — secrets", () => {
  it("génère un secret hex de 64 caractères, unique", () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
    expect(s1).not.toBe(s2);
  });

  it("masque un secret pour l'affichage", () => {
    expect(maskSecret("abcd1234efgh5678")).toBe("abcd…5678");
    expect(maskSecret("court")).toBe("••••");
    expect(maskSecret("")).toBe("");
  });
});

describe("webhooks — validateurs de config", () => {
  it("sanitizeEndpoint ne garde que les champs et événements connus", () => {
    const out = sanitizeEndpoint({
      url: "  https://ex.com/hook  ",
      events: ["intel.signal", "briefing.created", "inconnu", "intel.signal"],
      label: "CRM",
      active: true,
      secret: "injection-ignorée",
      extra: 42,
    });
    expect(out).toEqual({
      url: "https://ex.com/hook",
      events: ["intel.signal", "briefing.created"], // dédupliqué + filtré
      label: "CRM",
      active: true,
    });
    expect(out).not.toHaveProperty("secret");
    expect(out).not.toHaveProperty("extra");
  });

  it("sanitizeEndpoint défaut : active=true, events vides si absent", () => {
    const out = sanitizeEndpoint({ url: "https://x" });
    expect(out.active).toBe(true);
    expect(out.events).toEqual([]);
    expect(sanitizeEndpoint({ url: "https://x", active: false }).active).toBe(false);
  });

  it("sanitizeInboundSource ne garde que les actions connues", () => {
    const out = sanitizeInboundSource({ label: "Zapier", actions: ["ingest", "sync", "hack", "pull"], active: false });
    expect(out).toEqual({ label: "Zapier", actions: ["ingest", "sync", "pull"], active: false });
  });

  it("sanitize* tolère un objet vide / non-objet", () => {
    expect(sanitizeEndpoint(null)).toEqual({ url: "", events: [], label: "", active: true });
    expect(sanitizeInboundSource(undefined)).toEqual({ label: "", actions: [], active: true });
  });
});

describe("webhooks — appariement & enveloppe", () => {
  it("endpointMatchesEvent respecte active + abonnement", () => {
    const ep = { active: true, events: ["intel.signal"] };
    expect(endpointMatchesEvent(ep, "intel.signal")).toBe(true);
    expect(endpointMatchesEvent(ep, "briefing.created")).toBe(false);
    expect(endpointMatchesEvent({ active: false, events: ["intel.signal"] }, "intel.signal")).toBe(false);
    expect(endpointMatchesEvent(null, "intel.signal")).toBe(false);
  });

  it("buildEventEnvelope produit une enveloppe standard", () => {
    const env = buildEventEnvelope("intel.signal", { id: "x", score: 90 }, { id: "evt_1", timestamp: "2026-01-01T00:00:00Z" });
    expect(env).toEqual({
      id: "evt_1",
      type: "intel.signal",
      createdAt: "2026-01-01T00:00:00Z",
      source: "sentinel-360",
      data: { id: "x", score: 90 },
    });
  });

  it("les constantes couvrent le périmètre décidé", () => {
    expect(OUTBOUND_EVENTS).toEqual(["intel.signal", "briefing.created", "action.created", "account.event"]);
    expect(INBOUND_ACTIONS).toEqual(["ingest", "action", "sync", "pull"]);
  });
});
