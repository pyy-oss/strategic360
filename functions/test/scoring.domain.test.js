"use strict";

/**
 * Pure-function tests for functions/domain/scoring.js (BUILD_KIT.md §8.1 priorityScore).
 * Added in V8 Durcissement (raising domain/*.js coverage) — scoring.js had zero direct tests
 * before this, despite being exercised indirectly via scoreItems/index.js at runtime.
 *
 * Run: npx vitest run test/scoring.domain.test.js
 */

import { describe, it, expect } from "vitest";
import {
  computePriorityScore,
  impactFactor,
  credibiliteFactor,
  alignementFactor,
  probabiliteFactor,
  proximiteFactor,
} from "../domain/scoring.js";

describe("impactFactor", () => {
  it("maps the 3 known levels", () => {
    expect(impactFactor("high")).toBe(1.0);
    expect(impactFactor("medium")).toBe(0.6);
    expect(impactFactor("low")).toBe(0.3);
  });
  it("defaults unknown/missing to medium (0.6)", () => {
    expect(impactFactor(undefined)).toBe(0.6);
    expect(impactFactor("nonsense")).toBe(0.6);
  });
});

describe("credibiliteFactor — admiralty code A1..F5", () => {
  it("A1 (best reliability + best credibility) resolves to 1.0", () => {
    expect(credibiliteFactor("A1")).toBe(1.0);
  });
  it("F5 (worst/worst) resolves to 0.2", () => {
    expect(credibiliteFactor("F5")).toBe(0.2);
  });
  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(credibiliteFactor(" a1 ")).toBe(1.0);
    expect(credibiliteFactor("a1")).toBe(1.0);
  });
  it("averages reliability and credibility (e.g. C3 -> (0.6+0.6)/2)", () => {
    expect(credibiliteFactor("C3")).toBeCloseTo(0.6, 6);
  });
  it("falls back to 0.5 for unparseable/missing ratings", () => {
    expect(credibiliteFactor(undefined)).toBe(0.5);
    expect(credibiliteFactor("")).toBe(0.5);
    expect(credibiliteFactor("Z9")).toBe(0.5);
    expect(credibiliteFactor(42)).toBe(0.5);
  });
});

describe("alignementFactor", () => {
  it("gives partenaires/clients_prospects a higher baseline (0.75)", () => {
    expect(alignementFactor("partenaires")).toBe(0.75);
    expect(alignementFactor("clients_prospects")).toBe(0.75);
  });
  it("gives every other axis the 0.6 baseline", () => {
    expect(alignementFactor("concurrents")).toBe(0.6);
    expect(alignementFactor("tech")).toBe(0.6);
    expect(alignementFactor("reglementaire")).toBe(0.6);
    expect(alignementFactor(undefined)).toBe(0.6);
  });
});

describe("probabiliteFactor", () => {
  it("is a constant placeholder (0.7) pending V7 IA-estimated likelihood", () => {
    expect(probabiliteFactor()).toBe(0.7);
  });
});

describe("proximiteFactor", () => {
  const now = Date.parse("2026-07-02T00:00:00Z");

  it("returns 1.0 when dueDate is within 7 days", () => {
    expect(proximiteFactor({ dueDate: "2026-07-05" }, now)).toBe(1.0);
  });
  it("clamps overdue dueDates to 1.0 rather than penalizing", () => {
    expect(proximiteFactor({ dueDate: "2026-06-01" }, now)).toBe(1.0);
  });
  it("returns 0.3 when dueDate is 90+ days out", () => {
    expect(proximiteFactor({ dueDate: "2026-12-01" }, now)).toBe(0.3);
  });
  it("linearly decays between 7 and 90 days", () => {
    const v = proximiteFactor({ dueDate: "2026-08-01" }, now); // ~30 days out
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(1.0);
  });
  it("falls back to `date` freshness when no dueDate is present", () => {
    // date 3 days before now -> within the <=7 day "imminent" window -> 1.0
    expect(proximiteFactor({ date: "2026-06-29" }, now)).toBe(1.0);
  });
  it("returns 0.3 when neither dueDate nor date is usable", () => {
    expect(proximiteFactor({}, now)).toBe(0.3);
    expect(proximiteFactor(null, now)).toBe(0.3);
  });
});

describe("computePriorityScore", () => {
  const now = Date.parse("2026-07-02T00:00:00Z");

  it("scores a strong, credible, imminent, aligned signal near the top of 0-100", () => {
    const score = computePriorityScore(
      { impact: "high", sourceRating: "A1", axis: "clients_prospects", dueDate: "2026-07-03" },
      now
    );
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("scores a weak, low-credibility, distant signal near the bottom", () => {
    const score = computePriorityScore(
      { impact: "low", sourceRating: "F5", axis: "tech", dueDate: "2027-06-01" },
      now
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(20);
  });

  it("is always clamped to the [0,100] integer range", () => {
    const score = computePriorityScore({ impact: "high", sourceRating: "A1", axis: "partenaires" }, now);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("handles a completely empty item without throwing (all factors fall back to defaults)", () => {
    expect(() => computePriorityScore({}, now)).not.toThrow();
    const score = computePriorityScore({}, now);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("higher impact strictly increases the score, all else equal", () => {
    const base = { sourceRating: "B3", axis: "tech", dueDate: "2026-07-03" };
    const low = computePriorityScore({ ...base, impact: "low" }, now);
    const high = computePriorityScore({ ...base, impact: "high" }, now);
    expect(high).toBeGreaterThan(low);
  });
});
