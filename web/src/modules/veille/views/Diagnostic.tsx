import React, { useState } from "react";
import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { T } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { ISSUE as ISSUE_STATIC, S7 as S7_STATIC, MATURITE as MATURITE_STATIC } from "../data";
import { useFramework } from "../lib/frameworks";

interface DiagnosticContent {
  issue: typeof ISSUE_STATIC;
  s7: typeof S7_STATIC;
  maturite: typeof MATURITE_STATIC;
}

/**
 * "Diagnostic" (7S · arbre MECE · maturité) — ported from `Diagnostic`; content source swapped to
 * `frameworks/diagnostic` (V6, BUILD_KIT.md §11 "Diagnostic lit frameworks, saisie" — exec-write).
 * Falls back to the static maquette sample (with a badge) when that document hasn't been written
 * yet, same "example vs. live" convention as `Cadres.tsx`'s BCG tab (V4) and `Scenarios.tsx` (V6).
 * Editing UI is out of scope for V6 (see the phase report) — this view is read-wired only;
 * updates go through `updateFramework("diagnostic", …)` (Console/seed/future editor).
 */
export function Diagnostic() {
  const [c, setC] = useState("issue");
  const { data: fw } = useFramework<DiagnosticContent>("diagnostic");
  const isLive = !!fw?.content;
  const ISSUE = fw?.content?.issue ?? ISSUE_STATIC;
  const S7 = fw?.content?.s7 ?? S7_STATIC;
  const MATURITE = fw?.content?.maturite ?? MATURITE_STATIC;
  const CN: [string, string][] = [
    ["issue", "Arbre du problème (MECE)"],
    ["s7", "McKinsey 7S"],
    ["mat", "Maturité des capacités"],
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {CN.map(([k, l]) => (
          <button key={k} className={`pill ${c === k ? "on" : ""}`} onClick={() => setC(k)}>
            {l}
          </button>
        ))}
        <Badge c={isLive ? T.emerald : T.faint}>{isLive ? "Document vivant" : "Exemple — en attente de saisie"}</Badge>
      </div>
      {c === "issue" && (
        <Card>
          <Eyebrow color={T.gold}>Résolution hypothético-déductive — arbre MECE</Eyebrow>
          <div style={{ display: "flex", gap: 14, marginTop: 14, alignItems: "stretch" }}>
            <div style={{ minWidth: 180, display: "flex", alignItems: "center" }}>
              <div style={{ padding: "12px 14px", background: `linear-gradient(135deg,${T.gold},#8E6F2A)`, color: "#0E1613", borderRadius: 10, fontWeight: 700, fontSize: 13.5 }}>{ISSUE.q}</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              {ISSUE.branches.map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                  <div style={{ minWidth: 230, padding: "9px 11px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${T.steel}`, color: T.ink, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center" }}>{b.t}</div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
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
        </Card>
      )}
      {c === "s7" && (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card>
            <Eyebrow color={T.plum}>McKinsey 7S — alignement organisationnel</Eyebrow>
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
          </Card>
          <Card>
            <Eyebrow color={T.plum}>Lecture</Eyebrow>
            <div style={{ marginTop: 12, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>
              Alignement « soft » (Style, Staff, Skills) à renforcer pour exécuter la bascule vers le récurrent et le cloud/IA : <b style={{ color: T.ink }}>compétences rares (cyber/cloud/IA)</b> et <b style={{ color: T.ink }}>systèmes/process</b> sont les maillons à consolider. Les <b style={{ color: T.ink }}>valeurs partagées</b> et la <b style={{ color: T.ink }}>stratégie</b> sont des points forts sur lesquels capitaliser.
            </div>
          </Card>
        </div>
      )}
      {c === "mat" && (
        <Card>
          <Eyebrow color={T.steel}>Maturité des capacités (0-5)</Eyebrow>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
            {MATURITE.map((m, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span style={{ color: T.ink }}>{m.c}</span>
                  <span style={{ color: T.dim }}>{m.v}/5</span>
                </div>
                <div style={{ height: 8, background: T.panel2, borderRadius: 4 }}>
                  <div style={{ width: `${(m.v / 5) * 100}%`, height: "100%", background: m.v >= 4 ? T.emerald : m.v >= 3 ? T.gold : T.clay, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: T.faint }}>Data/IA (2/5) et Cloud (3/5) sont les capacités à hausser en priorité pour soutenir les Horizons 2 et 3.</div>
        </Card>
      )}
    </div>
  );
}
