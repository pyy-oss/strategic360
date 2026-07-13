import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, fmt, pct } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge } from "../../../design/ui";
import { useIsExec } from "../../../lib/rbac";
import { useAuthClaims } from "../../../lib/AuthProvider";
import { useCopiloteAccounts } from "../lib/copilote";
import { aggregateTeam, useSalesTargets, setSalesTarget, type OwnerCockpit } from "../lib/team";

/** Couverture forecast vs objectif : vert ≥100 %, or 70-99 %, rouge <70 %. */
function coverageColor(ratio: number): string {
  return ratio >= 1 ? T.emerald : ratio >= 0.7 ? T.gold : T.clay;
}

/** Cellule de couverture éditable (le manager fixe l'objectif ; la couverture s'en déduit). */
function CoverageCell({ owner, pipeline, target }: { owner: string; pipeline: number; target: number }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(target || ""));
  const save = async () => { await setSalesTarget(owner, Number(val) || 0); setEditing(false); };
  const ratio = target > 0 ? pipeline / target : null;
  return (
    <div>
      <div style={{ fontSize: 11, color: T.dim, marginBottom: 4, fontWeight: 600 }}>Couverture vs objectif</div>
      {editing ? (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))} placeholder="objectif XOF"
            style={{ width: 120, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6, color: T.ink, fontSize: 12, padding: "4px 7px" }} />
          <button className="pill on" onClick={() => void save()} style={{ fontSize: 11, padding: "3px 8px" }}>OK</button>
        </div>
      ) : ratio != null ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 20, fontWeight: 700, color: coverageColor(ratio) }}>{pct(ratio)}</span>
          <span style={{ fontSize: 11, color: T.faint }}>{fmt(pipeline)} / {fmt(target)}</span>
          <button className="pill" onClick={() => { setVal(String(target)); setEditing(true); }} style={{ fontSize: 10, padding: "2px 7px" }}>modifier</button>
        </div>
      ) : (
        <button className="pill" onClick={() => setEditing(true)} style={{ fontSize: 11, padding: "3px 8px" }}>+ Fixer un objectif</button>
      )}
    </div>
  );
}

/**
 * « Pilotage équipe » (levier « waouh » n°7) — le cockpit du Directeur Commercial. Agrège par
 * COMMERCIAL (owner) l'intelligence déjà calculée au niveau portefeuille : forecast pondéré, réserve
 * de valeur disponible, deals chauds, déclencheurs de veille, et LA prochaine meilleure action par
 * compte. Réservé aux managers (direction commerciale / exécutifs) — le cloisonnement serveur
 * (listCopiloteAccounts) garantit déjà le périmètre.
 */
