/**
 * Design tokens — "Forest & Gold" theme.
 * Ported verbatim from docs/maquette_reference.jsx (source of truth for appearance).
 */

export const T = {
  bg: "#0E1613",
  panel: "#151F1A",
  panel2: "#1B2721",
  line: "#26352D",
  ink: "#EEF3EF",
  dim: "#8FA89B",
  faint: "#5E7268",
  gold: "#C9A24B",
  emerald: "#46C08A",
  clay: "#D9694C",
  steel: "#6E9DC0",
  plum: "#A98AC4",
} as const;

export interface AxisMeta {
  l: string;
  c: string;
}

export const AX: Record<string, AxisMeta> = {
  partenaires: { l: "Partenaires", c: "#6E9DC0" },
  concurrents: { l: "Concurrents", c: "#D9694C" },
  clients_prospects: { l: "Clients & Prospects", c: "#46C08A" },
  tech: { l: "Tendances Tech", c: "#A98AC4" },
  reglementaire: { l: "Réglementaire", c: "#C9A24B" },
};

export const IMP: Record<string, AxisMeta> = {
  high: { l: "Fort", c: "#D9694C" },
  medium: { l: "Moyen", c: "#C9A24B" },
  low: { l: "Faible", c: "#5E7268" },
};

export const STANCE: Record<string, AxisMeta> = {
  opportunity: { l: "Opportunité", c: "#46C08A" },
  threat: { l: "Menace", c: "#D9694C" },
  neutral: { l: "Neutre", c: "#8FA89B" },
};

export interface RingMeta {
  l: string;
  c: string;
  r: number;
}

export const RING: Record<string, RingMeta> = {
  adopter: { l: "Adopter", c: "#46C08A", r: 0.28 },
  essayer: { l: "Essayer", c: "#6E9DC0", r: 0.5 },
  evaluer: { l: "Évaluer", c: "#C9A24B", r: 0.72 },
  suspendre: { l: "Suspendre", c: "#D9694C", r: 0.92 },
};

export const QCOL: Record<string, string> = {
  Vedette: T.emerald,
  "Vache à lait": T.gold,
  Dilemme: T.steel,
  "Poids mort": T.faint,
};

export const STCOL: Record<string, string> = {
  ok: T.emerald,
  warn: T.gold,
  alert: T.clay,
};

export interface CatMeta {
  l: string;
  c: string;
  q: number;
}

export const ECAT: Record<string, CatMeta> = {
  marche: { l: "Acteurs & marché", c: T.steel, q: 0 },
  sectoriel: { l: "Sectoriel", c: T.emerald, q: 1 },
  tech: { l: "Technologique", c: T.plum, q: 2 },
  regpays: { l: "Réglementaire & pays", c: T.gold, q: 3 },
};

export interface ProxMeta {
  l: string;
  r: number;
}

export const PROX: Record<string, ProxMeta> = {
  imminent: { l: "Imminent", r: 0.3 },
  court: { l: "Court terme", r: 0.52 },
  moyen: { l: "Moyen terme", r: 0.74 },
  horizon: { l: "Horizon", r: 0.94 },
};

export const QUAD_TECH = ["Cybersécurité", "Cloud & Infra", "Data & IA", "Réseau"];

export const AMBITION_LABEL = "CAS annualisé — trajectoire 3 ans (illustratif)";

export const zColor = (a: number, s: number): string => {
  const t = a + s;
  return t >= 4.2 ? T.emerald : t >= 2.6 ? T.gold : T.clay;
};

export const fmt = (v: number): string => {
  v = Number(v) || 0;
  const s = v < 0 ? "-" : "";
  v = Math.abs(v);
  if (v >= 1e9) return s + (v / 1e9).toFixed(2) + " Md";
  if (v >= 1e6) return s + (v / 1e6).toFixed(0) + " M";
  if (v >= 1e3) return s + (v / 1e3).toFixed(0) + " k";
  return s + v.toFixed(0);
};

export const pct = (v: number): string => Math.round((Number(v) || 0) * 100) + " %";
