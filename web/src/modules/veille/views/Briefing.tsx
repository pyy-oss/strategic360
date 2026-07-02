import React, { useState } from "react";
import { T } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useIsExec } from "../../../lib/rbac";
import { SIGNAUX } from "../data";
import { exportBriefingPdf, generateBriefing, useLatestBriefing, type Briefing as BriefingDoc } from "../lib/briefings";

/**
 * "Briefing exécutif" — ported from `Briefing` in the maquette (pyramide de Minto).
 *
 * V7 wiring (BUILD_KIT.md §11 "Briefing lit briefings, summaries/*"): reads `useLatestBriefing()`
 * (the most recently `generateBriefing`'d doc). When none exists yet, falls back to the exact
 * static maquette content — same "Exemple" badge convention as `Cadres.tsx`'s BCG tab
 * (`bcgIsLive ? "Temps réel" : "Exemple — en attente d'un import P&L"`) and `Portefeuille.tsx`'s
 * GE-McKinsey tab, so an empty/ungenerated state never looks broken.
 *
 * "Générer un briefing" / "Exporter en PDF" are exec-gated (`useIsExec()`), matching the
 * `Execution.tsx`/`PlanAction.tsx` convention of showing exec-only action buttons only when
 * `isExec` — Security Rules / server-side `requireExecCaller` remain the sole authority either way.
 */

const STATIC_GOVERNING_THOUGHT =
  "Neurones doit basculer son mix vers le récurrent (cyber & managed) et la souveraineté, en capturant la vague de financements réglementaires — c'est la voie la plus probable et la plus créatrice de valeur pour doubler le revenu rentable en 3 ans.";

const STATIC_ARGUMENTS: [string, string, string][] = [
  ["1. La demande est là", T.emerald, "Réglementation (ARTCI/BCEAO), financements (BAD 200 M$), demande de SOC managé — convergence favorable."],
  ["2. Nous pouvons gagner", T.gold, "Expertise cyber, certifications, références bancaires, portage financier — position forte sur les cellules à forte valeur."],
  ["3. Il faut agir vite", T.clay, "Pressions fournisseurs (EOL, rebates) et concurrence : fenêtre d'action limitée, décisions à prendre ce trimestre."],
];

const STATIC_NARRATIVE = (
  <>
    Le trimestre est porté par une <b style={{ color: T.emerald }}>fenêtre d'opportunités réglementaires et de financement</b> (BAD, ARTCI, BCEAO)
    qui converge avec notre stratégie cybersécurité et souveraineté. En regard, deux <b style={{ color: T.clay }}>pressions fournisseurs</b> (EOL
    Cisco, tarifs Fortinet) appellent des actions d'anticipation sur le sourcing et les marges.
  </>
);

const STATIC_RECOMMENDATIONS = [
  "Constituer un consortium pour capter le programme de digitalisation BAD (200 M$).",
  "Accélérer l'industrialisation du SOC managé (récurrence + marge) et la conformité BCEAO.",
  "Sécuriser le sourcing avant l'EOL Cisco et renégocier les lignes de crédit exposées.",
  "Décider de l'investissement cloud souverain (aligné ARTCI + Microsoft).",
];

