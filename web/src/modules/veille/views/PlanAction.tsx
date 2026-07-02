import React from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { T, fmt } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge, Tip } from "../../../design/ui";
import { ACTIONS, quadrant } from "../data";

/** "Plan d'action" — ported from `PlanAction` in the maquette. */
export function PlanAction() {
  const acts = ACTIONS.map((a) => ({ ...a, prio: Math.round(((a.imp * a.urg) / a.eff) * 10) / 10, q: quadrant(a) })).sort((x, y) => y.prio - x.prio);
  const totEv = acts.reduce((s, a) => s + a.ev, 0);
  const now = acts.filter((a) => a.q.l === "Faire maintenant").length;
  const lancer = acts.filter((a) => a.st === "À lancer" || a.st === "Immédiat").length;
  return (
    <div>
      <div style={{ fontSize: 12, color: T.plum, marginBottom: 14, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
        ✅ La boucle « et maintenant ? » : chaque signal et événement converge en actions priorisées (impact × urgence, effort, valeur attendue), avec porteur et échéance. C'est ce qui relie l'intelligence à la valeur.
      </div>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
        <Card>
          <Kpi label="Valeur attendue du plan" value={fmt(totEv * 1e6)} accent={T.emerald} sub="Σ des actions" />
        </Card>
        <Card>
          <Kpi label="À faire maintenant" value={now} accent={T.clay} sub="impact & urgence forts" />
        </Card>
        <Card>
          <Kpi label="À lancer / immédiat" value={lancer} accent={T.gold} sub="actions non démarrées" />
        </Card>
      </div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.gold}>Matrice de priorisation — impact × urgence (taille = valeur attendue)</Eyebrow>
        <div style={{ height: 300, marginTop: 10 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 6, right: 20, top: 10, bottom: 20 }}>
              <CartesianGrid stroke={T.line} />
              <XAxis type="number" dataKey="urg" name="Urgence" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Urgence →", position: "insideBottom", offset: -8, fill: T.dim, fontSize: 11 }} />
              <YAxis type="number" dataKey="imp" name="Impact" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Impact →", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
              <ZAxis type="number" dataKey="ev" range={[120, 1000]} />
              <ReferenceLine x={3.5} stroke={T.faint} />
              <ReferenceLine y={3.5} stroke={T.faint} />
              <Tooltip content={<Tip />} cursor={{ stroke: T.faint }} />
              <Scatter data={acts.map((a) => ({ ...a, n: a.t }))}>
                {acts.map((a, i) => (
                  <Cell key={i} fill={a.q.c} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
          {(
            [
              ["Faire maintenant", T.clay],
              ["Traiter vite", T.gold],
              ["Planifier", T.emerald],
              ["Surveiller", T.faint],
            ] as [string, string][]
          ).map(([l, c], i) => (
            <span key={i} style={{ color: T.dim }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: c, marginRight: 5 }} />
              {l}
            </span>
          ))}
        </div>
      </Card>
      <Card>
        <Eyebrow color={T.steel}>Plan d'action priorisé</Eyebrow>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: T.faint, fontSize: 10.5, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>#</th>
                <th style={{ padding: "6px 8px" }}>Action</th>
                <th style={{ padding: "6px 8px" }}>Zone</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Val. att.</th>
                <th style={{ padding: "6px 8px" }}>Porteur</th>
                <th style={{ padding: "6px 8px" }}>Échéance</th>
                <th style={{ padding: "6px 8px" }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {acts.map((a, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td style={{ padding: "8px", color: T.gold, fontFamily: "'Bricolage Grotesque'", fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ padding: "8px", color: T.ink }}>
                    {a.t}
                    <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2 }}>
                      {a.src} · I{a.imp}·U{a.urg}·E{a.eff}
                    </div>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <Badge c={a.q.c}>{a.q.l}</Badge>
                  </td>
                  <td style={{ padding: "8px", textAlign: "right", color: T.emerald, fontVariantNumeric: "tabular-nums" }}>{fmt(a.ev * 1e6)}</td>
                  <td style={{ padding: "8px", color: T.dim }}>{a.owner}</td>
                  <td style={{ padding: "8px", color: T.dim }}>{a.ech}</td>
                  <td style={{ padding: "8px" }}>
                    <Badge c={a.st === "En cours" ? T.emerald : a.st === "À surveiller" ? T.faint : T.gold}>{a.st}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
