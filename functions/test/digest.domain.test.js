"use strict";

/** Tests unitaires du canal sortant (digest quotidien). PURS — aucun I/O. */

import { describe, it, expect } from "vitest";
import {
  selectDigestSignals, buildDigestPayload, hasDigestContent, itemMillis,
} from "../domain/digest.js";

describe("digest — selection des signaux a pousser", () => {
  const base = [
    { title: "A", priorityScore: 90, status: "new", date: "2026-07-10", ent: "SGCI" },
    { title: "B", priorityScore: 40, status: "new", date: "2026-07-11" }, // sous le seuil
    { title: "C", priorityScore: 80, status: "archived", date: "2026-07-11" }, // exclu (archive)
    { title: "D", priorityScore: 75, status: "reviewed", date: "2026-07-12" },
  ];

  it("filtre sur seuil de score + statut, trie par score desc", () => {
    const out = selectDigestSignals(base, { sinceMs: 0, minScore: 70 });
    expect(out.map((s) => s.title)).toEqual(["A", "D"]);
  });

  it("ne retient que les NOUVEAUX depuis sinceMs (anti-renvoi)", () => {
    const since = Date.parse("2026-07-11T00:00:00Z");
    const out = selectDigestSignals(base, { sinceMs: since, minScore: 70 });
    // A (10 juil) est anterieur -> exclu ; D (12 juil) est nouveau -> retenu.
    expect(out.map((s) => s.title)).toEqual(["D"]);
  });

  it("un item SANS horodatage n'est retenu qu'au tout premier envoi (sinceMs<=0)", () => {
    const items = [{ title: "X", priorityScore: 95, status: "new" }];
    expect(selectDigestSignals(items, { sinceMs: 0 }).map((s) => s.title)).toEqual(["X"]);
    expect(selectDigestSignals(items, { sinceMs: 123 })).toEqual([]);
  });

  it("plafonne a max", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, priorityScore: 80 + i, status: "new" }));
    expect(selectDigestSignals(many, { sinceMs: 0, max: 5 }).length).toBe(5);
  });

  it("itemMillis: createdAt Timestamp > date ISO > null", () => {
    expect(itemMillis({ createdAt: { toMillis: () => 42 } })).toBe(42);
    expect(itemMillis({ date: "2026-07-10" })).toBe(Date.parse("2026-07-10"));
    expect(itemMillis({})).toBeNull();
  });
});

describe("digest — composition de la charge utile", () => {
  it("sujet + corps listent les signaux, liens vers l'app (pas vers le contenu brut)", () => {
    const p = buildDigestPayload({
      signals: [{ title: "AO SOC BCEAO", priorityScore: 88, ent: "BCEAO", soWhat: "cadrer avant echeance" }],
      appUrl: "https://app.example.com/",
      title: "Sentinel",
    });
    expect(p.subject).toContain("1 signal");
    expect(p.text).toContain("AO SOC BCEAO");
    expect(p.text).toContain("BCEAO");
    expect(p.text).toContain("https://app.example.com/veille/radar");
    expect(p.html).toContain("<a href=");
    expect(p.signalCount).toBe(1);
  });

  it("alerte briefing pret a revoir SANS pousser le contenu du briefing", () => {
    const p = buildDigestPayload({ signals: [], briefingReady: true, appUrl: "https://a.co", title: "X" });
    expect(p.briefingReady).toBe(true);
    expect(p.subject).toMatch(/briefing/i);
    expect(p.text).toContain("/veille/briefing");
  });

  it("echappe le HTML (anti-injection dans l'email)", () => {
    const p = buildDigestPayload({ signals: [{ title: "<script>x</script>", priorityScore: 80 }], appUrl: "" });
    expect(p.html).not.toContain("<script>");
    expect(p.html).toContain("&lt;script&gt;");
  });

  it("hasDigestContent: vrai si signaux OU briefing, faux sinon", () => {
    expect(hasDigestContent(buildDigestPayload({ signals: [{ title: "a", priorityScore: 80 }] }))).toBe(true);
    expect(hasDigestContent(buildDigestPayload({ signals: [], briefingReady: true }))).toBe(true);
    expect(hasDigestContent(buildDigestPayload({ signals: [], briefingReady: false }))).toBe(false);
  });
});
