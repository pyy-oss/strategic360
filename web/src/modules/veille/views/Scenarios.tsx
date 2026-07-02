import React from "react";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { SCENARIOS as SCENARIOS_STATIC, SCEN_PROB as SCEN_PROB_STATIC } from "../data";
import { useScenarios } from "../lib/execution";

/**
 * "Scénarios" — ported from `Scenarios` in the maquette; data source swapped to Firestore
 * `scenarios` (V6). Reads the first live scenario document (single active 2×2 matrix, matching
 * the maquette's one-scenario-set layout); falls back to the static maquette sample — with a
 * badge — when no `scenarios` doc exists yet, same "example vs. live" convention as
 * `Cadres.tsx`'s BCG tab (V4).
 */
export function Scenarios() {
  const { scenarios, loading } = useScenarios();
  const live = scenarios[0];
  const isLive = !!live;

  const axisX = live?.axisX ?? SCENARIOS_STATIC.axisX;
  const axisY = live?.axisY ?? SCENARIOS_STATIC.axisY;
  const w = live?.worlds ?? SCENARIOS_STATIC.worlds;
  const probs = live?.probs ?? SCEN_PROB_STATIC;
  void loading; // first paint renders the static example while the snapshot resolves — no spinner needed

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: T.dim }}>
          Planification par scénarios sur deux axes d'incertitude majeurs : <b style={{ color: T.ink }}>{axisY}</b> (vertical) × <b style={{ color: T.ink }}>{axisX}</b> (horizontal).
        </div>
        <Badge c={isLive ? T.emerald : T.faint}>{isLive ? "Scénario enregistré" : "Exemple — en attente d'un scénario saisi"}</Badge>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[1, 0, 3, 2].map((idx, pos) => (
          <Card key={pos} style={{ borderTop: `3px solid ${w[idx].c}`, minHeight: 150 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Eyebrow color={w[idx].c}>{w[idx].q}</Eyebrow>
              <Badge c={w[idx].c}>proba {pct(probs[pos] ?? 0)}</Badge>
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>{w[idx].d}</div>
            <div style={{ marginTop: 8, height: 6, background: T.panel2, borderRadius: 4 }}>
              <div style={{ width: `${(probs[pos] ?? 0) * 100}%`, height: "100%", background: w[idx].c, borderRadius: 4 }} />
            </div>
          </Card>
        ))}
      </div>
      <Card style={{ marginTop: 14 }}>
        <Eyebrow color={T.gold}>Espérance & stratégie robuste</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.7 }}>
          Le monde <b style={{ color: T.emerald }}>« Souveraineté forte × prix hyperscalers élevés » (40%)</b> est le plus probable et le plus favorable : il justifie d'<b style={{ color: T.ink }}>investir dès maintenant dans le cloud souverain et la cybersécurité</b>. Une <b style={{ color: T.ink }}>stratégie robuste</b> (gagnante dans ≥3 mondes sur 4) : <b style={{ color: T.ink }}>miser sur le managed/cyber différenciant</b>, qui reste porteur même si les hyperscalers pressent les prix.
        </div>
      </Card>
      <Card style={{ marginTop: 14 }}>
        <Eyebrow color={T.steel}>Simulation « what-if »</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.7 }}>
          Exemple : <b style={{ color: T.ink }}>« Un éditeur durcit son programme canal (−5 pts de rebate) »</b> → impact chiffré sur la marge des BU concernées et sur le pipeline, en s'appuyant sur les données du cockpit.
          <br />
          <b style={{ color: T.ink }}>« Un concurrent remporte le compte X »</b> → impact sur le backlog et la part de marché.
          <br />
          <span style={{ color: T.faint }}>(Moteur de simulation branché sur Prévision / Atterrissage dans l'implémentation.)</span>
        </div>
      </Card>
    </div>
  );
}
