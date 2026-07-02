import React, { useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { T, zColor, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge, Tip } from "../../../design/ui";
import { GE9, HORIZONS, SEGMENTS, OFFRES, GRAN } from "../data";

/** "Portefeuille & Croissance" (GE-McKinsey · Three Horizons · Granularité) — ported from `Portefeuille`. */
export function Portefeuille() {
  const [c, setC] = useState("ge9");
  const CN: [string, string][] = [
    ["ge9", "Matrice GE-McKinsey"],
    ["horizons", "Three Horizons"],
    ["gran", "Granularité de la croissance"],
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {CN.map(([k, l]) => (
          <button key={k} className={`pill ${c === k ? "on" : ""}`} onClick={() => setC(k)}>
            {l}
          </button>
        ))}
      </div>
      {c === "ge9" && (
        <Card>
          <Eyebrow color={T.emerald}>Matrice GE-McKinsey — attractivité du marché × position concurrentielle (taille = marge)</Eyebrow>
          <div style={{ height: 340, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                <CartesianGrid stroke={T.line} />
                <XAxis type="number" dataKey="str" name="Position" domain={[0, 3]} ticks={[1, 2]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Position concurrentielle →", position: "insideBottom", offset: -8, fill: T.dim, fontSize: 11 }} />
                <YAxis type="number" dataKey="attr" name="Attractivité" domain={[0, 3]} ticks={[1, 2]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Attractivité du marché →", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
                <ZAxis type="number" dataKey="val" range={[300, 2400]} />
                <ReferenceLine x={1} stroke={T.faint} />
                <ReferenceLine x={2} stroke={T.faint} />
                <ReferenceLine y={1} stroke={T.faint} />
                <ReferenceLine y={2} stroke={T.faint} />
                <Tooltip content={<Tip />} cursor={{ stroke: T.faint }} />
                <Scatter data={[...GE9]}>
                  {GE9.map((g, i) => (
                    <Cell key={i} fill={zColor(g.attr, g.str)} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {GE9.map((g, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: T.ink }}>
                  <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: zColor(g.attr, g.str), marginRight: 6 }} />
                  {g.n}
                </span>
                <Badge c={zColor(g.attr, g.str)}>{g.z}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
      {c === "horizons" && (
        <div>
          <Card style={{ marginBottom: 14 }}>
            <Eyebrow color={T.gold}>Three Horizons — allocation de la valeur & de l'ambition</Eyebrow>
            <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", marginTop: 14 }}>
              {HORIZONS.map((h, i) => (
                <div key={i} style={{ width: `${h.share * 100}%`, background: h.c, display: "grid", placeItems: "center", fontSize: 11, color: "#0E1613", fontWeight: 700 }}>
                  {pct(h.share)}
                </div>
              ))}
            </div>
          </Card>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {HORIZONS.map((h, i) => (
              <Card key={i} style={{ borderTop: `3px solid ${h.c}` }}>
                <Eyebrow color={h.c}>{h.h}</Eyebrow>
                <div style={{ marginTop: 8, fontSize: 12.5, color: T.dim, lineHeight: 1.55 }}>{h.d}</div>
                <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 12, color: T.dim, lineHeight: 1.7 }}>
                  {h.items.map((x, j) => (
                    <li key={j}>{x}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      )}
      {c === "gran" && (
        <Card>
          <Eyebrow color={T.steel}>Granularité de la croissance — où gagner (segment × offre)</Eyebrow>
          <div style={{ marginTop: 14, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: T.faint, fontSize: 11 }}>Segment \ Offre</th>
                  {OFFRES.map((o) => (
                    <th key={o} style={{ padding: "6px 8px", color: T.faint, fontSize: 11 }}>
                      {o}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SEGMENTS.map((s) => (
                  <tr key={s}>
                    <td style={{ padding: "6px 8px", color: T.ink, fontWeight: 600 }}>{s}</td>
                    {OFFRES.map((o) => {
                      const v = GRAN[s][o];
                      const c2 = v >= 5 ? T.emerald : v >= 4 ? T.gold : v >= 3 ? T.steel : T.faint;
                      return (
                        <td key={o} style={{ padding: "4px" }}>
                          <div style={{ background: c2 + "22", border: `1px solid ${c2}55`, borderRadius: 7, textAlign: "center", padding: "10px 0", color: c2, fontWeight: 700, fontFamily: "'Bricolage Grotesque'" }}>{v}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: T.dim }}>
            Score attractivité × position (1-5). Les cellules <b style={{ color: T.emerald }}>5</b> (ex. Cyber & Managed dans les banques) sont les <b style={{ color: T.ink }}>micro-batailles prioritaires</b> — concentrer les ressources là où l'on peut gagner.
          </div>
        </Card>
      )}
    </div>
  );
}
