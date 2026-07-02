import React from "react";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { INITIATIVES, DECISIONS } from "../data";

/** "Exécution & Décisions" — ported from `Execution` in the maquette. */
export function Execution() {
  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.emerald}>Initiatives stratégiques & OKR</Eyebrow>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {INITIATIVES.map((it, i) => (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, flexWrap: "wrap", gap: 6 }}>
                <span style={{ color: T.ink, fontWeight: 600 }}>
                  {it.t} <Badge c={T.plum}>{it.pilier}</Badge> <Badge c={T.faint}>{it.h}</Badge>
                </span>
                <span style={{ color: T.dim, fontSize: 11.5 }}>
                  {it.owner} · {pct(it.prog)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>OKR : {it.okr}</div>
              <div style={{ height: 8, background: T.panel2, borderRadius: 4 }}>
                <div style={{ width: `${it.prog * 100}%`, height: "100%", background: it.prog >= 0.5 ? T.emerald : T.gold, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <Eyebrow color={T.steel}>Registre de décisions stratégiques</Eyebrow>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: T.faint, fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Décision</th>
                <th style={{ padding: "6px 8px" }}>Instance</th>
                <th style={{ padding: "6px 8px" }}>Signaux liés</th>
                <th style={{ padding: "6px 8px" }}>Date</th>
                <th style={{ padding: "6px 8px" }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {DECISIONS.map((d, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td style={{ padding: "7px 8px", color: T.ink }}>{d.t}</td>
                  <td style={{ padding: "7px 8px", color: T.dim }}>{d.by}</td>
                  <td style={{ padding: "7px 8px", color: T.faint }}>{d.lien}</td>
                  <td style={{ padding: "7px 8px", color: T.faint }}>{d.date}</td>
                  <td style={{ padding: "7px 8px" }}>
                    <Badge c={d.statut === "Actée" ? T.emerald : d.statut === "En cours" ? T.gold : T.clay}>{d.statut}</Badge>
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
