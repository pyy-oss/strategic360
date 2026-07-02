import React, { useState } from "react";
import { T, AX, IMP, STANCE } from "../../../design/tokens";
import { Card, Badge } from "../../../design/ui";
import { SIGNAUX } from "../data";

/** "Fil de veille" — ported from `Fil` in the maquette. */
export function Fil() {
  const [ax, setAx] = useState("all");
  const [st, setSt] = useState("all");
  const rows = SIGNAUX.filter((s) => (ax === "all" || s.ax === ax) && (st === "all" || s.stance === st)).sort((a, b) => b.score - a.score);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: T.faint }}>Axe :</span>
        <button className={`pill ${ax === "all" ? "on" : ""}`} onClick={() => setAx("all")}>
          Tous
        </button>
        {Object.keys(AX).map((k) => (
          <button key={k} className={`pill ${ax === k ? "on" : ""}`} onClick={() => setAx(k)}>
            {AX[k].l}
          </button>
        ))}
        <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 10 }}>Posture :</span>
        {["all", "opportunity", "threat"].map((k) => (
          <button key={k} className={`pill ${st === k ? "on" : ""}`} onClick={() => setSt(k)}>
            {k === "all" ? "Toutes" : STANCE[k].l}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((s) => (
          <Card key={s.id} style={{ borderLeft: `3px solid ${STANCE[s.stance].c}` }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ textAlign: "center", minWidth: 44 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, color: STANCE[s.stance].c, lineHeight: 1 }}>{s.score}</div>
                <div style={{ fontSize: 9.5, color: T.faint, marginTop: 2 }}>priorité</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>{s.t}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Badge c={AX[s.ax].c}>{AX[s.ax].l}</Badge>
                  <Badge c={IMP[s.imp].c}>Impact {IMP[s.imp].l}</Badge>
                  <Badge c={STANCE[s.stance].c}>{STANCE[s.stance].l}</Badge>
                  <Badge c={T.faint}>
                    {s.ent} · {s.geo}
                  </Badge>
                  <Badge c={T.steel}>Source {s.src}</Badge>
                  <Badge c={T.faint}>{s.date}</Badge>
                </div>
                <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim }}>
                  <b style={{ color: T.plum }}>So-what :</b> {s.sw}
                </div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: T.dim }}>
                  <b style={{ color: T.gold }}>Action :</b> {s.act}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
