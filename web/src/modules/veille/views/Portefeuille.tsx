import React, { useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, ReferenceLine, Tooltip, Cell } from "recharts";
import { T, fmt, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useInitiatives } from "../lib/execution";
import { useFramework } from "../lib/frameworks";
import { useQuantiSummary } from "../lib/quanti";

type Ge9Content = { items: { n: string; attr: number; pos: number; size: number; note?: string; emerging?: boolean; posSource?: "interne+ia" | "ia" }[] };
type HorizonsContent = { items: { h: "H1" | "H2" | "H3"; title: string; d?: string }[] };

/**
 * "Portefeuille & Croissance" (GE-McKinsey · Three Horizons · Granularité).
 *
 * Granularité reads `summaries/quanti.granularite` (croissance CAS N vs N-1 par BU, XOF —
 * nt360). GE-McKinsey reads `frameworks/ge9` : la position/taille viennent des CAS réels, et
 * l'axe « attractivité du marché » — introuvable en interne — est ESTIMÉ par l'IA depuis les
 * signaux + contexte (enrichissement hebdo, garde anti-écrasement humain). Three Horizons
 * combine les initiatives réelles (Exécution & Décisions) et les SUGGESTIONS IA de
 * `frameworks/horizons` — l'humain adopte une suggestion en créant l'initiative réelle.
 */
export function Portefeuille() {
  const [c, setC] = useState("ge9");
  const { initiatives, loading } = useInitiatives();
  const { data: quanti } = useQuantiSummary();
  const { data: ge9fw } = useFramework<Ge9Content>("ge9");
  const { data: horizonsFw } = useFramework<HorizonsContent>("horizons");
  const ge9 = ge9fw?.content?.items ?? [];
  const hSuggestions = horizonsFw?.content?.items ?? [];
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
      {c === "ge9" && ge9.length === 0 && (
        <Card>
          <Eyebrow color={T.emerald}>Matrice GE-McKinsey — attractivité du marché × position concurrentielle</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
            En attente de la première génération IA (enrichissement hebdomadaire) — l'attractivité des marchés est estimée
            depuis les signaux de veille ; la position des segments établis est ancrée sur les CAS internes réels.
          </div>
        </Card>
      )}
      {c === "ge9" && ge9.length > 0 && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <Eyebrow color={T.emerald}>Matrice GE-McKinsey — attractivité (IA, signaux) × position NT (proxy CA interne)</Eyebrow>
            <Badge c={T.emerald}>Généré par l'IA — taille = poids du segment</Badge>
          </div>
          {/* Honnêteté d'axe (audit 2026-07) : faute de données de PARTS DE MARCHÉ, l'axe « position »
              est un PROXY = part du CA interne NT (vs sa plus grosse BU), pas une position face aux
              concurrents. Le libellé le dit pour ne pas laisser croire à une part de marché mesurée. */}
          <div style={{ height: 340, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                <XAxis type="number" dataKey="pos" domain={[0, 100]} reversed tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Position NT (proxy CA interne, pas part de marché)", position: "insideBottom", offset: -8, fill: T.dim, fontSize: 11 }} />
                <YAxis type="number" dataKey="attr" domain={[0, 100]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Attractivité du marché", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
                <ZAxis type="number" dataKey="size" range={[300, 2200]} />
                <ReferenceLine x={33} stroke={T.line} />
                <ReferenceLine x={66} stroke={T.line} />
                <ReferenceLine y={33} stroke={T.line} />
                <ReferenceLine y={66} stroke={T.line} />
                <Tooltip cursor={{ stroke: T.faint }} content={({ payload }) => {
                  const d = payload && payload[0] && (payload[0].payload as Ge9Content["items"][number]);
                  if (!d) return null;
                  return (
                    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", maxWidth: 260, fontSize: 11.5, color: T.dim }}>
                      <b style={{ color: T.ink }}>{d.n}</b>
                      <div>Attractivité {d.attr} · Position {d.pos} · Poids {d.size}</div>
                      {d.note && <div style={{ marginTop: 4, color: T.faint }}>{d.note}</div>}
                    </div>
                  );
                }} />
                <Scatter data={[...ge9]}>
                  {ge9.map((e, i) => (
                    // Segment émergent (whitespace : IA, cloud souverain, WAN/SD-WAN…) : anneau
                    // doré ajouré pour le distinguer des BU établies (pastilles pleines).
                    <Cell
                      key={i}
                      fill={e.emerging ? T.gold : e.attr >= 66 && e.pos >= 66 ? T.emerald : e.attr < 33 && e.pos < 33 ? T.clay : T.gold}
                      fillOpacity={e.emerging ? 0.18 : 1}
                      stroke={e.emerging ? T.gold : "none"}
                      strokeWidth={e.emerging ? 2 : 0}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {[...ge9].sort((a, b) => Number(b.emerging) - Number(a.emerging)).map((e, i) => (
              <div key={i} style={{ fontSize: 12, color: T.dim }}>
                <b style={{ color: T.ink }}>{e.n}</b>
                {e.emerging && (
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: T.gold, border: `1px solid ${T.gold}`, borderRadius: 4, padding: "1px 5px", verticalAlign: "middle" }}>
                    OPPORTUNITÉ ÉMERGENTE
                  </span>
                )}{" "}
                <span style={{ color: T.faint }}>(attr. {e.attr} · pos. {e.pos})</span>
                {e.note ? <> — {e.note}</> : null}
              </div>
            ))}
          </div>
        </Card>
      )}
      {c === "horizons" && (
        <div>
          {!loading && total === 0 && hSuggestions.length === 0 && (
            <Card>
              <Eyebrow color={T.gold}>Three Horizons — allocation de l'ambition</Eyebrow>
              <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
                À alimenter via les initiatives (Exécution & Décisions) — chaque initiative porte un horizon H1/H2/H3.
                Des suggestions IA arriveront avec le prochain enrichissement hebdomadaire.
              </div>
            </Card>
          )}
          {hSuggestions.length > 0 && (
            <Card style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <Eyebrow color={T.plum}>Initiatives suggérées par l'IA (depuis les signaux)</Eyebrow>
                <Badge c={T.plum}>À adopter via « Exécution & Décisions »</Badge>
              </div>
              <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 10 }}>
                {HMETA.map((hm) => (
                  <div key={hm.h}>
                    <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: hm.c, fontWeight: 700, marginBottom: 6 }}>{hm.label}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {hSuggestions.filter((sg) => sg.h === hm.h).map((sg, i) => (
                        <div key={i} style={{ padding: "8px 10px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${hm.c}` }}>
                          <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{sg.title}</div>
                          {sg.d && <div style={{ fontSize: 11.5, color: T.faint, marginTop: 3, lineHeight: 1.45 }}>{sg.d}</div>}
                        </div>
                      ))}
                      {hSuggestions.filter((sg) => sg.h === hm.h).length === 0 && (
                        <div style={{ fontSize: 11.5, color: T.faint }}>Aucune suggestion sur cet horizon.</div>
                      )}
                    </div>
                  </div>
                ))}
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
