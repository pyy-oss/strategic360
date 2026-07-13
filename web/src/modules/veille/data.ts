/**
 * Static app constants for the Veille module.
 *
 * All fictional/maquette SAMPLE DATA has been removed — views read live Firestore data
 * (lib/intel.ts, lib/summaries.ts, lib/quanti.ts, lib/execution.ts, lib/innovation.ts,
 * lib/frameworks.ts, lib/briefings.ts) and render explicit empty states until real data exists.
 *
 * What remains here is NOT sample data:
 *   - the strategic simulator's calibration defaults + domain logic (`SIM_BASE`/`SCEN_OPTS`/
 *     `LEVMETA`/`PRESETS`/`simCompute`) — a client-side what-if engine, calibrated from
 *     `summaries/quanti` when available (see Simulateur.tsx);
 *   - the Eisenhower `quadrant()` helper (PlanAction.tsx);
 *   - navigation / lens definitions (`NAV`/`LENS`).
 */
import { T } from "../../design/tokens";

/* ---- Simulateur stratégique ---- */
export const SIM_BASE = {
  cas: 8000,
  recurrent: 1500,
  margePct: 0.21,
  winBase: 62,
  pipe: 13780,
  ambition: 15300,
  objMarge: 0.24,
};

export interface ScenOpt {
  k: string;
  l: string;
  cloud: number;
  mp: number;
}

export const SCEN_OPTS: ScenOpt[] = [
  { k: "central", l: "Central (pondéré)", cloud: 1.0, mp: 1.0 },
  { k: "s1", l: "Souveraineté forte × prix élevés (favorable)", cloud: 1.2, mp: 0.7 },
  { k: "s2", l: "Souveraineté forte × prix agressifs", cloud: 1.1, mp: 1.3 },
  { k: "s3", l: "Souveraineté faible × prix agressifs (adverse)", cloud: 0.7, mp: 1.3 },
  { k: "s0", l: "Souveraineté faible × prix élevés", cloud: 0.8, mp: 0.8 },
];

export interface SimParams {
  managed: number;
  cloud: number;
  aoBad: number;
  win: number;
  newAcc: number;
  mix: number;
  tarif: number;
  attrition: number;
  invest: number;
  horizon: number;
  scenario: string;
}

export interface SimWfStep {
  name: string;
  base: number;
  pos: number;
  neg: number;
  kind?: "start" | "end";
}

export interface SimResult {
  revenu: number;
  recurrent: number;
  recShare: number;
  margin: number;
  margeVal: number;
  score: number;
  tension: number;
  wf: SimWfStep[];
  traj: { y: string; v: number }[];
  delta: number;
}

export type SimBase = typeof SIM_BASE;

/**
 * Domain logic — identical to functions/domain/sim.js (BUILD_KIT.md §8.2).
 * `calibration` is an optional partial override of `SIM_BASE` (V5, BUILD_KIT.md §11 "Simulateur |
 * summaries/quanti (calibrage) + état local"): any field omitted falls back to the hardcoded
 * `SIM_BASE` default — see `Simulateur.tsx` for how the calibrated base is built from
 * `summaries/quanti`.
 */
