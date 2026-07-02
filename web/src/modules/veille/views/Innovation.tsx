import React from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { T, RING, QUAD_TECH, pct } from "../../../design/tokens";
import { Eyebrow, Card, Tip, Badge } from "../../../design/ui";
import { RADAR_TECH as RADAR_TECH_STATIC, INNOV as INNOV_STATIC } from "../data";
import { riceScore, useInnovationPortfolio, useTechRadar } from "../lib/innovation";

/**
 * "Tech Radar & Innovation" — ported from `Innovation` in the maquette; data source swapped to
 * Firestore `techRadar` + `innovationPortfolio` (V6, BUILD_KIT.md §7: write restricted to
 * `direction`/`innovation`). Read-only for V6 (no contribution form) — see the phase report for
 * the read-only-vs-CRUD rationale; falls back to the static maquette sample (badged) per
 * collection when it's still empty, same convention used across the other V6 views.
 */
export function Innovation() {
  const R = 150,
    CX = 170,
    CY = 170;

  const { blips: liveBlips, loading: loadingRadar } = useTechRadar();
  const { bets: liveBets, loading: loadingInnov } = useInnovationPortfolio();

  const radarIsLive = !loadingRadar && liveBlips.length > 0;
  const innovIsLive = !loadingInnov && liveBets.length > 0;

  const RADAR_TECH = radarIsLive ? liveBlips.map((b) => ({ n: b.name, quad: b.quadrant, ring: b.ring, mom: b.momentum })) : RADAR_TECH_STATIC;
  const INNOV = innovIsLive ? liveBets.map((b) => ({ n: b.title, reach: b.reach, impact: b.impact, conf: b.confidence, effort: b.effort })) : INNOV_STATIC;

  const quadCount: Record<number, number> = {};
  RADAR_TECH.forEach((b) => {
    quadCount[b.quad] = (quadCount[b.quad] || 0) + 1;
  });
  const idxInQuad: Record<number, number> = {};
  const blips = RADAR_TECH.map((b) => {
    idxInQuad[b.quad] = idxInQuad[b.quad] || 0;
    const i = idxInQuad[b.quad]++;
    const n = quadCount[b.quad];
    const a0 = b.quad * 90 + (90 / (n + 1)) * (i + 1);
    const a = (a0 * Math.PI) / 180;
    const rad = RING[b.ring].r * R;
    return { ...b, x: CX + rad * Math.cos(a), y: CY - rad * Math.sin(a) };
  });
  const rice = INNOV.map((o) => ({ ...o, rice: riceScore({ reach: o.reach, impact: o.impact, confidence: o.conf, effort: o.effort }) }));
  return (
    <div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.plum}>Tech Radar</Eyebrow>
            <Badge c={radarIsLive ? T.emerald : T.faint}>{radarIsLive ? "Temps réel" : "Exemple"}</Badge>
          </div>
          <svg viewBox="0 0 340 360" style={{ width: "100%", height: 320, marginTop: 6 }}>
            {["suspendre", "evaluer", "essayer", "adopter"].map((r) => (
              <circle key={r} cx={CX} cy={CY} r={RING[r].r * R} fill="none" stroke={T.line} />
            ))}
            <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke={T.line} />
            <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke={T.line} />
            {QUAD_TECH.map((q, i) => {
              const a = ((i * 90 + 45) * Math.PI) / 180;
              return (
                <text key={i} x={CX + (R + 8) * Math.cos(a)} y={CY - (R + 8) * Math.sin(a)} fill={T.faint} fontSize="10" textAnchor="middle">
                  {q}
                </text>
              );
            })}
            {blips.map((b, i) => (
              <g key={i}>
                <circle cx={b.x} cy={b.y} r="5" fill={RING[b.ring].c} />
                <text x={b.x + 7} y={b.y + 3} fill={T.dim} fontSize="8.5">
                  {b.n}
                </text>
              </g>
            ))}
          </svg>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, justifyContent: "center" }}>
            {Object.keys(RING).map((r) => (
              <span key={r} style={{ color: T.dim }}>
                <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: RING[r].c, marginRight: 4 }} />
                {RING[r].l}
              </span>
            ))}
          </div>
        </Card>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.emerald}>Portefeuille d'innovation (RICE)</Eyebrow>
            <Badge c={innovIsLive ? T.emerald : T.faint}>{innovIsLive ? "Temps réel" : "Exemple"}</Badge>
          </div>
          <div style={{ height: 250, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 6, right: 16, top: 10, bottom: 16 }}>
                <CartesianGrid stroke={T.line} />
                <XAxis type="number" dataKey="effort" name="Effort" domain={[0, 10]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Effort →", position: "insideBottom", offset: -6, fill: T.dim, fontSize: 11 }} />
                <YAxis type="number" dataKey="impact" name="Impact" domain={[0, 10]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Impact →", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
                <ZAxis type="number" dataKey="rice" range={[120, 900]} />
                <Tooltip content={<Tip />} cursor={{ stroke: T.faint }} />
                <Scatter data={rice}>
                  {rice.map((o, i) => (
                    <Cell key={i} fill={o.effort <= o.impact ? T.emerald : T.gold} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 6, fontSize: 11.5, color: T.faint }}>Bulle = score RICE. Quadrant haut-gauche (impact fort / effort faible) = à lancer en priorité.</div>
        </Card>
      </div>
      <Card>
        <Eyebrow color={T.emerald}>Paris d'innovation — priorisation RICE</Eyebrow>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {[...rice]
            .sort((a, b) => b.rice - a.rice)
            .map((o, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "7px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none" }}>
                <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, color: T.emerald, minWidth: 40 }}>{o.rice}</div>
                <span style={{ flex: 1, color: T.ink }}>{o.n}</span>
                <span style={{ color: T.faint }}>
                  R{o.reach}·I{o.impact}·C{pct(o.conf)}·E{o.effort}
                </span>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
