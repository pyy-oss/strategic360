import React, { useState } from "react";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useInitiatives } from "../lib/execution";

/**
 * "Portefeuille & Croissance" (GE-McKinsey · Three Horizons · Granularité).
 *
 * GE-McKinsey and Granularité need internal quantitative imports (P&L/LIVE) that don't exist as
 * summaries yet — both tabs show explicit empty states (no sample data is ever rendered).
 * Three Horizons is derived live from the `initiatives` collection, grouped by `horizon`
 * (H1/H2/H3), so it fills up as initiatives are created in "Exécution & Décisions".
 */
export function Portefeuille() {
  const [c, setC] = useState("ge9");
  const { initiatives, loading } = useInitiatives();
  const CN: [string, string][] = [
    ["ge9", "Matrice GE-McKinsey"],
    ["horizons", "Three Horizons"],
    ["gran", "Granularité de la croissance"],
  ];

  const HMETA: { h: string; label: string; c: string; d: string }[] = [
    { h: "H1", label: "Horizon 1 — Cœur", c: T.emerald, d: "Défendre et optimiser le cœur d'activité : efficacité, marge, fidélisation." },
    { h: "H2", label: "Horizon 2 — Émergent", c: T.gold, d: "Construire les moteurs de croissance rentable de demain." },
    { h: "H3", label: "Horizon 3 — Options", c: T.steel, d: "Créer des options de rupture et de nouveaux modèles." },
  ];
  const byHorizon = (h: string) => initiatives.filter((i) => i.horizon === h);
  const total = initiatives.length;

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
          <Eyebrow color={T.emerald}>Matrice GE-McKinsey — attractivité du marché × position concurrentielle</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente des imports internes (P&L/LIVE).</div>
        </Card>
      )}
      {c === "horizons" && (
        <div>
          {!loading && total === 0 && (
            <Card>
              <Eyebrow color={T.gold}>Three Horizons — allocation de l'ambition</Eyebrow>
              <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
                À alimenter via les initiatives (Exécution & Décisions) — chaque initiative porte un horizon H1/H2/H3.
              </div>
            </Card>
          )}
          {total > 0 && (
            <div>
              <Card style={{ marginBottom: 14 }}>
                <Eyebrow color={T.gold}>Three Horizons — répartition des initiatives</Eyebrow>
                <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", marginTop: 14 }}>
                  {HMETA.filter((h) => byHorizon(h.h).length > 0).map((h) => {
                    const share = byHorizon(h.h).length / total;
                    return (
                      <div key={h.h} style={{ width: `${share * 100}%`, background: h.c, display: "grid", placeItems: "center", fontSize: 11, color: "#0E1613", fontWeight: 700 }}>
                        {pct(share)}
                      </div>
                    );
                  })}
                </div>
              </Card>
              <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
                {HMETA.map((h) => {
                  const items = byHorizon(h.h);
                  return (
                    <Card key={h.h} style={{ borderTop: `3px solid ${h.c}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <Eyebrow color={h.c}>{h.label}</Eyebrow>
                        <Badge c={h.c}>{items.length}</Badge>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12.5, color: T.dim, lineHeight: 1.55 }}>{h.d}</div>
                      {items.length === 0 ? (
                        <div style={{ marginTop: 10, fontSize: 12, color: T.faint }}>Aucune initiative sur cet horizon.</div>
                      ) : (
                        <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 12, color: T.dim, lineHeight: 1.7 }}>
                          {items.map((it) => (
                            <li key={it.id}>
                              {it.title} <span style={{ color: T.faint }}>({pct(it.progress)})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {c === "gran" && (
        <Card>
          <Eyebrow color={T.steel}>Granularité de la croissance — où gagner (segment × offre)</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente des imports internes (P&L/LIVE).</div>
        </Card>
      )}
    </div>
  );
}