export function simCompute(p: SimParams, calibration?: Partial<SimBase>): SimResult {
  const base: SimBase = calibration ? { ...SIM_BASE, ...calibration } : SIM_BASE;
  const { managed, cloud, aoBad, win, newAcc, mix, tarif, attrition, invest, horizon, scenario } = p;
  const ramp = horizon / 3;
  const scen = SCEN_OPTS.find((s) => s.k === scenario) || SCEN_OPTS[0];
  const addManaged = (managed / 100) * 2500 * ramp;
  const addCloud = (cloud / 100) * 1800 * ramp * scen.cloud;
  const addAO = (aoBad / 100) * 3500 * ramp;
  const addWin = ((win - base.winBase) / 100) * base.pipe * 0.3;
  const addNew = (newAcc / 100) * 1500 * ramp;
  const lossAttr = (attrition / 100) * 1400;
  const revenu = base.cas + addManaged + addCloud + addAO + addWin + addNew - lossAttr;
  const recurrent = base.recurrent + addManaged + 0.6 * addCloud;
  const recShare = recurrent / revenu;
  const baseShare = base.recurrent / base.cas;
  let margin =
    0.21 + (mix / 100) * 0.06 + Math.max(recShare - baseShare, 0) * 0.25 - (tarif / 100) * 0.05 * scen.mp - (invest / 100) * 0.02;
  margin = Math.max(0.1, Math.min(0.45, margin));
  const margeVal = revenu * margin;
  const sC = Math.min(revenu / base.ambition, 1.2) / 1.2;
  const sM = Math.min(margin / base.objMarge, 1.2) / 1.2;
  const sR = Math.min(recShare / 0.35, 1);
  const sRes = Math.max(0, 1 - (attrition + tarif) / 200);
  const score = Math.max(0, Math.min(100, Math.round(100 * (0.4 * sC + 0.25 * sM + 0.2 * sR + 0.15 * sRes))));
  const tension = Math.max(0, Math.min(1, ((addAO + addWin) * 0.5) / base.cas + (invest / 100) * 0.3 - recShare * 0.2));
  const steps: { name: string; kind?: "start" | "end"; v?: number; d?: number }[] = [
    { name: "CAS base", kind: "start", v: base.cas },
    { name: "Managed", d: addManaged },
    { name: "Cloud", d: addCloud },
    { name: "AO/BAD", d: addAO },
    { name: "Win rate", d: addWin },
    { name: "Nvx comptes", d: addNew },
    { name: "Attrition", d: -lossAttr },
    { name: "Projeté", kind: "end", v: revenu },
  ];
  let cum = 0;
  const wf: SimWfStep[] = steps.map((b) => {
    if (b.kind) {
      cum = b.v as number;
      return { name: b.name, base: 0, pos: b.v as number, neg: 0, kind: b.kind };
    }
    const d = b.d as number;
    const rebase = d >= 0 ? cum : cum + d;
    cum += d;
    return { name: b.name, base: rebase, pos: d >= 0 ? d : 0, neg: d < 0 ? -d : 0 };
  });
  const traj: { y: string; v: number }[] = [];
  for (let y = 0; y <= horizon; y++) {
    traj.push({ y: "An " + y, v: Math.round(base.cas + (revenu - base.cas) * (y / horizon)) });
  }
  return { revenu, recurrent, recShare, margin, margeVal, score, tension, wf, traj, delta: revenu - base.cas };
}

export interface LevMeta {
  k: keyof SimParams;
  l: string;
  min: number;
  max: number;
}

export const LEVMETA: LevMeta[] = [
  { k: "managed", l: "Récurrent (SOC/Managed)", min: 0, max: 100 },
  { k: "cloud", l: "Cloud souverain", min: 0, max: 100 },
  { k: "aoBad", l: "Capture AO / BAD", min: 0, max: 100 },
  { k: "win", l: "Taux de conversion", min: 40, max: 80 },
  { k: "newAcc", l: "Nouveaux comptes", min: 0, max: 100 },
  { k: "mix", l: "Montée en gamme", min: 0, max: 100 },
  { k: "tarif", l: "Pression tarifaire", min: 0, max: 100 },
  { k: "attrition", l: "Attrition/concurrence", min: 0, max: 100 },
  { k: "invest", l: "Investissement", min: 0, max: 100 },
];

export const PRESETS: Record<string, SimParams> = {
  Prudent: { managed: 20, cloud: 15, aoBad: 25, win: 58, newAcc: 20, mix: 20, tarif: 60, attrition: 50, invest: 25, horizon: 3, scenario: "s3" },
  Base: { managed: 40, cloud: 30, aoBad: 40, win: 62, newAcc: 30, mix: 35, tarif: 40, attrition: 30, invest: 40, horizon: 3, scenario: "central" },
  Ambition: { managed: 80, cloud: 70, aoBad: 60, win: 70, newAcc: 60, mix: 70, tarif: 30, attrition: 20, invest: 70, horizon: 3, scenario: "s1" },
};