function ActionBar({ briefing, isExec }: { briefing: BriefingDoc | null; isExec: boolean }) {
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!isExec) return null;

  async function handleGenerate() {
    setGenerating(true);
    setErr(null);
    try {
      await generateBriefing();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de la génération du briefing.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setErr(null);
    try {
      const url = await exportBriefingPdf(briefing?.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'export PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="pill on" onClick={handleGenerate} disabled={generating}>
          {generating ? "Génération…" : "Générer un briefing"}
        </button>
        <button className="pill" onClick={handleExport} disabled={exporting || !briefing}>
          {exporting ? "Export…" : "Exporter en PDF"}
        </button>
      </div>
      {err && <span style={{ fontSize: 11, color: T.clay }}>{err}</span>}
    </div>
  );
}

export function Briefing() {
  const { briefing, loading } = useLatestBriefing();
  const isExec = useIsExec();

  // Fallback for the "3 opportunités majeures"/"3 menaces à traiter" lists when no AI briefing
  // has been generated yet — same static sample the maquette used.
  const s = [...SIGNAUX].sort((a, b) => b.score - a.score);
  const staticOpps = s.filter((x) => x.stance === "opportunity").slice(0, 3);
  const staticMen = s.filter((x) => x.stance === "threat").slice(0, 3);

  const isLive = !loading && briefing != null;

  const governingThought = briefing?.governingThought ?? STATIC_GOVERNING_THOUGHT;
  const args: [string, string, string][] = briefing
    ? briefing.arguments.map((a, i) => [a.title, [T.emerald, T.gold, T.clay][i] ?? T.gold, a.body] as [string, string, string])
    : STATIC_ARGUMENTS;
  const narrative = briefing?.content.narrative || null;
  const opportunities = briefing?.content.topOpportunities ?? null;
  const threats = briefing?.content.topThreats ?? null;
  const recommendations = briefing?.content.recommendations?.length ? briefing.content.recommendations : STATIC_RECOMMENDATIONS;
  const period = briefing?.period ?? "semaine du 30/06/2026";

  return (
    <div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <Eyebrow color={T.gold}>Briefing exécutif — {period}</Eyebrow>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: T.faint }}>Généré par IA · revue humaine obligatoire · exportable en board pack PDF</span>
              <Badge c={isLive ? T.emerald : T.faint}>
                {isLive ? `Généré (statut : ${briefing?.status})` : "Exemple — aucun briefing généré pour l'instant"}
              </Badge>
              {briefing?.status === "draft" && <Badge c={T.gold}>Brouillon — en attente de revue</Badge>}
            </div>
          </div>
          <ActionBar briefing={briefing} isExec={isExec} />
        </div>
        <div style={{ marginTop: 14, fontSize: 13, color: T.dim, lineHeight: 1.7 }}>
          <div style={{ padding: "14px 16px", background: `linear-gradient(135deg,${T.panel2},${T.panel})`, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".13em", textTransform: "uppercase", color: T.gold, fontWeight: 600, marginBottom: 6 }}>Idée directrice (pyramide de Minto)</div>
            <div style={{ fontSize: 15, color: T.ink, fontWeight: 600, lineHeight: 1.5 }}>{governingThought}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 12 }}>
              {args.map((a, i) => (
                <div key={i} style={{ background: T.panel2, borderRadius: 9, padding: "10px 12px", borderTop: `3px solid ${a[1]}` }}>
                  <div style={{ fontSize: 12.5, color: a[1], fontWeight: 600, marginBottom: 5 }}>{a[0]}</div>
                  <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.5 }}>{a[2]}</div>
                </div>
              ))}
            </div>
          </div>
          <p style={{ margin: "0 0 12px" }}>{narrative || STATIC_NARRATIVE}</p>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 12, color: T.emerald, fontWeight: 600, marginBottom: 6 }}>3 opportunités majeures</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7, color: T.dim, fontSize: 12.5 }}>
                {opportunities
                  ? opportunities.map((o, i) => (
                      <li key={i}>
                        {o.title} <span style={{ color: T.faint }}>({o.score})</span>
                      </li>
                    ))
                  : staticOpps.map((o) => (
                      <li key={o.id}>
                        {o.t} <span style={{ color: T.faint }}>({o.score})</span>
                      </li>
                    ))}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.clay, fontWeight: 600, marginBottom: 6 }}>3 menaces à traiter</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7, color: T.dim, fontSize: 12.5 }}>
                {threats
                  ? threats.map((o, i) => (
                      <li key={i}>
                        {o.title} <span style={{ color: T.faint }}>({o.score})</span>
                      </li>
                    ))
                  : staticMen.map((o) => (
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
              {recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          </div>
        </div>
      </Card>
    </div>
  );
}
