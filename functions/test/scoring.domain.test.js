"use strict";

/**
 * Pure-function tests for functions/domain/scoring.js.
 *
 * Updated for the audited barème (plan d'audit 2026-07, Actions 5.1/5.2):
 *   priorityScore = 100 × (0.4 + 0.6·credibilite)
 *                       × (0.30·impact + 0.25·proximite + 0.20·potentielBusiness
 *                          + 0.15·alignement + 0.10·probabilite)
 * proximiteFactor priority chain: dueDate → prox enum (PROX_TABLE) → date freshness
 * (capped at 0.5) → 0.3. The pre-audit expected values were recomputed, not dropped.
 *
 * Run: npx vitest run test/scoring.domain.test.js
 */

import { describe, it, expect } from "vitest";
import {
  computePriorityScore,
  impactFactor,
  credibiliteFactor,
  businessFactor,
  alignementFactor,
  probabiliteFactor,
  proximiteFactor,
  SUBTYPE_BUSINESS,
  AXIS_ALIGN,
  PROX_TABLE,
} from "../domain/scoring.js";
import { DEFAULT_PROFILE, scoringConfig } from "../domain/profile.js";

describe("PR C — non-régression : profil par défaut == scoring intégré", () => {
  const NOW = Date.parse("2026-07-08T00:00:00Z");
  const def = scoringConfig(DEFAULT_PROFILE);
  // Échantillon large couvrant subtypes ancrés/non-ancrés, axes, géo CI/UEMOA/mondial, ent, budget.
  const fixtures = [
    { title: "AO BRVM", axis: "clients_prospects", subtype: "tender", impact: "high", stance: "opportunity", geo: "ci", ent: "BRVM", sourceRating: "A1", budgetIdentified: true, dueDate: "2026-08-01" },
    { title: "CVE mondiale", axis: "tech", subtype: "cve", impact: "high", stance: "neutral", geo: "monde", sourceRating: "C3" },
    { title: "CVE locale", axis: "tech", subtype: "vulnerability", impact: "high", stance: "opportunity", geo: "ci", ent: "SGCI", sourceRating: "B2" },
    { title: "Supply UEMOA", axis: "partenaires", subtype: "supply", impact: "medium", stance: "threat", geo: "uemoa", sourceRating: "B3" },
    { title: "Concurrent", axis: "concurrents", subtype: "win", impact: "medium", stance: "threat", geo: "afrique", sourceRating: "C2" },
    { title: "Régulation", axis: "reglementaire", subtype: "regulation", impact: "high", stance: "opportunity", geo: "ci", sourceRating: "A2" },
    { title: "Macro sans géo", axis: "tech", subtype: "macro", impact: "low", stance: "neutral", sourceRating: "D3" },
    { title: "Sans subtype", axis: "partenaires", impact: "medium", stance: "neutral", geo: "ivoire", ent: "Cisco", sourceRating: "B1" },
  ];

  it("computePriorityScore : identique avec scoringConfig(DEFAULT_PROFILE) et sans config, pour tous les cas", () => {
    for (const it of fixtures) {
      for (const av of [0, 0.5, 1]) {
        const withDefault = computePriorityScore(it, NOW, { accountValue: av, scoring: def });
        const legacy = computePriorityScore(it, NOW, { accountValue: av });
        expect(withDefault, `${it.title} @av=${av}`).toBe(legacy);
      }
    }
  });

  it("businessFactor & alignementFactor : config par défaut == sans arg", () => {
    for (const it of fixtures) {
      expect(businessFactor(it, def)).toBe(businessFactor(it));
      expect(alignementFactor(it, def)).toBe(alignementFactor(it));
    }
  });

  it("une config CUSTOM change bien le résultat (secteur/géo différents)", () => {
    // Cabinet juridique en France : axes repondérés, géo FR, subtypes valorisés autrement.
    const custom = {
      subtypeBusiness: { regulation: 1.0, tender: 0.5 },
      defaultBusiness: 0.3,
      opportunityBonus: 0.1, budgetIdentifiedBonus: 0.1,
      anchorRequiredSubtypes: [], unanchoredDecote: 0.6,
      anchorGeoMarkers: ["fr", "france"],
      localGeoMarkers: [{ markers: ["fr", "paris"], bonus: 0.2 }],
      axisAlign: { reglementaire: 1.0, clients_prospects: 0.6 }, defaultAxisWeight: 0.4,
    };
    const item = { title: "Nouvelle loi", axis: "reglementaire", subtype: "regulation", impact: "high", stance: "opportunity", geo: "fr", sourceRating: "A2" };
    expect(computePriorityScore(item, NOW, { scoring: custom })).not.toBe(computePriorityScore(item, NOW, {}));
    // regulation vaut 1.0 ici (vs 0.85 par défaut) → businessFactor plus élevé
    expect(businessFactor(item, custom)).toBeGreaterThan(businessFactor(item));
  });
});

