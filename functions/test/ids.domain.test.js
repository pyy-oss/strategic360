"use strict";

/**
 * Pure-function tests for functions/domain/ids.js (BUILD_KIT.md §10 "Idempotence : IDs
 * déterministes"). Added in V8 Durcissement — ids.js was previously exercised only indirectly
 * (via classify.domain.test.js's fixtures), with no test asserting the stability/collision
 * properties that idempotent ingestion actually depends on.
 *
 * Run: npx vitest run test/ids.domain.test.js
 */

import { describe, it, expect } from "vitest";
import { djb2Hex, intelItemId } from "../domain/ids.js";

describe("djb2Hex", () => {
  it("is deterministic — same input always yields the same hash", () => {
    expect(djb2Hex("https://example.com/article-1")).toBe(djb2Hex("https://example.com/article-1"));
  });
  it("produces an 8-char lowercase hex string", () => {
    const h = djb2Hex("some arbitrary string");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
  it("produces different hashes for different inputs (basic collision sanity)", () => {
    const inputs = [
      "https://example.com/a",
      "https://example.com/b",
      "Titre A|2026-01-01",
      "Titre B|2026-01-01",
      "Titre A|2026-01-02",
    ];
    const hashes = inputs.map(djb2Hex);
    expect(new Set(hashes).size).toBe(inputs.length);
  });
  it("handles the empty string without throwing", () => {
    expect(() => djb2Hex("")).not.toThrow();
    expect(djb2Hex("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("intelItemId", () => {
  it("prefixes with 'item_' and is stable for the same {url,title,date}", () => {
    const input = { url: "https://example.com/x", title: "X", date: "2026-01-01" };
    const id1 = intelItemId(input);
    const id2 = intelItemId({ ...input });
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^item_[0-9a-f]{8}$/);
  });

  it("uses the url as the hashing basis when present (title/date changes don't affect id)", () => {
    const idA = intelItemId({ url: "https://example.com/x", title: "Titre A", date: "2026-01-01" });
    const idB = intelItemId({ url: "https://example.com/x", title: "Titre B", date: "2099-12-31" });
    expect(idA).toBe(idB);
  });

  it("falls back to `title|date` when url is missing or blank", () => {
    const idNoUrl = intelItemId({ title: "Titre X", date: "2026-05-01" });
    const idBlankUrl = intelItemId({ url: "   ", title: "Titre X", date: "2026-05-01" });
    expect(idNoUrl).toBe(idBlankUrl);
    expect(idNoUrl).toBe(`item_${djb2Hex("Titre X|2026-05-01")}`);
  });

  it("produces different ids for genuinely different items (no url)", () => {
    const id1 = intelItemId({ title: "Titre X", date: "2026-05-01" });
    const id2 = intelItemId({ title: "Titre Y", date: "2026-05-01" });
    expect(id1).not.toBe(id2);
  });

  it("trims whitespace on the url before hashing (same id with/without surrounding spaces)", () => {
    const id1 = intelItemId({ url: "https://example.com/x", title: "T", date: "2026-01-01" });
    const id2 = intelItemId({ url: "  https://example.com/x  ", title: "T", date: "2026-01-01" });
    expect(id1).toBe(id2);
  });
});
