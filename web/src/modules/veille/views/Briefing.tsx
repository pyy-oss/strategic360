import React from "react";
import { T } from "../../../design/tokens";
import { Eyebrow, Card } from "../../../design/ui";
import { SIGNAUX } from "../data";

/** "Briefing exécutif" — ported from `Briefing` in the maquette (pyramide de Minto). */
export function Briefing() {
  const s = [...SIGNAUX].sort((a, b) => b.score - a.score);
  const opps = s.filter((x) => x.stance === "opportunity").slice(0, 3);
  const men = s.filter((x) => x.stance === "threat").slice(0, 3);
  return (
    <div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <Eyebrow color={T.gold}>Briefing exécutif — semaine du 30/06/2026</Eyebrow>
          <span style={{ fontSize: 11, color: T.faint }}>Généré par IA · revu (maquette) · exportable en board pack PDF</span>
        </div>
        <div style={{ marginTop: 14, fontSize: 13, color: T.dim, lineHeight: 1.7 }}>
          <div style={{ padding: "14px 16px", background: `linear-gradient(135deg,${T.panel2},${T.panel})`, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".13em", textTransform: "uppercase", color: T.gold, fontWeight: 600, marginBottom: 6 }}>Idée directrice (pyramide de Minto)</div>
            <div style={{ fontSize: 15, color: T.ink, fontWeight: 600, lineHeight: 1.5 }}>
              Neurones doit basculer son mix vers le récurrent (cyber & managed) et la souveraineté, en capturant la vague de financements réglementaires — c'est la voie la plus probable et la plus créatrice de valeur pour doubler le revenu rentable en 3 ans.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 12 }}>
              {(
                [
                  ["1. La demande est là", T.emerald, "Réglementation (ARTCI/BCEAO), financements (BAD 200 M$), demande de SOC managé — convergence favorable."],
                  ["2. Nous pouvons gagner", T.gold, "Expertise cyber, certifications, références bancaires, portage financier — position forte sur les cellules à forte valeur."],
                  ["3. Il faut agir vite", T.clay, "Pressions fournisseurs (EOL, rebates) et concurrence : fenêtre d'action limitée, décisions à prendre ce trimestre."],
                ] as [string, string, string][]
              ).map((a, i) => (
                <div key={i} style={{ background: T.panel2, borderRadius: 9, padding: "10px 12px", borderTop: `3px solid ${a[1]}` }}>
                  <div style={{ fontSize: 12.5, color: a[1], fontWeight: 600, marginBottom: 5 }}>{a[0]}</div>
                  <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.5 }}>{a[2]}</div>
                </div>
              ))}
            </div>
          </div>
          <p style={{ margin: "0 0 12px" }}>
            Le trimestre est porté par une <b style={{ color: T.emerald }}>fenêtre d'opportunités réglementaires et de financement</b> (BAD, ARTCI, BCEAO) qui converge avec notre stratégie cybersécurité et souveraineté. En regard, deux <b style={{ color: T.clay }}>pressions fournisseurs</b> (EOL Cisco, tarifs Fortinet) appellent des actions d'anticipation sur le sourcing et les marges.
          </p>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 12, color: T.emerald, fontWeight: 600, marginBottom: 6 }}>3 opportunités majeures</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7, color: T.dim, fontSize: 12.5 }}>
                {opps.map((o) => (
                  <li key={o.id}>
                    {o.t} <span style={{ color: T.faint }}>({o.score})</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.clay, fontWeight: 600, marginBottom: 6 }}>3 menaces à traiter</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7, color: T.dim, fontSize: 12.5 }}>
                {men.map((o) => (
                  <li key={o.id}>
                    {o.t} <span style={{ color: T.faint }}>({o.score})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 14, padding: "12px 14px", background: T.panel2, borderRadius: 10, borderLeft: `3px solid ${T.gold}` }}>
            <div style={{ fontSize: 12, color: T.gold, fontWeight: 600, marginBottom: 6 }}>Recommandations au comité</div>
            <ol style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8, color: T.ink, fontSize: 12.5 }}>
              <li>Constituer un consortium pour capter le programme de digitalisation BAD (200 M$).</li>
              <li>Accélérer l'industrialisation du SOC managé (récurrence + marge) et la conformité BCEAO.</li>
              <li>Sécuriser le sourcing avant l'EOL Cisco et renégocier les lignes de crédit exposées.</li>
              <li>Décider de l'investissement cloud souverain (aligné ARTCI + Microsoft).</li>
            </ol>
          </div>
        </div>
      </Card>
    </div>
  );
}
