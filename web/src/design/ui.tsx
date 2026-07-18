import React from "react";
import { T } from "./tokens";

/** Shared UI primitives — ported verbatim (same props/rendering) from docs/maquette_reference.jsx */

export interface EyebrowProps {
  children: React.ReactNode;
  color?: string;
}
export const Eyebrow: React.FC<EyebrowProps> = ({ children, color }) => (
  <div
    style={{
      fontSize: 11,
      letterSpacing: ".13em",
      textTransform: "uppercase",
      color: color || T.faint,
      fontWeight: 600,
    }}
  >
    {children}
  </div>
);

export interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export const Card: React.FC<CardProps> = ({ children, style }) => (
  <div
    style={{
      background: T.panel,
      border: `1px solid ${T.line}`,
      borderRadius: 16,
      padding: 18,
      ...style,
    }}
  >
    {children}
  </div>
);

export interface KpiProps {
  label: React.ReactNode;
  value: React.ReactNode;
  accent?: string;
  sub?: React.ReactNode;
}
export const Kpi: React.FC<KpiProps> = ({ label, value, accent, sub }) => (
  <div>
    <Eyebrow>{label}</Eyebrow>
    <div
      style={{
        fontFamily: "'Bricolage Grotesque',sans-serif",
        fontSize: 24,
        fontWeight: 700,
        color: accent || T.ink,
        marginTop: 6,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.05,
      }}
    >
      {value}
    </div>
    {sub && <div style={{ fontSize: 11.5, color: T.dim, marginTop: 4 }}>{sub}</div>}
  </div>
);

export interface BadgeProps {
  children: React.ReactNode;
  c?: string;
}
export const Badge: React.FC<BadgeProps> = ({ children, c }) => (
  <span
    style={{
      fontSize: 10.5,
      padding: "2px 7px",
      borderRadius: 999,
      background: (c || T.faint) + "22",
      color: c || T.faint,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

/**
 * Bandeau d'ERREUR de chargement (audit UX 2026-07) — à afficher quand un abonnement Firestore
 * échoue (permission refusée, index manquant, réseau). Sans lui, les vues retombaient sur l'état
 * « aucun résultat », faisant passer une PANNE pour une absence de données. Message distinct + tonalité
 * d'alerte pour lever l'ambiguïté. `error` null → n'affiche rien (usage : {error && <LoadError error={error}/>}).
 */
export interface LoadErrorProps {
  error: Error | null | undefined;
  what?: string; // ex. "les fiches de veille"
  style?: React.CSSProperties;
}
export const LoadError: React.FC<LoadErrorProps> = ({ error, what, style }) => {
  if (!error) return null;
  const denied = /permission|insufficient|denied/i.test(error.message || "");
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        gap: 9,
        alignItems: "flex-start",
        background: T.clay + "18",
        border: `1px solid ${T.clay}55`,
        borderRadius: 12,
        padding: "11px 13px",
        fontSize: 12.5,
        color: T.ink,
        ...style,
      }}
    >
      <span aria-hidden style={{ color: T.clay, fontSize: 15, lineHeight: 1.1, flexShrink: 0 }}>⚠</span>
      <div>
        <div style={{ fontWeight: 600, color: T.clay }}>
          Impossible de charger {what || "les données"}.
        </div>
        <div style={{ color: T.dim, marginTop: 3 }}>
          {denied
            ? "Accès refusé — votre profil n'a peut-être pas les droits sur cette section."
            : "Une erreur est survenue (réseau ou service). Réessayez ; si cela persiste, contactez un administrateur."}
        </div>
      </div>
    </div>
  );
};

export interface TipProps {
  active?: boolean;
  payload?: Array<{ payload?: any }>;
}
export function Tip({ active, payload }: TipProps) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0] && payload[0].payload;
  return (
    <div
      style={{
        background: T.panel2,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        padding: "8px 11px",
        fontSize: 12,
        color: T.ink,
      }}
    >
      {p && (p.n || p.force || p.f)}
    </div>
  );
}

export interface SliderProps {
  label: React.ReactNode;
  val: number;
  set: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  color?: string;
  hint?: React.ReactNode;
}
export function Slider({
  label,
  val,
  set,
  min = 0,
  max = 100,
  step = 1,
  unit = "%",
  color,
  hint,
}: SliderProps) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: T.dim }}>{label}</span>
        <span style={{ color: color || T.ink, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {val}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => set(Number(e.target.value))}
        style={{ width: "100%", accentColor: color || T.gold, cursor: "pointer" }}
      />
      {hint && <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export interface GaugeProps {
  score: number;
}
export function Gauge({ score }: GaugeProps) {
  const c = score >= 70 ? T.emerald : score >= 45 ? T.gold : T.clay;
  const R = 52,
    circ = 2 * Math.PI * R,
    off = circ * (1 - score / 100);
  return (
    <div style={{ position: "relative", width: 130, height: 130, margin: "0 auto" }}>
      <svg viewBox="0 0 130 130" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="65" cy="65" r={R} fill="none" stroke={T.line} strokeWidth="11" />
        <circle
          cx="65"
          cy="65"
          r={R}
          fill="none"
          stroke={c}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={off}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 700,
              fontSize: 30,
              color: c,
              lineHeight: 1,
            }}
          >
            {score}
          </div>
          <div style={{ fontSize: 9.5, color: T.faint, letterSpacing: ".1em" }}>/ 100</div>
        </div>
      </div>
    </div>
  );
}

export interface SparkProps {
  data: number[];
  color: string;
  w?: number;
  h?: number;
}
export function Spark({ data, color, w = 96, h = 28 }: SparkProps) {
  const max = Math.max(...data),
    min = Math.min(...data),
    rng = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * (h - 4) - 2}`)
    .join(" ");
  const lx = w,
    ly = h - ((data[data.length - 1] - min) / rng) * (h - 4) - 2;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.6" fill={color} />
    </svg>
  );
}