describe("impactFactor", () => {
  it("maps the 3 known levels", () => {
    expect(impactFactor("high")).toBe(1.0);
    expect(impactFactor("medium")).toBe(0.6);
    expect(impactFactor("low")).toBe(0.3);
  });
  it("defaults unknown/missing to medium (0.6) — aligned with the classification parser default", () => {
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

describe("businessFactor (Action 5.2)", () => {
  it("maps subtypes per SUBTYPE_BUSINESS (tender is the most convertible)", () => {
    expect(businessFactor({ subtype: "tender" })).toBe(1.0);
    expect(businessFactor({ subtype: "funding" })).toBe(0.9);
    expect(businessFactor({ subtype: "eol" })).toBe(0.9);
    expect(businessFactor({ subtype: "regulation" })).toBe(0.85);
    expect(businessFactor({ subtype: "budget" })).toBe(0.85);
    expect(businessFactor({ subtype: "pricing" })).toBe(0.6);
    expect(businessFactor({ subtype: "program_change" })).toBe(0.6);
    expect(businessFactor({ subtype: "ma" })).toBe(0.55);
    expect(businessFactor({ subtype: "win" })).toBe(0.5);
    expect(businessFactor({ subtype: "product_launch" })).toBe(0.45);
    expect(SUBTYPE_BUSINESS.tender).toBe(1.0);
  });
  it("defaults unknown/missing subtype to 0.4", () => {
    expect(businessFactor({})).toBe(0.4);
    expect(businessFactor(null)).toBe(0.4);
    expect(businessFactor({ subtype: "nonsense" })).toBe(0.4);
  });
  it("adds +0.1 for stance=opportunity and +0.1 for budgetIdentified", () => {
    expect(businessFactor({ subtype: "win", stance: "opportunity" })).toBeCloseTo(0.6, 6);
    expect(businessFactor({ subtype: "win", budgetIdentified: true })).toBeCloseTo(0.6, 6);
    expect(businessFactor({ subtype: "win", stance: "opportunity", budgetIdentified: true })).toBeCloseTo(0.7, 6);
  });
  it("is clamped at 1.0 (tender + both bonuses does not overflow)", () => {
    expect(businessFactor({ subtype: "tender", stance: "opportunity", budgetIdentified: true })).toBe(1.0);
  });
  it("décote vulnerability/cve/supply SANS ancrage local (ni ent ni geo) — anti-biais cyber (audit 2026-07)", () => {
    // Sans ancrage : ×0.6 (une CVE éditeur mondiale sans parc/compte n'est pas une opportunité NT).
    expect(businessFactor({ subtype: "vulnerability" })).toBeCloseTo(0.8 * 0.6, 6);
    expect(businessFactor({ subtype: "cve" })).toBeCloseTo(0.8 * 0.6, 6);
    expect(businessFactor({ subtype: "supply" })).toBeCloseTo(0.85 * 0.6, 6);
    // Avec un ent résolu OU une zone locale → plein tarif rétabli.
    expect(businessFactor({ subtype: "vulnerability", ent: "SGBCI" })).toBe(0.8);
    expect(businessFactor({ subtype: "cve", geo: "ci" })).toBe(0.8);
    expect(businessFactor({ subtype: "supply", geo: "Afrique de l'Ouest" })).toBe(0.85);
    // Un subtype non concerné n'est jamais décoté, ancrage ou pas.
    expect(businessFactor({ subtype: "tender" })).toBe(1.0);
  });
});

describe("alignementFactor (Action 5.2 — per-axis AXIS_ALIGN + watchlist bonus)", () => {
  it("maps axes per AXIS_ALIGN", () => {
    expect(alignementFactor({ axis: "clients_prospects" })).toBe(0.9);
    expect(alignementFactor({ axis: "reglementaire" })).toBe(0.75);
    expect(alignementFactor({ axis: "partenaires" })).toBe(0.7);
    expect(alignementFactor({ axis: "concurrents" })).toBe(0.6);
    expect(alignementFactor({ axis: "tech" })).toBe(0.45);
    expect(AXIS_ALIGN.clients_prospects).toBe(0.9);
  });
  it("defaults unknown/missing axis to 0.6", () => {
    expect(alignementFactor({})).toBe(0.6);
    expect(alignementFactor(null)).toBe(0.6);
    expect(alignementFactor({ axis: "nonsense" })).toBe(0.6);
  });
  it("adds +0.2 when a watchlist entity is resolved (item.ent), clamped at 1.0", () => {
    expect(alignementFactor({ axis: "tech", ent: "Cisco" })).toBeCloseTo(0.65, 6);
    expect(alignementFactor({ axis: "concurrents", ent: "Talentys" })).toBeCloseTo(0.8, 6);
    expect(alignementFactor({ axis: "clients_prospects", ent: "BCEAO" })).toBe(1.0);
  });
});

describe("probabiliteFactor (M1 audit — dérive de confidence + signal faible)", () => {
  it("mappe la confidence IA (high/medium/low) et décote un signal faible", () => {
    expect(probabiliteFactor({ confidence: "high" })).toBe(0.9);
    expect(probabiliteFactor({ confidence: "medium" })).toBe(0.7);
    expect(probabiliteFactor({ confidence: "low" })).toBe(0.45);
    expect(probabiliteFactor({})).toBe(0.7); // défaut si non renseigné
    // signal faible (neuf) : ×0.8
    expect(probabiliteFactor({ confidence: "high", neuf: true })).toBe(0.72);
  });
});

describe("SUBTYPE_BUSINESS (M5 audit — sourcing & vulnérabilités montés)", () => {
  it("supply et vulnerability ne tombent plus au défaut bas 0.4", () => {
    expect(SUBTYPE_BUSINESS.supply).toBe(0.85);
    expect(SUBTYPE_BUSINESS.vulnerability).toBe(0.8);
    expect(SUBTYPE_BUSINESS.cve).toBe(0.8);
    // une CVE reste sous un AO mais bien au-dessus du défaut 0.4
    expect(SUBTYPE_BUSINESS.vulnerability).toBeGreaterThan(0.6);
  });
});

describe("proximiteFactor (Action 5.1 — dueDate → prox enum → date freshness → 0.3)", () => {
  const now = Date.parse("2026-07-02T00:00:00Z");

  it("returns 1.0 when dueDate is within 7 days", () => {
    expect(proximiteFactor({ dueDate: "2026-07-05" }, now)).toBe(1.0);
  });
  it("penalizes overdue dueDates to 0.15 (anti-obsolescence — no longer clamped to 1.0)", () => {
    expect(proximiteFactor({ dueDate: "2026-06-01" }, now)).toBe(0.15); // échéance dépassée = périmée
    expect(proximiteFactor({ dueDate: "2025-07-02" }, now)).toBe(0.15); // il y a un an
  });
  it("returns 0.3 when dueDate is 90+ days out", () => {
    expect(proximiteFactor({ dueDate: "2026-12-01" }, now)).toBe(0.3);
  });
  it("linearly decays between 7 and 90 days", () => {
    const v = proximiteFactor({ dueDate: "2026-08-01" }, now); // ~30 days out
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(1.0);
  });

  it("maps the prox enum via PROX_TABLE when no dueDate is present", () => {
    expect(proximiteFactor({ prox: "imminent" }, now)).toBe(1.0);
    expect(proximiteFactor({ prox: "court" }, now)).toBe(0.75);
    expect(proximiteFactor({ prox: "moyen" }, now)).toBe(0.5);
    expect(proximiteFactor({ prox: "horizon" }, now)).toBe(0.25);
    expect(PROX_TABLE.imminent).toBe(1.0);
  });
  it("gives dueDate priority over the prox enum", () => {
    // dueDate 5 months out (0.3) beats a claimed prox=imminent (1.0)...
    expect(proximiteFactor({ dueDate: "2026-12-01", prox: "imminent" }, now)).toBe(0.3);
    // ...and an imminent dueDate beats a claimed prox=horizon.
    expect(proximiteFactor({ dueDate: "2026-07-04", prox: "horizon" }, now)).toBe(1.0);
  });
  it("ignores an unknown prox value and falls through to the date fallback", () => {
    expect(proximiteFactor({ prox: "nonsense" }, now)).toBe(0.3);
    expect(proximiteFactor({ prox: "nonsense", date: "2026-07-01" }, now)).toBe(0.5);
  });

  it("caps the freshness fallback at 0.5: a merely fresh item is no longer 'imminent'", () => {
    // date 3 days before now — pre-audit this returned 1.0 (the inversion bug).
    expect(proximiteFactor({ date: "2026-06-29" }, now)).toBe(0.5);
  });
  it("decays the freshness fallback down to 0.3 at 90+ days", () => {
    expect(proximiteFactor({ date: "2026-01-01" }, now)).toBe(0.3);
    const v = proximiteFactor({ date: "2026-06-01" }, now); // ~31 days old
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(0.5);
  });
  it("returns 0.3 when neither dueDate, prox nor date is usable", () => {
    expect(proximiteFactor({}, now)).toBe(0.3);
    expect(proximiteFactor(null, now)).toBe(0.3);
  });
});

describe("computePriorityScore (barème audité)", () => {
  const now = Date.parse("2026-07-02T00:00:00Z");

  it("scores the plan's reference AO at ~74: BCEAO tender, imminent, watchlist, C3 (was ~53 pre-audit)", () => {
    const score = computePriorityScore(
      {
        impact: "high",
        sourceRating: "C3",
        axis: "clients_prospects",
        subtype: "tender",
        stance: "opportunity",
        ent: "BCEAO",
        dueDate: "2026-07-05",
      },
      now
    );
    // (0.4 + 0.6×0.6) × (0.30×1 + 0.25×1 + 0.20×1 + 0.15×1 + 0.10×0.7) = 0.76 × 0.97 → 74
    expect(score).toBe(74);
  });

  it("scores the plan's reference fresh tech brief at ~64 (was ~84 pre-audit)", () => {
    const score = computePriorityScore(
      { impact: "high", sourceRating: "A1", axis: "tech", date: "2026-07-01" },
      now
    );
    // 1.0 × (0.30×1 + 0.25×0.5 + 0.20×0.4 + 0.15×0.45 + 0.10×0.7) = 0.6425 → 64
    expect(score).toBe(64);
  });

  it("fixes the audited inversion: imminent watchlist tender (C3) outranks a fresh A1 tech brief", () => {
    const tender = computePriorityScore(
      {
        impact: "high",
        sourceRating: "C3",
        axis: "clients_prospects",
        subtype: "tender",
        stance: "opportunity",
        ent: "BCEAO",
        dueDate: "2026-07-05",
      },
      now
    );
    const techBrief = computePriorityScore(
      { impact: "high", sourceRating: "A1", axis: "tech", date: "2026-07-01" },
      now
    );
    expect(tender).toBeGreaterThan(techBrief);
  });

  it("applies the credibility floor: even F5 keeps 40% of the business score", () => {
    const item = {
      impact: "high",
      axis: "clients_prospects",
      subtype: "tender",
      stance: "opportunity",
      ent: "BCEAO",
      dueDate: "2026-07-05",
    };
    const a1 = computePriorityScore({ ...item, sourceRating: "A1" }, now);
    const f5 = computePriorityScore({ ...item, sourceRating: "F5" }, now);
    expect(a1).toBe(97);
    // (0.4 + 0.6×0.2) × 0.97 = 0.52 × 0.97 → 50 (not 0.2 × 97 ≈ 19 as pre-audit)
    expect(f5).toBe(50);
    expect(f5).toBeGreaterThanOrEqual(Math.round(a1 * 0.4));
  });

  it("scores a strong, credible, imminent, aligned signal near the top of 0-100", () => {
    const score = computePriorityScore(
      { impact: "high", sourceRating: "A1", axis: "clients_prospects", dueDate: "2026-07-03" },
      now
    );
    // 1.0 × (0.30 + 0.25 + 0.20×0.4 + 0.15×0.9 + 0.07) = 0.835 → 84 (clients_prospects aligné 0.9 depuis le rééquilibrage géo 2026-07)
    expect(score).toBe(84);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it("scores a weak, low-credibility, distant signal near the bottom", () => {
    const score = computePriorityScore(
      { impact: "low", sourceRating: "F5", axis: "tech", dueDate: "2027-06-01" },
      now
    );
    // 0.52 × (0.30×0.3 + 0.25×0.3 + 0.20×0.4 + 0.15×0.45 + 0.07) = 0.52 × 0.3825 → 20
    expect(score).toBe(20);
    expect(score).toBeLessThan(25);
  });

  it("is always clamped to the [0,100] integer range", () => {
    const top = computePriorityScore(
      {
        impact: "high",
        sourceRating: "A1",
        axis: "clients_prospects",
        subtype: "tender",
        stance: "opportunity",
        budgetIdentified: true,
        ent: "BCEAO",
        dueDate: "2026-07-03",
      },
      now
    );
    expect(Number.isInteger(top)).toBe(true);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(100);
    const bottom = computePriorityScore({ impact: "low", sourceRating: "F5" }, now);
    expect(Number.isInteger(bottom)).toBe(true);
    expect(bottom).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(100);
  });

  it("handles a completely empty item without throwing (all factors fall back to defaults)", () => {
    expect(() => computePriorityScore({}, now)).not.toThrow();
    const score = computePriorityScore({}, now);
    // (0.4 + 0.6×0.5) × (0.30×0.6 + 0.25×0.3 + 0.20×0.4 + 0.15×0.6 + 0.07) = 0.7 × 0.495 → 35
    expect(score).toBe(35);
  });

  it("accountValueFactor : bonus multiplicatif hors barème (neutre à 0, +15% au max), sans casser le barème", () => {
    const item = { impact: "high", sourceRating: "A1", axis: "clients_prospects", dueDate: "2026-07-03" };
    const base = computePriorityScore(item, now);
    // accountValue=0 (défaut) → identique au barème.
    expect(computePriorityScore(item, now, { accountValue: 0 })).toBe(base);
    expect(computePriorityScore(item, now, {})).toBe(base);
    // Gros compte (accountValue=1) → score relevé (+ jusqu'à 15%), borné à 100.
    const boosted = computePriorityScore(item, now, { accountValue: 1 });
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeLessThanOrEqual(100);
    // Valeur intermédiaire → boost intermédiaire (monotone).
    const mid = computePriorityScore(item, now, { accountValue: 0.5 });
    expect(mid).toBeGreaterThanOrEqual(base);
    expect(mid).toBeLessThanOrEqual(boosted);
  });

  it("higher impact strictly increases the score, all else equal", () => {
    const base = { sourceRating: "B3", axis: "tech", dueDate: "2026-07-03" };
    const low = computePriorityScore({ ...base, impact: "low" }, now);
    const high = computePriorityScore({ ...base, impact: "high" }, now);
    expect(high).toBeGreaterThan(low);
  });
});

describe("rééquilibrage 2026-07 — mouvements d'acteurs et géographie", () => {
  it("valorise implantation/market_entry/expansion dans le facteur business", async () => {
    const { businessFactor, SUBTYPE_BUSINESS } = await import("../domain/scoring.js");
    expect(SUBTYPE_BUSINESS.implantation).toBe(0.75);
    expect(SUBTYPE_BUSINESS.market_entry).toBe(0.7);
    expect(SUBTYPE_BUSINESS.expansion).toBe(0.65);
    expect(businessFactor({ subtype: "implantation", stance: "opportunity" })).toBeCloseTo(0.85);
  });

  it("bonus géographique : ci > afrique_ouest > mondial, clampé à 1", async () => {
    const { alignementFactor } = await import("../domain/scoring.js");
    const ci = alignementFactor({ axis: "concurrents", geo: "ci" });
    const ao = alignementFactor({ axis: "concurrents", geo: "afrique_ouest" });
    const world = alignementFactor({ axis: "concurrents" });
    expect(ci).toBeCloseTo(0.75);
    expect(ao).toBeCloseTo(0.68);
    expect(world).toBeCloseTo(0.6);
    // clamp : base 0.9 + ent 0.2 + ci 0.15 → 1
    expect(alignementFactor({ axis: "clients_prospects", ent: "BCEAO", geo: "ci" })).toBe(1);
  });
});

describe("proximiteFactor — anti-obsolescence sur le label prox (audit 2026-07)", () => {
  const now = Date.parse("2026-07-02T00:00:00Z");
  it("un « imminent » ancien (>180 j, sans échéance future) est déclassé à l'horizon (0.25), pas 1.0", () => {
    expect(proximiteFactor({ prox: "imminent", date: "2025-01-01" }, now)).toBe(0.25);
    expect(proximiteFactor({ prox: "court", date: "2024-06-01" }, now)).toBe(0.25);
  });
  it("un item marqué stale est déclassé quelle que soit sa date", () => {
    expect(proximiteFactor({ prox: "imminent", stale: true, date: "2026-07-01" }, now)).toBe(0.25);
  });
  it("un « imminent » récent reste à 1.0", () => {
    expect(proximiteFactor({ prox: "imminent", date: "2026-07-01" }, now)).toBe(1.0);
  });
});
