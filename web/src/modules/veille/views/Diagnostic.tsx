import React, { useState } from "react";
import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { T } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useFramework } from "../lib/frameworks";

interface DiagnosticContent {
  issue?: { q: string; branches: { t: string; h: string[] }[] };
  s7?: { s: string; v: number }[];
  maturite?: { c: string; v: number }[];
}

/**
 * "Diagnostic" (arbre MECE · 7S · maturité) — reads the live `frameworks/diagnostic` document
 * only (exec-write via `updateFramework("diagnostic", …)`). When it hasn't been written yet, an
 * explicit empty state is shown — no sample content is ever rendered.
 */
export function Diagnostic() {
  const [c, setC] = useState("issue");
  const { data: fw, loading } = useFramework<DiagnosticContent>("diagnostic");
  const isLive = !!fw?.content;
  const ISSUE = fw?.content?.issue;
  const S7 = fw?.content?.s7 ?? [];
  const MATURITE = fw?.content?.maturite ?? [];
  const CN: [string, string][] = [
    ["issue", "Arbre du problème (MECE)"],
    ["s7", "McKinsey 7S"],
    ["mat", "Maturité des capacités"],
  ];

  if (loading) {
    return (
      <Card>
        <div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div>
      </Card>
    );
  }

  if (!isLive) {
    return (
      <Card>
        <Eyebrow color={T.faint}>Diagnostic</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
          Diagnostic non renseigné. À compléter par la Direction (document `frameworks/diagnostic`).
        </div>
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {CN.map(([k, l]) => (
          <button key={k} className={`pill ${c === k ? "on" : ""}`} onClick={() => setC(k)}>
            {l}
          </button>
        ))}
        <Badge c={T.emerald}>Document vivant</Badge>
      </div>
      {c === "issue" && (
        <Card>
          <Eyebrow color={T.gold}>Résolution hypothético-déductive — arbre MECE</Eyebrow>
          {!ISSUE ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Section non renseignée.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 14, marginTop: 14, alignItems: "stretch", flexWrap: "wrap" }}>
                <div style={{ minWidth: "min(180px,100%)", display: "flex", alignItems: "center" }}>
                  <div style={{ padding: "12px 14px", background: `linear-gradient(135deg,${T.gold},#8E6F2A)`, color: "#0E1613", borderRadius: 10, fontWeight: 700, fontSize: 13.5 }}>{ISSUE.q}</div>
                </div>
                <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {ISSUE.branches.map((b, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
                      <div style={{ minWidth: "min(230px,100%)", padding: "9px 11px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${T.steel}`, color: T.ink, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center" }}>{b.t}</div>
                      <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
                        {b.h.map((h, j) => (
                          <div key={j} style={{ fontSize: 12, color: T.dim, padding: "5px 9px", background: T.panel2, borderRadius: 7 }}>
                            Hypothèse : {h}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 11.5, color: T.faint }}>Décomposition MECE (mutuellement exclusive, collectivement exhaustive) : chaque hypothèse est testable par les données du cockpit et les signaux de veille.</div>
            </>
          )}
        </Card>
      )}
      {c === "s7" && (
        <Card>
          <Eyebrow color={T.plum}>McKinsey 7S — alignement organisationnel</Eyebrow>
          {S7.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Section non renseignée.</div>
          ) : (
            <div style={{ height: 290, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={[...S7]} outerRadius="72%">
                  <PolarGrid stroke={T.line} />
                  <PolarAngleAxis dataKey="s" tick={{ fill: T.dim, fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: T.faint, fontSize: 9 }} axisLine={false} />
                  <Radar dataKey="v" stroke={T.plum} fill={T.plum} fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      )}
      {c === "mat" && (
        <Card>
          <Eyebrow color={T.steel}>Maturité des capacités (0-100)</Eyebrow>
          {MATURITE.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Section non renseignée.</div>
          ) : (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
              {MATURITE.map((m, i) => {
                // Scores IA sur 0-100 (cf. enrich.js parseDiagnosticResponse). On borne à [0,100]
                // par sécurité si une ancienne donnée /5 traînait.
                const v = Math.max(0, Math.min(100, m.v));
                return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ color: T.ink }}>{m.c}</span>
                    <span style={{ color: T.dim }}>{v}/100</span>
                  </div>
                  <div style={{ height: 8, background: T.panel2, borderRadius: 4 }}>
                    <div style={{ width: `${v}%`, height: "100%", background: v >= 75 ? T.emerald : v >= 50 ? T.gold : T.clay, borderRadius: 4 }} />
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
