import React, { useState } from "react";
import { T, fmt, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useInitiatives } from "../lib/execution";
import { useQuantiSummary } from "../lib/quanti";

/**
 * "Portefeuille & Croissance" (GE-McKinsey · Three Horizons · Granularité).
 *
 * Granularité reads `summaries/quanti.granularite` (croissance CAS N vs N-1 par BU, XOF bruts —
 * calculée depuis nt360). GE-McKinsey stays an explicit empty state: its market-attractiveness
 * axis needs EXTERNAL market data no internal source provides (not an import problem — a data
 * problem). Three Horizons is derived live from the `initiatives` collection, grouped by
 * `horizon` (H1/H2/H3), so it fills up as initiatives are created in "Exécution & Décisions".
 */
export function Portefeuille() {
  const [c, setC] = useState("ge9");
  const { initiatives, loading } = useInitiatives();
  const { data: quanti } = useQuantiSummary();
  const gran = quanti?.granularite ?? [];
  const granMax = Math.max(...gran.map((g) => Math.abs(g.delta)), 1);
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
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
            Nécessite un axe « attractivité du marché » (donnée externe : taille/croissance des marchés adressés) qu'aucune
            source interne ne fournit — la position concurrentielle interne est déjà couverte par le BCG (vue Cadres).
          </div>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.steel}>Granularité de la croissance — où gagner (par BU, CAS N vs N-1)</Eyebrow>
            {gran.length > 0 && <Badge c={T.emerald}>Temps réel (nt360)</Badge>}
          </div>
          {gran.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente de la première synchronisation interne (nt360).</div>
          )}
          {gran.length > 0 && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {gran.map((g) => (
                <div key={g.seg}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ color: T.ink, fontWeight: 600 }}>
                      {g.seg} <span style={{ color: T.faint, fontWeight: 400 }}>· {fmt(g.casN1)} → {fmt(g.casN)}</span>
                    </span>
                    <span style={{ color: g.delta >= 0 ? T.emerald : T.clay, fontVariantNumeric: "tabular-nums" }}>
                      {g.delta >= 0 ? "+" : ""}
                      {fmt(g.delta)}
                    </span>
                  </div>
                  <div style={{ height: 7, background: T.panel2, borderRadius: 4 }}>
                    <div style={{ width: `${(Math.abs(g.delta) / granMax) * 100}%`, height: "100%", background: g.delta >= 0 ? T.emerald : T.clay, borderRadius: 4 }} />
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: T.faint, marginTop: 4 }}>
                Segment = BU (un axe segment × offre plus fin nécessitera un tag « offre » côté données internes). Montants en FCFA.
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