function OwnerCard({ c, target }: { c: OwnerCockpit; target: number }) {
  const navigate = useNavigate();
  const label = c.owner === "(non attribué)" ? "Comptes non attribués" : c.owner;
  const editable = c.owner !== "(non attribué)";
  return (
    <Card style={{ borderLeft: `3px solid ${T.emerald}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Eyebrow color={T.emerald}>{label}</Eyebrow>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {c.wins > 0 && <Badge c={T.emerald}>{c.wins} gagné{c.wins > 1 ? "s" : ""}</Badge>}
          <Badge c={T.faint}>{c.comptes} compte{c.comptes > 1 ? "s" : ""}</Badge>
        </div>
      </div>
      {editable && (
        <div style={{ marginTop: 12 }}>
          <CoverageCell owner={c.owner} pipeline={c.pipelinePondere} target={target} />
        </div>
      )}
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 12 }}>
        <Kpi label="Forecast pondéré" value={fmt(c.pipelinePondere)} accent={T.emerald} sub="pipeline × proba" />
        <Kpi label="Réserve disponible" value={fmt(c.reserveDisponible)} accent={T.gold} sub="cross-sell + upsell" />
        <Kpi label="Deals chauds" value={String(c.dealsChauds)} accent={T.clay} sub="veille chaude" />
        <Kpi label="Déclencheurs veille" value={String(c.veilleTriggers)} accent={T.steel} sub="signaux rattachés" />
      </div>
      {c.prochainesActions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: T.dim, fontWeight: 600, marginBottom: 6 }}>Prochaines meilleures actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {c.prochainesActions.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 10px", background: T.panel2, borderRadius: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.ink, overflowWrap: "anywhere" }}>{a.account} — {a.action}</div>
                  <div style={{ fontSize: 10.5, color: T.faint }}>{a.why}</div>
                </div>
                <div style={{ fontSize: 11.5, color: a.montant > 0 ? T.emerald : T.faint, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.montant > 0 ? fmt(a.montant) : "à chiffrer"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {c.topComptes.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {c.topComptes.map((t) => (
            <button key={t.nom} className="pill" onClick={() => navigate(`/veille/copilote?account=${encodeURIComponent(t.nom)}`)} title="Ouvrir dans le Copilote" style={{ fontSize: 10.5, padding: "3px 8px" }}>
              {t.nom} · {fmt(t.pipelinePondere)}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Equipe() {
  const isExec = useIsExec();
  const { role } = useAuthClaims();
  const isManager = isExec || role === "commercial_dir";
  const { accounts, loading } = useCopiloteAccounts();
  const { targets } = useSalesTargets();
  const team = React.useMemo(() => aggregateTeam(accounts), [accounts]);
  const totals = React.useMemo(() => ({
    pipe: team.reduce((s, c) => s + c.pipelinePondere, 0),
    reserve: team.reduce((s, c) => s + c.reserveDisponible, 0),
    chauds: team.reduce((s, c) => s + c.dealsChauds, 0),
    target: team.reduce((s, c) => s + (targets[c.owner] || 0), 0),
  }), [team, targets]);

  if (!isManager) {
    return (
      <Card>
        <Eyebrow color={T.gold}>Pilotage équipe</Eyebrow>
        <div style={{ fontSize: 13, color: T.dim, marginTop: 8 }}>
          Vue réservée à la direction commerciale (pilotage de la force de vente).
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Eyebrow color={T.emerald}>Pilotage équipe — forecast & couverture par commercial</Eyebrow>
        <div style={{ fontSize: 12.5, color: T.dim, marginTop: 6 }}>
          L'intelligence du portefeuille agrégée par tête : forecast pondéré, réserve à aller chercher, deals chauds et prochaine action par compte.
        </div>
      </div>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        <Card><Kpi label="Forecast pondéré — équipe" value={loading ? "…" : fmt(totals.pipe)} accent={T.emerald} sub="somme pipeline pondéré" /></Card>
        <Card><Kpi
          label="Couverture d'objectif"
          value={totals.target > 0 ? pct(totals.pipe / totals.target) : "—"}
          accent={totals.target > 0 ? coverageColor(totals.pipe / totals.target) : T.faint}
          sub={totals.target > 0 ? `${fmt(totals.pipe)} / ${fmt(totals.target)}` : "fixez les objectifs par tête ▸"} /></Card>
        <Card><Kpi label="Réserve disponible — équipe" value={loading ? "…" : fmt(totals.reserve)} accent={T.gold} sub="cross-sell + upsell non capté" /></Card>
        <Card><Kpi label="Deals chauds — équipe" value={loading ? "…" : String(totals.chauds)} accent={T.clay} sub="comptes en veille chaude" /></Card>
      </div>
      {!loading && team.length === 0 && (
        <Card><div style={{ fontSize: 12.5, color: T.dim }}>Aucun compte dans votre périmètre — synchronisez les comptes du Copilote (nt360) ou attribuez des comptes à vos commerciaux.</div></Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {team.map((c) => <OwnerCard key={c.owner} c={c} target={targets[c.owner] || 0} />)}
      </div>
    </div>
  );
}
