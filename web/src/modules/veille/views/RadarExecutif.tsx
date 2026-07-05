import React from "react";
import { T } from "../../../design/tokens";
import { AX, IMP, PROX, STANCE, fmt, pct } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge } from "../../../design/ui";
import { Toggle } from "../../../design/fields";
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
            label="Pipeline sur comptes suivis"
            value={exec && exec.pipelineInfluenced != null ? fmt(exec.pipelineInfluenced) : "—"}
            accent={T.emerald}
            sub="montant brut · comptes en veille / watchlist"
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
                  <div style={{ fontSize: 12.5, color: T.ink, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{s.title}</div>
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
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr)", gap: 6, alignItems: "center" }}>
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
                <div style={{ fontSize: 12.5, color: T.ink, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{s.title}</div>
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
            <div key={d.id} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 12.5, padding: "8px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none" }}>
              <div style={{ width: 74, flexShrink: 0 }}>
                <Badge c={d.statut === "Actée" ? T.emerald : d.statut === "En cours" ? T.gold : T.clay}>{d.statut}</Badge>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "2px 10px" }}>
                <span style={{ color: T.ink, overflowWrap: "anywhere" }}>{d.title}</span>
                <span style={{ color: T.faint, fontSize: 11.5, overflowWrap: "anywhere" }}>
                  {d.decidedBy}
                  {d.linkedItems?.length ? ` · ${d.linkedItems.join(", ")}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <WatchlistPanel entries={watchlist} loading={watchLoading} />
    </div>
  );
}

/** Couleur de priorité — code commun watchlist. */
const prioColor = (p: string) => (p === "Haute" ? T.clay : p === "Moyenne" ? T.gold : T.faint);
const prioRank = (p: string) => (p === "Haute" ? 0 : p === "Moyenne" ? 1 : 2);

/**
 * Watchlist repensée (audit design 2026-07) : une liste plate de ~54 entités était illisible.
 * On la transforme en tableau de bord scannable — recherche + filtre de priorité, regroupement
 * par TYPE (concurrents, régulateurs, clients…), et grille dense de puces compactes où la priorité
 * est portée par la barre de gauche colorée (plus de badge répété par ligne).
 */
function WatchlistPanel({ entries, loading }: { entries: import("../lib/intel").IntelWatchlistEntry[]; loading: boolean }) {
  const [q, setQ] = React.useState("");
  const [prio, setPrio] = React.useState("all");
  const [showInactive, setShowInactive] = React.useState(false);

  const ql = q.trim().toLowerCase();
  const filtered = entries
    .filter((w) => showInactive || w.active)
    .filter((w) => prio === "all" || w.priority === prio)
    .filter((w) => !ql || w.name.toLowerCase().includes(ql) || (w.type ?? "").toLowerCase().includes(ql) || (w.geo ?? "").toLowerCase().includes(ql));

  // Regroupement par type, groupes triés par effectif décroissant ; entités triées priorité puis nom.
  const groups = new Map<string, typeof filtered>();
  for (const w of filtered) {
    const k = w.type || "Autre";
    if (!groups.has(k)) groups.set(k, [] as typeof filtered);
    groups.get(k)!.push(w);
  }
  const ordered = [...groups.entries()]
    .map(([type, list]) => [type, [...list].sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || a.name.localeCompare(b.name))] as const)
    .sort((a, b) => b[1].length - a[1].length);

  const activeCount = entries.filter((w) => w.active).length;
  const PRIOS = ["all", "Haute", "Moyenne", "Basse"];

  return (
    <Card style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.plum}>Watchlist — entités surveillées</Eyebrow>
        <Badge c={T.plum}>{activeCount} actives</Badge>
      </div>

      {loading && entries.length === 0 && <div style={{ marginTop: 12, fontSize: 12, color: T.faint }}>Chargement de la watchlist…</div>}
      {!loading && entries.length === 0 && <div style={{ marginTop: 12, fontSize: 12, color: T.faint }}>Aucune entité en watchlist pour l'instant.</div>}

      {entries.length > 0 && (
        <>
          {/* Barre de contrôle : recherche + filtres de priorité. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher une entité, un type, un pays…"
              style={{ flex: "1 1 200px", minWidth: 0, background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 999, color: T.ink, fontSize: 12.5, padding: "9px 14px" }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PRIOS.map((p) => (
                <button key={p} className={`pill ${prio === p ? "on" : ""}`} onClick={() => setPrio(p)}>
                  {p === "all" ? "Toutes" : p}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 11.5, color: T.faint }}>
              {filtered.length} entité{filtered.length > 1 ? "s" : ""} · {ordered.length} type{ordered.length > 1 ? "s" : ""}
            </span>
            <Toggle checked={showInactive} onChange={setShowInactive} label="Afficher les inactives" />

          </div>

          {filtered.length === 0 && <div style={{ marginTop: 12, fontSize: 12, color: T.faint }}>Aucune entité ne correspond à ce filtre.</div>}

          {ordered.map(([type, list]) => (
            <div key={type} style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.dim }}>{type}</span>
                <span style={{ height: 1, flex: 1, background: T.line }} />
                <Badge c={T.faint}>{list.length}</Badge>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 8 }}>
                {list.map((w) => (
                  <div
                    key={w.id}
                    title={`${w.name} · ${w.priority}${w.geo ? ` · ${w.geo}` : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "8px 11px", background: T.panel2, borderRadius: 9, borderLeft: `3px solid ${prioColor(w.priority)}`, opacity: w.active ? 1 : 0.55 }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: T.ink, fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</div>
                      <div style={{ color: T.faint, fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {w.priority}
                        {w.geo ? ` · ${w.geo}` : ""}
                        {!w.active ? " · inactive" : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
