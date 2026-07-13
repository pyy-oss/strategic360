"use strict";

/**
 * Tests unitaires purs pour functions/domain/pipeline.js (cadence & pause des pipelines — maîtrise
 * des coûts Vertex/Cloud Run). Aucune I/O.
 *
 * Run: npx vitest run test/pipeline.domain.test.js
 */

import { describe, it, expect } from "vitest";
import {
  PIPELINE_KEYS,
  MAX_INTERVAL_MINUTES,
  pipelineThrottleDecision,
  sanitizePipelineIntervals,
} from "../domain/pipeline.js";

const NOW = new Date("2026-07-13T10:00:00Z").getTime();

describe("pipelineThrottleDecision", () => {
  it("exécute par défaut quand la config est vide", () => {
    expect(pipelineThrottleDecision({ cfg: {}, key: "evaluate", nowMs: NOW })).toEqual({ run: true, reason: "ok" });
    expect(pipelineThrottleDecision({ cfg: null, key: "sync", nowMs: NOW }).run).toBe(true);
  });

  it("bloque tout pipeline quand paused===true", () => {
    const d = pipelineThrottleDecision({ cfg: { paused: true }, key: "evaluate", nowMs: NOW });
    expect(d).toEqual({ run: false, reason: "paused" });
  });

  it("throttle si le dernier run est plus récent que l'intervalle", () => {
    const cfg = { intervals: { evaluate: 180 }, lastRunMs: { evaluate: NOW - 60 * 60000 } }; // 60 min < 180
    const d = pipelineThrottleDecision({ cfg, key: "evaluate", nowMs: NOW });
    expect(d.run).toBe(false);
    expect(d.reason).toBe("throttled");
    expect(d.minMin).toBe(180);
    expect(d.elapsedMin).toBe(60);
  });

  it("exécute si l'intervalle est écoulé", () => {
    const cfg = { intervals: { evaluate: 180 }, lastRunMs: { evaluate: NOW - 200 * 60000 } }; // 200 > 180
    expect(pipelineThrottleDecision({ cfg, key: "evaluate", nowMs: NOW }).run).toBe(true);
  });

  it("intervalle 0 = cadence native (jamais throttlé)", () => {
    const cfg = { intervals: { sync: 0 }, lastRunMs: { sync: NOW - 1000 } };
    expect(pipelineThrottleDecision({ cfg, key: "sync", nowMs: NOW }).run).toBe(true);
  });

  it("sans lastRun, exécute même si un intervalle est défini (premier run)", () => {
    const cfg = { intervals: { enrich: 1440 } };
    expect(pipelineThrottleDecision({ cfg, key: "enrich", nowMs: NOW }).run).toBe(true);
  });

  it("un intervalle sur une autre clé n'affecte pas la clé demandée", () => {
    const cfg = { intervals: { sync: 999999 }, lastRunMs: { sync: NOW } };
    expect(pipelineThrottleDecision({ cfg, key: "evaluate", nowMs: NOW }).run).toBe(true);
  });
});

describe("sanitizePipelineIntervals", () => {
  it("ne garde que les clés connues, arrondit et plafonne", () => {
    const out = sanitizePipelineIntervals({ evaluate: "180", sync: 12.7, inconnu: 5, briefing: 10 });
    expect(out).toEqual({ evaluate: 180, sync: 13, briefing: 10 });
    expect("inconnu" in out).toBe(false);
  });
  it("rejette les valeurs négatives ou non numériques, accepte 0", () => {
    const out = sanitizePipelineIntervals({ evaluate: -5, sync: "abc", aggregate: 0 });
    expect(out).toEqual({ aggregate: 0 });
  });
  it("plafonne à MAX_INTERVAL_MINUTES", () => {
    expect(sanitizePipelineIntervals({ enrich: 999999999 }).enrich).toBe(MAX_INTERVAL_MINUTES);
  });
  it("gère une entrée non-objet", () => {
    expect(sanitizePipelineIntervals(null)).toEqual({});
    expect(sanitizePipelineIntervals("x")).toEqual({});
  });
});

describe("PIPELINE_KEYS", () => {
  it("expose les 5 pipelines pilotables", () => {
    expect(PIPELINE_KEYS).toEqual(["sync", "evaluate", "aggregate", "enrich", "briefing"]);
  });
});