/* ---- Plan d'action : quadrant d'Eisenhower ---- */
export function quadrant(a: { imp: number; urg: number }): { l: string; c: string } {
  if (a.imp >= 4 && a.urg >= 4) return { l: "Faire maintenant", c: T.clay };
  if (a.imp >= 4 && a.urg < 4) return { l: "Planifier", c: T.emerald };
  if (a.imp < 4 && a.urg >= 4) return { l: "Traiter vite", c: T.gold };
  return { l: "Surveiller", c: T.faint };
}

/* ---- Navigation / focales ---- */
export const LENS: [string, string][] = [
  ["dg", "Vue DG (Board)"],
  ["strategie", "Vue Stratégie"],
  ["innovation", "Vue Innovation"],
];

export const NAV: [string, string][] = [
  ["radar", "Radar exécutif"],
  ["fil", "Fil de veille"],
  ["detection", "Radar de détection"],
  ["indicateurs", "Indicateurs avancés"],
  ["cadres", "Cadres stratégiques"],
  ["portefeuille", "Portefeuille & Croissance"],
  ["valeur", "Création de valeur"],
  ["simulateur", "Simulateur stratégique"],
  ["diagnostic", "Diagnostic"],
  ["innovation", "Tech Radar & Innovation"],
  ["concurrence", "Concurrence"],
  ["scenarios", "Scénarios"],
  ["execution", "Exécution & Décisions"],
  ["plan", "Plan d'action"],
  ["briefing", "Briefing exécutif"],
  ["copilote", "Copilote Commercial"],
  ["equipe", "Pilotage équipe"],
  ["onboarding", "Onboarding client"],
  ["reglages", "Réglages & Droits"],
];

/**
 * Mapping vue → module RBAC. La nav filtre chaque vue par `canRead(module)` (rbac.ts) : un profil
 * sans droit de lecture sur le module ne voit pas la vue. Les vues « veille » restent visibles par
 * tout profil (tous ont au moins `read` sur veille). `onboarding`/`reglages` sont gérés à part
 * (exec / direction). Miroir logique du remapping firestore.rules.
 */
export const VIEW_MODULE: Record<string, string> = {
  radar: "veille", fil: "veille", detection: "veille", briefing: "veille", concurrence: "veille", plan: "veille",
  indicateurs: "finance", portefeuille: "finance", valeur: "finance", simulateur: "finance",
  cadres: "strategie", diagnostic: "strategie", scenarios: "strategie", execution: "strategie",
  innovation: "innovation",
  copilote: "copilote", equipe: "copilote",
};

/**
 * Navigation GROUPÉE (16 vues sur une ligne débordaient et masquaient des vues) : 4 groupes logiques,
 * chacun ouvrant ses vues dans un menu. `home` = vue ouverte au clic sur le titre du groupe (raccourci).
 * Le libellé de chaque vue reste défini dans NAV (source unique).
 */
export const NAV_GROUPS: { label: string; home: string; items: string[] }[] = [
  { label: "Veille", home: "radar", items: ["radar", "fil", "detection", "briefing"] },
  { label: "Analyse", home: "indicateurs", items: ["indicateurs", "cadres", "diagnostic", "concurrence"] },
  { label: "Croissance", home: "portefeuille", items: ["portefeuille", "valeur", "simulateur", "scenarios", "innovation"] },
  { label: "Action", home: "copilote", items: ["copilote", "equipe", "plan", "execution"] },
  // Groupe EXEC/DG uniquement (paramétrage produit) — App.tsx masque onboarding aux non-exec et
  // reglages (éditeur de droits RBAC) à tous sauf la Direction.
  { label: "Config", home: "onboarding", items: ["onboarding", "reglages"] },
];
