import React from "react";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { SCENARIOS, SCEN_PROB } from "../data";

/** "Scénarios" — ported from `Scenarios` in the maquette. */
export function Scenarios() {
  const w = SCENARIOS.worlds;
  return (
    <div>
      <div style={{ fontSize: 12, color: T.dim, marginBottom: 14 }}>
        Planification par scénarios sur deux axes d'incertitude majeurs : <b style={{ color: T.ink }}>{SCENARIOS.axisY}</b> (vertical) × <b style={{ color: T.ink }}>{SCENARIOS.axisX}</b> (horizontal).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[1, 0, 3, 2].map((idx, pos) => (
          <Card key={pos} style={{ borderTop: `3px solid ${w[idx].c}`, minHeight: 150 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Eyebrow color={w[idx].c}>{w[idx].q}</Eyebrow>
              <Badge c={w[idx].c}>proba {pct(SCEN_PROB[pos])}</Badge>
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>{w[idx].d}</div>
            <div style={{ marginTop: 8, height: 6, background: T.panel2, borderRadius: 4 }}>
              <div style={{ width: `${SCEN_PROB[pos] * 100}%`, height: "100%", background: w[idx].c, borderRadius: 4 }} />
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
