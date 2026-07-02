import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { T, fmt, pct, AMBITION_LABEL } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Tip } from "../../../design/ui";
import { BRIDGE, VAS } from "../data";

/** "Création de valeur" (value bridge · value-at-stake · driver tree) — ported from `Valeur`. */
export function Valeur() {
  let cum = 0;
  const wf = BRIDGE.map((b) => {
    if (b.kind === "start" || b.kind === "end") {
      cum = b.v as number;
      return { name: b.name, base: 0, pos: b.v as number, neg: 0, total: b.v as number, kind: b.kind };
    }
    const d = b.d as number;
    const base = d >= 0 ? cum : cum + d;
    cum += d;
    return { name: b.name, base, pos: d >= 0 ? d : 0, neg: d < 0 ? -d : 0, total: cum, d };
  });
  const vas = [...VAS].map((v) => ({ ...v, ev: Math.round(v.p * v.impact) })).sort((a, b) => Math.abs(b.ev) - Math.abs(a.ev));
  const evOpp = vas.filter((v) => v.type === "opp").reduce((s, v) => s + v.ev, 0);
  const evThreat = vas.filter((v) => v.type === "threat").reduce((s, v) => s + v.ev, 0);
  return (
    <div>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
        <Card>
          <Kpi label="Valeur attendue — opportunités" value={fmt(evOpp * 1e6)} accent={T.emerald} sub="Σ (proba × impact)" />
        </Card>
        <Card>
          <Kpi label="Valeur à risque — menaces" value={fmt(evThreat * 1e6)} accent={T.clay} sub="Σ (proba × impact)" />
        </Card>
        <Card>
          <Kpi label="Valeur nette en jeu" value={fmt((evOpp + evThreat) * 1e6)} accent={T.gold} sub="net at stake" />
        </Card>
      </div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.gold}>Pont de création de valeur — {AMBITION_LABEL}</Eyebrow>
        <div style={{ height: 280, marginTop: 10 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={wf} margin={{ left: 0, right: 10, top: 10, bottom: 30 }}>
              <CartesianGrid stroke={T.line} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tickFormatter={(v) => fmt(v * 1e6)} tick={{ fill: T.faint, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} cursor={{ fill: T.panel2 }} />
              <Bar dataKey="base" stackId="a" fill="transparent" />
              <Bar dataKey="pos" stackId="a" radius={[3, 3, 0, 0]}>
                {wf.map((r, i) => (
                  <Cell key={i} fill={r.kind === "start" ? T.steel : r.kind === "end" ? T.gold : T.emerald} />
                ))}
              </Bar>
              <Bar dataKey="neg" stackId="a" radius={[3, 3, 0, 0]}>
                {wf.map((_r, i) => (
                  <Cell key={i} fill={T.clay} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 11.5, color: T.faint }}>En M FCFA (illustratif). Vert = leviers de croissance, rouge = pertes/menaces, or = ambition cible.</div>
      </Card>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <Eyebrow color={T.emerald}>Value-at-stake (proba × impact)</Eyebrow>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {vas.map((v, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span style={{ color: T.ink }}>
                    {v.n} <span style={{ color: T.faint }}>· {pct(v.p)}</span>
                  </span>
                  <span style={{ color: v.ev >= 0 ? T.emerald : T.clay, fontVariantNumeric: "tabular-nums" }}>
                    {v.ev >= 0 ? "+" : ""}
                    {fmt(v.ev * 1e6)}
                  </span>
                </div>
                <div style={{ height: 6, background: T.panel2, borderRadius: 4 }}>
                  <div style={{ width: `${Math.min((Math.abs(v.ev) / 2000) * 100, 100)}%`, height: "100%", background: v.ev >= 0 ? T.emerald : T.clay, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <Eyebrow color={T.plum}>Arbre des leviers de valeur</Eyebrow>
          <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.5 }}>
            <div style={{ padding: "8px 10px", background: T.panel2, borderRadius: 8, color: T.ink, fontWeight: 600 }}>Résultat = Revenu récurrent + Revenu projet − Coûts</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ padding: "7px 9px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${T.emerald}`, color: T.dim }}>
                  <b style={{ color: T.emerald }}>Récurrent</b>
                  <br />
                  Managed × ARR × rétention
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ padding: "7px 9px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${T.gold}`, color: T.dim }}>
                  <b style={{ color: T.gold }}>Projet</b>
                  <br />
                  Pipeline pondéré × taux transfo × marge
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ padding: "7px 9px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${T.clay}`, color: T.dim }}>
                  <b style={{ color: T.clay }}>Coûts</b>
                  <br />
                  Achats + masse salariale + financement
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: T.faint }}>Chaque levier est actionnable et relié aux modules (Pipeline, Rentabilité, Crédit Fournisseurs).</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
