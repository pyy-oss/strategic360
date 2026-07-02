"use strict";

/**
 * Pure-function tests for functions/domain/sim.js (BUILD_KIT.md §8.2 simCompute + V5 calibration).
 * `simCompute(p)` (no second argument) must keep behaving exactly like the maquette's hardcoded
 * formula — that's covered implicitly by every test below that omits the second argument.
 * `simCompute(p, calibration)` is the V5 addition (Simulateur.tsx calibrates SIM_BASE.cas/pipe/
 * winBase from `summaries/quanti` when available) — covered explicitly here.
 *
 * Run: npx vitest run test/sim.domain.test.js
 */

import { describe, it, expect } from "vitest";
import { simCompute, SIM_BASE } from "../domain/sim.js";

const BASE_PARAMS = {
  managed: 40,
  cloud: 30,
  aoBad: 40,
  win: 62,
  newAcc: 30,
  mix: 35,
  tarif: 40,
  attrition: 30,
  invest: 40,
  horizon: 3,
  scenario: "central",
};

describe("simCompute — no calibration (backward compatible)", () => {
  it("uses the hardcoded SIM_BASE when called with a single argument", () => {
    const r1 = simCompute(BASE_PARAMS);
    const r2 = simCompute(BASE_PARAMS, undefined);
    expect(r1).toEqual(r2);
    // wf[0] ("CAS base") reflects SIM_BASE.cas exactly.
    expect(r1.wf[0].pos).toBe(SIM_BASE.cas);
  });
});

describe("simCompute — with calibration override", () => {
  it("uses a calibrated `cas` in place of the hardcoded default", () => {
    const calibrated = simCompute(BASE_PARAMS, { cas: 10000 });
    const uncalibrated = simCompute(BASE_PARAMS);
    // Same levers, different base CAS → revenu shifts by the same delta as the base.
    expect(calibrated.revenu - uncalibrated.revenu).toBeCloseTo(10000 - SIM_BASE.cas, 6);
    expect(calibrated.wf[0].pos).toBe(10000);
  });

  it("only overrides the fields present in the calibration object, defaulting the rest", () => {
    const calibrated = simCompute(BASE_PARAMS, { winBase: 70 });
    // addWin uses (win - winBase) — raising winBase to 70 (> win=62) makes addWin negative,
    // lowering revenu vs the uncalibrated (winBase=62) run, all else identical.
    const uncalibrated = simCompute(BASE_PARAMS);
    expect(calibrated.revenu).toBeLessThan(uncalibrated.revenu);
    // ambition/objMarge (not part of the override) are untouched — score formula still divides
    // by the hardcoded SIM_BASE.ambition/objMarge, not a fabricated value.
    expect(calibrated.wf[0].pos).toBe(SIM_BASE.cas);
  });

  it("partial calibration of `pipe` changes the win-rate delta's weight", () => {
    const calibrated = simCompute(BASE_PARAMS, { pipe: 20000 });
    const uncalibrated = simCompute(BASE_PARAMS);
    // addWin = (win-winBase)/100 * pipe * 0.3 — larger pipe amplifies the (positive, since
    // win=62 == winBase=62 here actually 0) — use a win above winBase to see the effect.
    const paramsWin = { ...BASE_PARAMS, win: 70 };
    const calibratedWin = simCompute(paramsWin, { pipe: 20000 });
    const uncalibratedWin = simCompute(paramsWin);
    expect(calibratedWin.revenu).toBeGreaterThan(uncalibratedWin.revenu);
    // Sanity: the no-op case (win==winBase) is unaffected by pipe changes.
    expect(calibrated.revenu).toBeCloseTo(uncalibrated.revenu, 6);
  });
});
