"use strict";

/**
 * Tests unitaires purs pour functions/domain/kpiBackfill.js (levier « waouh » n°1 — reconstruction
 * honnête de l'historique KPI). Aucune I/O : on exerce les fonctions pures avec des fixtures.
 *
 * Run: npx vitest run test/kpiBackfill.domain.test.js
 */

import { describe, it, expect } from "vitest";
import {
  dayRangeUTC,
  endOfDayMs,
  computeKpiBackfillPoints,
  mergeHistoryPoints,
} from "../domain/kpiBackfill.js";

const ms = (iso) => new Date(iso).getTime();

describe("dayRangeUTC", () => {
  it("renvoie n jours ascendants se terminant à la date donnée (incluse)", () => {
    expect(dayRangeUTC("2026-07-13", 3)).toEqual(["2026-07-11", "2026-07-12", "2026-07-13"]);
  });
  it("gère le passage de mois", () => {
    expect(dayRangeUTC("2026-03-01", 2)).toEqual(["2026-02-28", "2026-03-01"]);
  });
  it("renvoie [] pour une entrée invalide", () => {
    expect(dayRangeUTC("pas-une-date", 3)).toEqual([]);
    expect(dayRangeUTC("2026-07-13", 0)).toEqual([]);
    expect(dayRangeUTC("2026-07-13", -5)).toEqual([]);
  });
});

describe("endOfDayMs", () => {
  it("renvoie 23:59:59.999 UTC du jour", () => {
    expect(endOfDayMs("2026-07-13")).toBe(ms("2026-07-13T23:59:59.999Z"));
  });
});

describe("computeKpiBackfillPoints", () => {
  const items = [
    { createdMs: ms("2026-07-10T08:00:00Z"), stance: "threat", published: true },
    { createdMs: ms("2026-07-11T08:00:00Z"), stance: "opportunity", published: true },
    { createdMs: ms("2026-07-12T08:00:00Z"), stance: "threat", published: true },
    { createdMs: ms("2026-07-12T20:00:00Z"), stance: "opportunity", published: true },
  ];

  it("cumule menaces/opportunités par date de création (≤ fin de jour)", () => {
    const pts = computeKpiBackfillPoints({ items, days: ["2026-07-10", "2026-07-11", "2026-07-12"] });
    expect(pts.map((p) => [p.date, p.menacesTotal, p.opportunites])).toEqual([
      ["2026-07-10", 1, 0],
      ["2026-07-11", 1, 1],
      ["2026-07-12", 2, 2],
    ]);
  });

  it("marque chaque point backfilled et laisse null les métriques non reconstituables", () => {
    const [p] = computeKpiBackfillPoints({ items, days: ["2026-07-12"] });
    expect(p.backfilled).toBe(true);
    expect(p.menacesTraitees).toBeNull();
    expect(p.winRateGlobal).toBeNull();
    expect(p.okrProgress).toBeNull();
    expect(p.threatsHighUnactioned).toBeNull();
  });

  it("ignore les items non publiés et ceux sans date de création", () => {
    const mixed = [
      { createdMs: ms("2026-07-10T08:00:00Z"), stance: "threat", published: true },
      { createdMs: ms("2026-07-10T08:00:00Z"), stance: "threat", published: false }, // brouillon
      { createdMs: null, stance: "threat", published: true }, // non daté
    ];
    const [p] = computeKpiBackfillPoints({ items: mixed, days: ["2026-07-10"] });
    expect(p.menacesTotal).toBe(1);
  });

  it("renvoie [] sans jours", () => {
    expect(computeKpiBackfillPoints({ items, days: [] })).toEqual([]);
  });
});

describe("mergeHistoryPoints", () => {
  it("n'écrase jamais un vrai snapshot par un point reconstruit", () => {
    const existing = [{ date: "2026-07-12", menacesTotal: 9, backfilled: false }];
    const backfill = [{ date: "2026-07-12", menacesTotal: 2, backfilled: true }];
    const merged = mergeHistoryPoints(existing, backfill, 90);
    expect(merged).toHaveLength(1);
    expect(merged[0].menacesTotal).toBe(9);
    expect(merged[0].backfilled).toBe(false);
  });

  it("remplace un ancien point reconstruit par un nouveau (refresh)", () => {
    const existing = [{ date: "2026-07-12", menacesTotal: 1, backfilled: true }];
    const backfill = [{ date: "2026-07-12", menacesTotal: 5, backfilled: true }];
    const merged = mergeHistoryPoints(existing, backfill, 90);
    expect(merged[0].menacesTotal).toBe(5);
  });

  it("fusionne, trie par date et plafonne", () => {
    const existing = [{ date: "2026-07-13", menacesTotal: 3, backfilled: false }];
    const backfill = [
      { date: "2026-07-11", menacesTotal: 1, backfilled: true },
      { date: "2026-07-12", menacesTotal: 2, backfilled: true },
    ];
    const merged = mergeHistoryPoints(existing, backfill, 2);
    expect(merged.map((p) => p.date)).toEqual(["2026-07-12", "2026-07-13"]);
  });
});
