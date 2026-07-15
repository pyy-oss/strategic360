import React, { useState } from "react";
import { T } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useIsExec } from "../../../lib/rbac";
import { exportBriefingPdf, generateBriefing, reviewBriefing, useLatestBriefing, type Briefing as BriefingDoc } from "../lib/briefings";

/**
 * "Briefing exécutif" (pyramide de Minto) — reads the latest generated `briefings` document only
 * (no sample fallback). When none exists yet, an explicit empty state invites the exec user to
 * use "Générer un briefing". Generate/export are exec-gated (`useIsExec()`); server-side
 * `requireExecCaller` remains the sole authority.
 */

function ActionBar({ briefing, isExec }: { briefing: BriefingDoc | null; isExec: boolean }) {
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
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

  // Franchit (ou retire) le gate de revue humaine. Sans ce bouton, le board pack restait a vie en
  // « Brouillon — a valider » et n'engageait aucune decision (audit valeur CXO 2026-07).
  async function handleReview(reviewed: boolean) {
    if (!briefing) return;
    setReviewing(true);
    setErr(null);
    try {
      await reviewBriefing(briefing.id, reviewed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de la mise à jour du statut.");
    } finally {
      setReviewing(false);
    }
  }

  const isDraft = !!briefing && briefing.status === "draft";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {briefing && isDraft && (
          <button className="pill on" onClick={() => handleReview(true)} disabled={reviewing} title="Valider ce briefing après revue — il devient exploitable comme décision">
            {reviewing ? "Validation…" : "Valider (revue faite)"}
          </button>
        )}
        {briefing && !isDraft && (
          <button className="pill" onClick={() => handleReview(false)} disabled={reviewing} title="Repasser en brouillon (retirer la validation)">
            {reviewing ? "…" : "Retirer la validation"}
          </button>
        )}
        <button className="pill" onClick={handleGenerate} disabled={generating}>
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

  if (!loading && !briefing) {
    return (
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <Eyebrow color={T.gold}>Briefing exécutif</Eyebrow>
            <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>Généré par IA · revue humaine obligatoire · exportable en board pack PDF</div>
          </div>
          <ActionBar briefing={null} isExec={isExec} />
        </div>
        <div style={{ marginTop: 14, fontSize: 12.5, color: T.faint }}>
          Aucun briefing généré — utilisez « Générer un briefing ».
        </div>
      </Card>
    );
  }

  if (!briefing) {
    return (
      <Card>
        <div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div>
      </Card>
    );
  }

  const args: [string, string, string][] = briefing.arguments.map(
    (a, i) => [a.title, [T.emerald, T.gold, T.clay][i] ?? T.gold, a.body] as [string, string, string]
  );
  const opportunities = briefing.content.topOpportunities ?? [];
  const threats = briefing.content.topThreats ?? [];
  const recommendations = briefing.content.recommendations ?? [];
  const decisionsRequested = briefing.content.decisionsRequested ?? [];

  return (
    <div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <Eyebrow color={T.gold}>Briefing exécutif — {briefing.period}</Eyebrow>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: T.faint }}>Généré par IA · revue humaine obligatoire · exportable en board pack PDF · les repères [n] renvoient au signal source (provenance), ils n'attestent pas la véracité de l'affirmation</span>
              {briefing.status === "draft"
                ? <Badge c={T.gold}>Brouillon — en attente de revue</Badge>
                : <Badge c={T.emerald}>✓ Validé — revue humaine faite</Badge>}
            </div>
          </div>
          <ActionBar briefing={briefing} isExec={isExec} />
        </div>
        <div style={{ marginTop: 14, fontSize: 13, color: T.dim, lineHeight: 1.7 }}>
          <div style={{ padding: "14px 16px", background: `linear-gradient(135deg,${T.panel2},${T.panel})`, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".13em", textTransform: "uppercase", color: T.gold, fontWeight: 600, marginBottom: 6 }}>Idée directrice (pyramide de Minto)</div>
            <div style={{ fontSize: 15, color: T.ink, fontWeight: 600, lineHeight: 1.5 }}>{briefing.governingThought}</div>
            {args.length > 0 && (
              <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 12 }}>
                {args.map((a, i) => (
                  <div key={i} style={{ background: T.panel2, borderRadius: 9, padding: "10px 12px", borderTop: `3px solid ${a[1]}` }}>
                    <div style={{ fontSize: 12.5, color: a[1], fontWeight: 600, marginBottom: 5 }}>{a[0]}</div>
                    <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.5 }}>{a[2]}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {briefing.content.narrative && <p style={{ margin: "0 0 12px" }}>{briefing.content.narrative}</p>}
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 12, color: T.emerald, fontWeight: 600, marginBottom: 6 }}>3 opportunités majeures</div>
              {opportunities.length === 0 ? (
                <div style={{ fontSize: 12, color: T.faint }}>—</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7, color: T.dim, fontSize: 12.5 }}>
                  {opportunities.map((o, i) => (
                    <li key={i}>
                      {o.title} <span style={{ color: T.faint }} title="score de priorité estimé par l'IA (non calculé) — à valider en revue">(est. IA {o.score})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.clay, fontWeight: 600, marginBottom: 6 }}>3 menaces à traiter</div>
              {threats.length === 0 ? (
                <div style={{ fontSize: 12, color: T.faint }}>—</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7, color: T.dim, fontSize: 12.5 }}>
                  {threats.map((o, i) => (
                    <li key={i}>
                      {o.title} <span style={{ color: T.faint }} title="score de priorité estimé par l'IA (non calculé) — à valider en revue">(est. IA {o.score})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {recommendations.length > 0 && (
            <div style={{ marginTop: 14, padding: "12px 14px", background: T.panel2, borderRadius: 10, borderLeft: `3px solid ${T.gold}` }}>
              <div style={{ fontSize: 12, color: T.gold, fontWeight: 600, marginBottom: 8 }}>Recommandations au comité</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {recommendations.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: T.gold, fontWeight: 700, paddingTop: 1 }}>{i + 1}.</span>
                    <div>
                      <div style={{ fontSize: 13, color: T.ink, fontWeight: 600, lineHeight: 1.5 }}>{r.action}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 3, fontSize: 11.5, color: T.dim }}>
                        <span>👤 {r.owner}</span>
                        <span>📅 {r.deadline}</span>
                        {r.expectedValue && <span style={{ color: T.emerald }}>💰 {r.expectedValue}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {decisionsRequested.length > 0 && (
            <div style={{ marginTop: 12, padding: "12px 14px", background: T.panel2, borderRadius: 10, borderLeft: `3px solid ${T.clay}` }}>
              <div style={{ fontSize: 12, color: T.clay, fontWeight: 600, marginBottom: 6 }}>Décisions demandées au comité</div>
              <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8, color: T.ink, fontSize: 12.5 }}>
                {decisionsRequested.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
