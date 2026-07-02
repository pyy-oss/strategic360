"use strict";

/**
 * Domain logic: strategic simulator (`simCompute`).
 * Ported identically from docs/maquette_reference.jsx / docs/BUILD_KIT.md §8.2, so client
 * (web/src/modules/veille/data.ts) and server (Cloud Functions) share the exact same formulas.
 * V0: exported for reuse; not yet called by any Function body (see index.js TODOs / roadmap V5).
 */

const SIM_BASE = {
  cas: 8000,
  recurrent: 1500,
  margePct: 0.21,
  winBase: 62,
  pipe: 13780,
  ambition: 15300,
  objMarge: 0.24,
};

const SCEN_OPTS = [
  { k: "central", l: "Central (pondéré)", cloud: 1.0, mp: 1.0 },
  { k: "s1", l: "Souveraineté forte × prix élevés (favorable)", cloud: 1.2, mp: 0.7 },
  { k: "s2", l: "Souveraineté forte × prix agressifs", cloud: 1.1, mp: 1.3 },
  { k: "s3", l: "Souveraineté faible × prix agressifs (adverse)", cloud: 0.7, mp: 1.3 },
  { k: "s0", l: "Souveraineté faible × prix élevés", cloud: 0.8, mp: 0.8 },
];

/**
 * @param {{managed:number,cloud:number,aoBad:number,win:number,newAcc:number,mix:number,
 *   tarif:number,attrition:number,invest:number,horizon:number,scenario:string}} p
 */
function simCompute(p) {
  const { managed, cloud, aoBad, win, newAcc, mix, tarif, attrition, invest, horizon, scenario } = p;
  const ramp = horizon / 3;
  const scen = SCEN_OPTS.find((s) => s.k === scenario) || SCEN_OPTS[0];
  const addManaged = (managed / 100) * 2500 * ramp;
  const addCloud = (cloud / 100) * 1800 * ramp * scen.cloud;
  const addAO = (aoBad / 100) * 3500 * ramp;
  const addWin = ((win - SIM_BASE.winBase) / 100) * SIM_BASE.pipe * 0.3;
  const addNew = (newAcc / 100) * 1500 * ramp;
  const lossAttr = (attrition / 100) * 1400;
  const revenu = SIM_BASE.cas + addManaged + addCloud + addAO + addWin + addNew - lossAttr;
  const recurrent = SIM_BASE.recurrent + addManaged + 0.6 * addCloud;
  const recShare = recurrent / revenu;
  const baseShare = SIM_BASE.recurrent / SIM_BASE.cas;
  let margin =
    0.21 +
    (mix / 100) * 0.06 +
    Math.max(recShare - baseShare, 0) * 0.25 -
    (tarif / 100) * 0.05 * scen.mp -
    (invest / 100) * 0.02;
  margin = Math.max(0.1, Math.min(0.45, margin));
  const margeVal = revenu * margin;
  const sC = Math.min(revenu / SIM_BASE.ambition, 1.2) / 1.2;
  const sM = Math.min(margin / SIM_BASE.objMarge, 1.2) / 1.2;
  const sR = Math.min(recShare / 0.35, 1);
  const sRes = Math.max(0, 1 - (attrition + tarif) / 200);
  const score = Math.max(0, Math.min(100, Math.round(100 * (0.4 * sC + 0.25 * sM + 0.2 * sR + 0.15 * sRes))));
  const tension = Math.max(0, Math.min(1, ((addAO + addWin) * 0.5) / SIM_BASE.cas + (invest / 100) * 0.3 - recShare * 0.2));
  const steps = [
    { name: "CAS base", kind: "start", v: SIM_BASE.cas },
    { name: "Managed", d: addManaged },
    { name: "Cloud", d: addCloud },
    { name: "AO/BAD", d: addAO },
    { name: "Win rate", d: addWin },
    { name: "Nvx comptes", d: addNew },
    { name: "Attrition", d: -lossAttr },
    { name: "Projeté", kind: "end", v: revenu },
  ];
  let cum = 0;
  const wf = steps.map((b) => {
    if (b.kind) {
      cum = b.v;
      return { name: b.name, base: 0, pos: b.v, neg: 0, kind: b.kind };
    }
    const d = b.d;
    const base = d >= 0 ? cum : cum + d;
    cum += d;
    return { name: b.name, base, pos: d >= 0 ? d : 0, neg: d < 0 ? -d : 0 };
  });
  const traj = [];
  for (let y = 0; y <= horizon; y++) {
    traj.push({ y: "An " + y, v: Math.round(SIM_BASE.cas + (revenu - SIM_BASE.cas) * (y / horizon)) });
  }
  return { revenu, recurrent, recShare, margin, margeVal, score, tension, wf, traj, delta: revenu - SIM_BASE.cas };
}

module.exports = { simCompute, SIM_BASE, SCEN_OPTS };
