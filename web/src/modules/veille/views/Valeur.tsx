import React, { useState } from "react";
import { T, fmt, pct, AMBITION_LABEL } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge } from "../../../design/ui";
import { useQuantiSummary } from "../lib/quanti";
import { usePaged, Pager } from "../components/Pager";

/**
 * "Création de valeur" (value bridge · value-at-stake · driver tree).
 *
 * Value-at-stake reads `summaries/quanti.valueAtStake` (open opportunities from the internal
 * pipeline — nt360 since 2026-07-02, or a LIVE Excel import — `ev = probabilité-étape × montant`)
 * — an explicit empty state is shown until the first sync lands. The "pont de valeur" waterfall
 * needs a lever-level decomposition (current CAS → ambition) that no internal source provides
 * yet, so it too is an empty state — no illustrative numbers are rendered.
 *
 * UNITS (audit affichage montants, 2026-07-02): `valueAtStake[].impact` is RAW XOF (opportunity
 * `montant` passed through by computeValueAtStake) — so `ev` is raw XOF too and is formatted with
 * `fmt(ev)` directly. The maquette's `* 1e6` convention only applies to M-FCFA domains (SIM_BASE).
 */
export function Valeur() {
  const { data: quanti } = useQuantiSummary();
  const marg = quanti?.margin ?? null;
  const liveVas = quanti?.valueAtStake && quanti.valueAtStake.length > 0 ? quanti.valueAtStake : null;
  const vas = (liveVas ?? []).map((v) => ({ ...v, ev: Math.round(v.p * v.impact) })).sort((a, b) => Math.abs(b.ev) - Math.abs(a.ev));
  const evOpp = vas.filter((v) => v.type === "opp").reduce((s, v) => s + v.ev, 0);
  const evThreat = vas.filter((v) => (v.type as string) === "threat").reduce((s, v) => s + v.ev, 0);
  // Le value-at-stake interne (nt360) ne porte aujourd'hui que des opportunités : les tuiles
  // « menaces » et « net » sont structurellement à 0 (audit 2026-07). On ne les affiche que si des
  // menaces valorisées existent réellement — sinon une seule tuile honnête, pas deux tuiles mortes.
  const hasThreat = vas.some((v) => (v.type as string) === "threat");
  // Pont de valeur RÉEL (levier « waouh » n°5) — construit depuis les vrais champs quanti nt360 au
  // lieu du placeholder mort « en attente ». Départ CA N-1 → CA réalisé → + pipeline pondéré →
  // projeté. On n'affiche que les étapes dont la donnée existe (honnêteté : aucun chiffre inventé).
  const base = quanti?.casN1Total ?? null;
  const current = quanti?.casTotal ?? null;
  const pipe = quanti?.pipelinePondere ?? null;
  const wr = quanti?.winRate ?? null;
  const projete = current != null ? current + (pipe != null ? pipe * (wr != null ? wr : 1) : 0) : null;
  const hasBridge = current != null;
  const bridgeSteps: { label: string; value: number; accent: string; sub?: string }[] = [
    ...(base != null ? [{ label: "CAS N-1", value: base, accent: T.faint }] : []),
    ...(current != null ? [{ label: "CAS réalisé", value: current, accent: T.emerald, sub: base != null ? `${current - base >= 0 ? "▲ +" : "▼ "}${fmt(current - base)} vs N-1` : undefined }] : []),
    ...(pipe != null ? [{ label: "Pipeline pondéré", value: pipe, accent: T.gold, sub: wr != null ? `× ${pct(wr)} taux de victoire` : "potentiel projet" }] : []),
    ...(projete != null ? [{ label: "Projeté", value: projete, accent: T.steel, sub: "CAS réalisé + pipeline attendu" }] : []),
  ];
  // Longue liste (audit design) : filtre opp/menace (si pertinent) + pagination. L'échelle des
  // barres reste calée sur le max GLOBAL pour rester comparable d'une page à l'autre.
  const [vasFilter, setVasFilter] = useState<"all" | "opp" | "threat">("all");
  const vasFiltered = vas.filter((v) => vasFilter === "all" || (v.type as string) === vasFilter);
  const vasPaged = usePaged(vasFiltered, 12, vasFilter);
  const vasMax = Math.max(...vas.map((x) => Math.abs(x.ev)), 1);
  return (
    <div>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: hasThreat ? "repeat(3,1fr)" : "1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <Kpi label="Valeur attendue — opportunités" value={liveVas ? <>{fmt(evOpp)} <span style={{ fontSize: 13, color: T.dim }}>FCFA</span></> : "—"} accent={T.emerald} sub="Σ (proba × impact)" />
        </Card>
        {hasThreat && (
          <Card>
            <Kpi label="Valeur à risque — menaces" value={<>{fmt(evThreat)} <span style={{ fontSize: 13, color: T.dim }}>FCFA</span></>} accent={T.clay} sub="Σ (proba × impact)" />
          </Card>
        )}
        {hasThreat && (
          <Card>
            <Kpi label="Valeur nette en jeu" value={<>{fmt(evOpp + evThreat)} <span style={{ fontSize: 13, color: T.dim }}>FCFA</span></>} accent={T.gold} sub="valeur nette en jeu" />
          </Card>
        )}
      </div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.gold}>Pont de création de valeur — {AMBITION_LABEL}</Eyebrow>
        {hasBridge ? (
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
            {bridgeSteps.map((s, i) => (
              <React.Fragment key={s.label}>
                {i > 0 && <div style={{ alignSelf: "center", color: T.faint, fontSize: 16 }}>→</div>}
                <div style={{ flex: 1, minWidth: 130, background: T.panel2, borderRadius: 9, padding: "10px 12px", borderTop: `2px solid ${s.accent}` }}>
                  <div style={{ fontSize: 10.5, color: T.faint }}>{s.label}</div>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 18, fontWeight: 700, color: s.accent, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{fmt(s.value)} <span style={{ fontSize: 11, color: T.dim }}>FCFA</span></div>
                  {s.sub && <div style={{ fontSize: 10.5, color: T.dim, marginTop: 2 }}>{s.sub}</div>}
                </div>
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 12, padding: "14px 16px", background: T.panel2, borderRadius: 9, fontSize: 12.5, color: T.dim, lineHeight: 1.5 }}>
            📊 Le pont de valeur (CAS N-1 → réalisé → pipeline → projeté) s'affichera dès la <b style={{ color: T.ink }}>première synchronisation des données internes</b> (P&L / pipeline nt360). Lancez-la depuis <b style={{ color: T.ink }}>Indicateurs</b> ou attendez la synchro quotidienne.
          </div>
        )}
      </Card>
      {/* Moteur de marge (audit 10/10 2026-07) — le nerf d'une ESN : réalisé, objectif, mix par BU
          et marge attendue du pipeline. Masqué tant que la synchro nt360 n'a pas produit de marge. */}
      {marg && marg.avgPct != null && (
        <Card style={{ marginBottom: 14 }}>
          <Eyebrow color={T.clay}>Marge brute — réalisé vs objectif</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 12 }}>
            <Kpi label="Marge réalisée" value={`${marg.avgPct} %`} accent={T.emerald} sub="Σ marge brute / Σ CAS" />
            {marg.targetPct != null && <Kpi label="Objectif" value={`${marg.targetPct} %`} accent={T.gold} sub="cible nt360" />}
            {marg.deltaVsTargetPts != null && (
              <Kpi label="Écart vs objectif" value={`${marg.deltaVsTargetPts > 0 ? "+" : ""}${marg.deltaVsTargetPts} pt`} accent={marg.deltaVsTargetPts >= 0 ? T.emerald : T.clay} sub={marg.deltaVsTargetPts >= 0 ? "au-dessus de la cible" : "sous la cible"} />
            )}
            {marg.pipelineExpectedPct != null && (
              <Kpi label="Marge attendue du pipeline" value={`${marg.pipelineExpectedPct} %`} accent={marg.avgPct != null && marg.pipelineExpectedPct < marg.avgPct ? T.clay : T.steel} sub="anticipe la dérive de mix" />
            )}
          </div>
          {marg.byBu.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 12 }}>
              {marg.byBu.map((b) => (
                <div key={b.n} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                  <span style={{ width: 110, color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.n}</span>
                  <div style={{ flex: 1, height: 8, background: T.panel2, borderRadius: 4 }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, b.pct ?? 0))}%`, height: "100%", background: (b.pct ?? 0) >= 25 ? T.emerald : (b.pct ?? 0) >= 12 ? T.gold : T.clay, borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 52, textAlign: "right", color: T.ink, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{b.pct != null ? `${b.pct} %` : "—"}</span>
                  <span style={{ width: 110, textAlign: "right", color: T.faint, fontVariantNumeric: "tabular-nums" }}>{fmt(b.cas)}</span>
                </div>
              ))}
              <div style={{ fontSize: 10.5, color: T.faint, marginTop: 3 }}>Le mix révèle où se gagne la marge : un CA hardware volumineux à faible taux ne vaut pas un managé/formation récurrent.</div>
            </div>
          )}
        </Card>
      )}
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.emerald}>Value-at-stake (proba × impact)</Eyebrow>
            {liveVas && <Badge c={T.emerald}>Temps réel (pipeline interne nt360)</Badge>}
          </div>
          {!liveVas && (
            <div style={{ marginTop: 10, padding: "12px 14px", background: T.panel2, borderRadius: 9, fontSize: 12.5, color: T.dim, lineHeight: 1.5 }}>
              💼 La valeur en jeu (opportunités × probabilité) apparaîtra dès que le <b style={{ color: T.ink }}>pipeline interne</b> sera synchronisé (nt360). En attendant, le Copilote et le Radar exécutif chiffrent déjà la réserve de valeur au niveau des comptes.
            </div>
          )}
          {hasThreat && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {([["all", "Tout"], ["opp", "Opportunités"], ["threat", "Menaces"]] as const).map(([k, l]) => (
                <button key={k} className={`pill ${vasFilter === k ? "on" : ""}`} onClick={() => setVasFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {vasPaged.pageItems.map((v, i) => (
              <div key={`${v.n}-${vasPaged.start + i}`}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3, gap: 8 }}>
                  <span style={{ color: T.ink, minWidth: 0, overflowWrap: "anywhere" }}>
                    {v.n} <span style={{ color: T.faint }}>· {pct(v.p)}</span>
                  </span>
                  <span style={{ color: v.ev >= 0 ? T.emerald : T.clay, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {v.ev >= 0 ? "+" : ""}
                    {fmt(v.ev)}
                  </span>
                </div>
                <div style={{ height: 6, background: T.panel2, borderRadius: 4 }}>
                  <div style={{ width: `${Math.min((Math.abs(v.ev) / vasMax) * 100, 100)}%`, height: "100%", background: v.ev >= 0 ? T.emerald : T.clay, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
          <Pager {...vasPaged} />
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
