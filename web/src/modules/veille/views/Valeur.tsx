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
  const liveVas = quanti?.valueAtStake && quanti.valueAtStake.length > 0 ? quanti.valueAtStake : null;
  const vas = (liveVas ?? []).map((v) => ({ ...v, ev: Math.round(v.p * v.impact) })).sort((a, b) => Math.abs(b.ev) - Math.abs(a.ev));
  const evOpp = vas.filter((v) => v.type === "opp").reduce((s, v) => s + v.ev, 0);
  const evThreat = vas.filter((v) => (v.type as string) === "threat").reduce((s, v) => s + v.ev, 0);
  // Le value-at-stake interne (nt360) ne porte aujourd'hui que des opportunités : les tuiles
  // « menaces » et « net » sont structurellement à 0 (audit 2026-07). On ne les affiche que si des
  // menaces valorisées existent réellement — sinon une seule tuile honnête, pas deux tuiles mortes.
  const hasThreat = vas.some((v) => (v.type as string) === "threat");
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
          <Kpi label="Valeur attendue — opportunités" value={liveVas ? fmt(evOpp) : "—"} accent={T.emerald} sub="Σ (proba × impact)" />
        </Card>
        {hasThreat && (
          <Card>
            <Kpi label="Valeur à risque — menaces" value={fmt(evThreat)} accent={T.clay} sub="Σ (proba × impact)" />
          </Card>
        )}
        {hasThreat && (
          <Card>
            <Kpi label="Valeur nette en jeu" value={fmt(evOpp + evThreat)} accent={T.gold} sub="net at stake" />
          </Card>
        )}
      </div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.gold}>Pont de création de valeur — {AMBITION_LABEL}</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Pont de valeur — en attente des imports internes.</div>
      </Card>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.emerald}>Value-at-stake (proba × impact)</Eyebrow>
            {liveVas && <Badge c={T.emerald}>Temps réel (pipeline interne nt360)</Badge>}
          </div>
          {!liveVas && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente de la première synchronisation interne (nt360).</div>
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
