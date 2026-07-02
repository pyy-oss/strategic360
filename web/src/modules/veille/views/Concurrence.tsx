import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge, Tip } from "../../../design/ui";
import { CONCURRENTS } from "../data";

/** "Concurrence" — ported from `Concurrence` in the maquette. */
export function Concurrence() {
  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.clay}>Taux de victoire par concurrent (Win/Loss — relié au Pipeline)</Eyebrow>
        <div style={{ height: 200, marginTop: 10 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={CONCURRENTS.map((c) => ({ n: c.n, win: Math.round(c.win * 100), deals: c.deals }))} margin={{ left: -10, right: 10 }}>
              <CartesianGrid stroke={T.line} vertical={false} />
              <XAxis dataKey="n" tick={{ fill: T.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => v + "%"} tick={{ fill: T.faint, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: T.panel2 }} content={<Tip />} />
              <Bar dataKey="win" name="Taux victoire" fill={T.clay} radius={[4, 4, 0, 0]} barSize={46} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {CONCURRENTS.map((c, i) => (
          <Card key={i} style={{ borderTop: `3px solid ${T.clay}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Eyebrow color={T.clay}>{c.n}</Eyebrow>
              <Badge c={c.win >= 0.5 ? T.emerald : T.clay}>
                {pct(c.win)} · {c.deals} deals
              </Badge>
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>
              <div>
                <b style={{ color: T.gold }}>Force :</b> {c.force}
              </div>
              <div>
                <b style={{ color: T.steel }}>Faiblesse :</b> {c.faible}
              </div>
              <div style={{ marginTop: 6, padding: "8px 10px", background: T.panel2, borderRadius: 8 }}>
                <b style={{ color: T.emerald }}>Comment gagner :</b> {c.gagner}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
