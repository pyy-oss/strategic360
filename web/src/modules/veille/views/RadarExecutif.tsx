import React from "react";
import { T } from "../../../design/tokens";
import { AX, IMP, PROX, STANCE, fmt, pct } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge } from "../../../design/ui";
import { useDecisions } from "../lib/execution";
import { useIntelItems, useWatchlist } from "../lib/intel";
import { isPastDue } from "../lib/freshness";
import { useVeilleExecSummary } from "../lib/summaries";

export interface RadarExecutifProps {
  lens: string;
  setView: (v: string) => void;
}

/** "Radar exécutif" — ported from `Radar_` in the maquette (renamed to avoid clashing with Recharts' Radar). */
export function RadarExecutif({ lens, setView }: RadarExecutifProps) {
  const { entries: watchlist, loading: watchLoading } = useWatchlist();
  const { decisions, loading: decisionsLoading } = useDecisions();
  const { items } = useIntelItems();
  const { data: exec } = useVeilleExecSummary();
  const sorted = [...items].sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const menaces = sorted.filter((s) => s.stance === "threat");
  const opps = sorted.filter((s) => s.stance === "opportunity");
  // « Business imminent » (plan d'audit §5.4) : signaux à échéance proche OU à contenu business
  // direct (AO, fins de vie, réglementation, financements), déjà triés par priorityScore.
  // Anti-obsolescence : on EXCLUT les items périmés (échéance dépassée) — un AO déjà clos ou un
  // scrutin passé n'a rien d'« imminent ».
  const nowMs = Date.now();
  const bizImminent = sorted
    .filter((s) => !isPastDue(s, nowMs))
    .filter((s) => s.prox === "imminent" || s.prox === "court" || ["tender", "eol", "regulation", "funding"].includes(s.subtype ?? ""))
    .slice(0, 6);
  const cell = (imp: string, st: string) => items.filter((s) => s.impact === imp && s.stance === st).length;
  const intro = (
    {
      dg: "Situation, menaces et opportunités majeures, décisions en attente — l'essentiel pour arbitrer.",
      strategie: "Signaux prioritaires reliés aux cadres et aux initiatives.",
      innovation: "Signaux technologiques et d'innovation à fort potentiel.",
    } as Record<string, string>
  )[lens];
  return (
    <div>
      <div style={{ fontSize: 12, color: T.plum, marginBottom: 14, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
        🎯 {intro}
      </div>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 14 }}>
        <Card>
          <Kpi
            label="Pipeline influencé par la veille"
            value={exec && exec.pipelineInfluenced != null ? fmt(exec.pipelineInfluenced) : "—"}
            accent={T.emerald}
            sub="opportunités issues de signaux"
          />
        </Card>
        <Card>
          <Kpi
            label="Menaces (traitées / total)"
            value={exec ? `${exec.boardKpis.menacesTraitees} / ${exec.boardKpis.menacesTotal}` : "—"}
            accent={T.clay}
            sub="couverture décisionnelle"
          />
        </Card>
        <Card>
          <Kpi
            label="Taux de victoire"
            value={exec && exec.boardKpis?.winRateGlobal != null ? pct(exec.boardKpis.winRateGlobal) : "—"}
            accent={T.gold}
            sub="vs concurrents (win/loss)"
          />
        </Card>
        <Card>
          <Kpi
            label="Avancement OKR"
            value={exec && exec.okrProgress != null ? pct(exec.okrProgress) : "—"}
            accent={T.steel}
            sub="initiatives stratégiques"
          />
        </Card>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <Eyebrow color={T.gold}>Top signaux prioritaires</Eyebrow>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.slice(0, 6).map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: T.panel2, borderRadius: 9, borderLeft: `3px solid ${STANCE[s.stance].c}` }}>
                <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16, color: STANCE[s.stance].c, minWidth: 30, textAlign: "center" }}>{s.priorityScore ?? "—"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <Badge c={AX[s.axis]?.c}>{AX[s.axis]?.l ?? s.axis}</Badge>
                    <Badge c={IMP[s.impact]?.c}>{IMP[s.impact]?.l ?? s.impact}</Badge>
                    <Badge c={T.faint}>{s.sourceRating}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="tab" style={{ color: T.steel, marginTop: 8 }} onClick={() => setView("fil")}>
            Voir le fil complet →
          </button>
        </Card>
        <Card>
          <Eyebrow color={T.clay}>Carte menaces / opportunités</Eyebrow>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "70px 1fr 1fr", gap: 6, alignItems: "center" }}>
            <div />
            <div style={{ textAlign: "center", fontSize: 11, color: T.emerald, fontWeight: 600 }}>Opportunité</div>
            <div style={{ textAlign: "center", fontSize: 11, color: T.clay, fontWeight: 600 }}>Menace</div>
            {["high", "medium", "low"].map((imp) => (
              <React.Fragment key={imp}>
                <div style={{ fontSize: 11, color: IMP[imp].c, fontWeight: 600, textAlign: "right" }}>{IMP[imp].l}</div>
                <div style={{ background: T.emerald + (imp === "high" ? "33" : imp === "medium" ? "22" : "11"), borderRadius: 8, padding: "14px 0", textAlign: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, color: T.emerald }}>
                  {cell(imp, "opportunity")}
                </div>
                <div style={{ background: T.clay + (imp === "high" ? "33" : imp === "medium" ? "22" : "11"), borderRadius: 8, padding: "14px 0", textAlign: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, color: T.clay }}>
                  {cell(imp, "threat")}
                </div>
              </React.Fragment>
            ))}
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: T.dim }}>
            {opps.length} opportunités · {menaces.length} menaces sur {items.length} signaux actifs.
          </div>
        </Card>
      </div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.emerald}>💼 Business imminent</Eyebrow>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {bizImminent.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint }}>Aucun signal business à échéance proche pour l'instant.</div>
          )}
          {bizImminent.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: T.panel2, borderRadius: 9, borderLeft: `3px solid ${s.prox === "imminent" ? T.clay : T.emerald}` }}>
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16, color: STANCE[s.stance]?.c ?? T.ink, minWidth: 30, textAlign: "center" }}>{s.priorityScore ?? "—"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <Badge c={s.prox === "imminent" ? T.clay : T.gold}>
                    {s.dueDate ? `Échéance ${s.dueDate}` : s.prox ? PROX[s.prox]?.l ?? s.prox : "Échéance non datée"}
                  </Badge>
                  {s.ent && <Badge c={T.plum}>{s.ent}</Badge>}
                  <Badge c={AX[s.axis]?.c}>{AX[s.axis]?.l ?? s.axis}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <Eyebrow color={T.steel}>Décisions en attente / récentes</Eyebrow>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {decisionsLoading && decisions.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint }}>Chargement des décisions…</div>
          )}
          {!decisionsLoading && decisions.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint }}>Aucune décision enregistrée pour l'instant.</div>
          )}
          {decisions.map((d, i) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "7px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none" }}>
              <Badge c={d.statut === "Actée" ? T.emerald : d.statut === "En cours" ? T.gold : T.clay}>{d.statut}</Badge>
              <span style={{ flex: 1, color: T.ink }}>{d.title}</span>
              <span style={{ color: T.faint }}>
                {d.decidedBy}
                {d.linkedItems?.length ? ` · ${d.linkedItems.join(", ")}` : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow color={T.plum}>Watchlist — entités surveillées</Eyebrow>
          <Badge c={T.plum}>{watchlist.filter((w) => w.active).length} actives</Badge>
        </div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {watchLoading && watchlist.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint }}>Chargement de la watchlist…</div>
          )}
          {!watchLoading && watchlist.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint }}>Aucune entité en watchlist pour l'instant.</div>
          )}
          {watchlist.map((w, i) => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, padding: "7px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none" }}>
              <Badge c={w.priority === "Haute" ? T.clay : w.priority === "Moyenne" ? T.gold : T.faint}>{w.priority}</Badge>
              <span style={{ flex: 1, color: T.ink }}>{w.name}</span>
              <span style={{ color: T.faint }}>
                {w.type}
                {w.geo ? ` · ${w.geo}` : ""}
              </span>
              {!w.active && <Badge c={T.faint}>Inactive</Badge>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
