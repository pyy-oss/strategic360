import React, { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell, LineChart, Line } from "recharts";
import { T, fmt, pct } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge, Slider, Gauge } from "../../../design/ui";
import { SIM_BASE, SCEN_OPTS, LEVMETA, PRESETS, simCompute, SimParams, SimBase } from "../data";
import { useQuantiSummary } from "../lib/quanti";

/**
 * Calibrates `SIM_BASE` from `summaries/quanti` (BUILD_KIT.md §8.2 "SIM_BASE ← calibrer sur
 * données réelles" / §11 "Simulateur | summaries/quanti (calibrage) + état local").
 *
 * Only the fields that actually have a real-data source are overridden:
 *  - `cas`      ← `summaries/quanti.casTotal` (portfolio-wide CAS from P&L `orders`, V5 addition
 *                 — see `functions/domain/quanti.js#computeCasSummary`).
 *  - `pipe`     ← `summaries/quanti.pipelinePondere` (LIVE, computed since V4).
 *  - `winBase`  ← `summaries/quanti.winRate` (LIVE, computed since V4), expressed as 0-100 like
 *                 the maquette's `winBase:62`.
 * `recurrent`, `margePct`, `ambition` and `objMarge` are NOT calibrated: there is no internal
 * source for a "récurrent vs projet" split yet (`summaries/quanti.recurrentShare` is always null
 * — prerequisite tag missing, DELTA_01 §3bis.F, documented in `functions/domain/quanti.js`), no
 * computed `marginAvg` (also always null in V4/V5 scope), and `ambition`/`objMarge` are genuine
 * business targets with no internal-data source at all — they stay the maquette's hardcoded
 * constants, which is correct (not everything is calibratable).
 *
 * Returns the maquette's exact hardcoded `SIM_BASE` (untouched) whenever `summaries/quanti` is
 * null/loading/has none of the 3 calibratable fields — the Simulateur must never break or show
 * an empty state just because no internal file has been ingested yet in this environment.
 */
function calibrateSimBase(quanti: ReturnType<typeof useQuantiSummary>["data"]): { base: SimBase; calibrated: boolean } {
  if (!quanti) return { base: SIM_BASE, calibrated: false };
  // UNIT BOUNDARY (audit affichage montants, 2026-07-02): summaries/quanti carries RAW XOF
  // (casTotal ~3.6e9, pipelinePondere ~6e10 — computed from nt360), while the SIM_BASE domain —
  // simCompute's math, the ambition constant (15300), and every fmt(x * 1e6) display below — is
  // in M FCFA. Convert here, at the calibration boundary, so both sides stay consistent.
  const cas = quanti.casTotal != null ? Math.round(quanti.casTotal / 1e6) : null;
  const pipe = quanti.pipelinePondere != null ? Math.round(quanti.pipelinePondere / 1e6) : null;
  const winBase = quanti.winRate != null ? Math.round(quanti.winRate * 100) : null;
  const calibrated = cas != null || pipe != null || winBase != null;
  return {
    base: {
      ...SIM_BASE,
      ...(cas != null ? { cas } : {}),
      ...(pipe != null ? { pipe } : {}),
      ...(winBase != null ? { winBase } : {}),
    },
    calibrated,
  };
}

/** "Simulateur stratégique" — ported from `Simulateur` in the maquette. */
export function Simulateur() {
  const { data: quanti } = useQuantiSummary();
  const { base: BASE, calibrated } = useMemo(() => calibrateSimBase(quanti), [quanti]);
  const D: SimParams = { managed: 40, cloud: 30, aoBad: 40, win: 62, newAcc: 30, mix: 35, tarif: 40, attrition: 30, invest: 40, horizon: 3, scenario: "central" };
  const [managed, setManaged] = useState(D.managed);
  const [cloud, setCloud] = useState(D.cloud);
  const [aoBad, setAoBad] = useState(D.aoBad);
  const [win, setWin] = useState(D.win);
  const [newAcc, setNewAcc] = useState(D.newAcc);
  const [mix, setMix] = useState(D.mix);
  const [tarif, setTarif] = useState(D.tarif);
  const [attrition, setAttrition] = useState(D.attrition);
  const [invest, setInvest] = useState(D.invest);
  const [horizon, setHorizon] = useState(D.horizon);
  const [scenario, setScenario] = useState(D.scenario);
  const reset = () => {
    setManaged(D.managed);
    setCloud(D.cloud);
    setAoBad(D.aoBad);
    setWin(D.win);
    setNewAcc(D.newAcc);
    setMix(D.mix);
    setTarif(D.tarif);
    setAttrition(D.attrition);
    setInvest(D.invest);
    setHorizon(D.horizon);
    setScenario(D.scenario);
  };

  const params: SimParams = { managed, cloud, aoBad, win, newAcc, mix, tarif, attrition, invest, horizon, scenario };
  const deps = [managed, cloud, aoBad, win, newAcc, mix, tarif, attrition, invest, horizon, scenario, BASE];
  const R = useMemo(() => simCompute(params, BASE), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const tor = useMemo(
    () =>
      LEVMETA.map((m) => {
        const lo = simCompute({ ...params, [m.k]: m.min } as SimParams, BASE).score;
        const hi = simCompute({ ...params, [m.k]: m.max } as SimParams, BASE).score;
        return { l: m.l, lo: Math.min(lo, hi), hi: Math.max(lo, hi), sw: Math.abs(hi - lo) };
      }).sort((a, b) => b.sw - a.sw),
    deps // eslint-disable-line react-hooks/exhaustive-deps
  );
  const cmp = useMemo(() => {
    const r: Record<string, ReturnType<typeof simCompute>> = {};
    Object.keys(PRESETS).forEach((k) => {
      r[k] = simCompute(PRESETS[k], BASE);
    });
    r["Ma simulation"] = R;
    return r;
  }, [R, BASE]);

  const tensLbl = R.tension >= 0.66 ? ["Élevée", T.clay] : R.tension >= 0.33 ? ["Modérée", T.gold] : ["Maîtrisée", T.emerald];
  const reco =
    R.score >= 70
      ? "Trajectoire ambitieuse et équilibrée : cap sur le récurrent et la souveraineté, surveiller la trésorerie fournisseurs."
      : R.score >= 45
      ? "Trajectoire correcte : pousser le mix vers cyber/cloud et le récurrent pour hausser marge et résilience."
      : "Trajectoire fragile : réduire l'exposition aux menaces et rééquilibrer vers le récurrent à forte marge.";

  const setterOf: Record<string, (v: number) => void> = {
    managed: setManaged,
    cloud: setCloud,
    aoBad: setAoBad,
    win: setWin,
    newAcc: setNewAcc,
    mix: setMix,
    tarif: setTarif,
    attrition: setAttrition,
    invest: setInvest,
  };
  const valOf: Record<string, number> = { managed, cloud, aoBad, win, newAcc, mix, tarif, attrition, invest };

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: T.plum,
          marginBottom: 14,
          background: T.panel,
          border: `1px solid ${T.line}`,
          borderRadius: 8,
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>🎛️ Manipulez les leviers : le revenu projeté, la marge, la part de récurrent, la valeur en jeu et le score stratégique se recalculent en direct.</span>
        <Badge c={calibrated ? T.emerald : T.faint}>{calibrated ? "Calibré sur données réelles" : "Valeurs de référence — en attente de calibrage (imports internes)"}</Badge>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16, alignItems: "start" }} className="g2">
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Eyebrow color={T.gold}>Leviers stratégiques</Eyebrow>
            <button className="pill" onClick={reset}>
              Réinitialiser
            </button>
          </div>
          <div style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: T.emerald, fontWeight: 600, margin: "6px 0 8px" }}>Croissance</div>
          <Slider label="Récurrent (SOC / Managed)" val={valOf.managed} set={setterOf.managed} color={T.emerald} hint="Développement des contrats managés" />
          <Slider label="Cloud souverain & conformité" val={valOf.cloud} set={setterOf.cloud} color={T.emerald} />
          <Slider label="Capture AO / programme BAD" val={valOf.aoBad} set={setterOf.aoBad} color={T.emerald} unit="%" hint="Probabilité de gain des AO financés" />
          <Slider label="Taux de conversion (win rate)" val={valOf.win} set={setterOf.win} min={40} max={80} color={T.emerald} hint="Base actuelle : 62%" />
          <Slider label="Effort nouveaux comptes" val={valOf.newAcc} set={setterOf.newAcc} color={T.emerald} />
          <Slider label="Montée en gamme (mix cyber/cloud)" val={valOf.mix} set={setterOf.mix} color={T.steel} hint="Bascule hors hardware banalisé → marge" />
          <div style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: T.clay, fontWeight: 600, margin: "12px 0 8px" }}>Risques</div>
          <Slider label="Pression tarifaire / rebates éditeurs" val={valOf.tarif} set={setterOf.tarif} color={T.clay} />
          <Slider label="Attrition / pression concurrentielle" val={valOf.attrition} set={setterOf.attrition} color={T.clay} />
          <div style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: T.gold, fontWeight: 600, margin: "12px 0 8px" }}>Moyens & contexte</div>
          <Slider label="Investissement (certifs, staffing)" val={valOf.invest} set={setterOf.invest} color={T.gold} hint="Prérequis des leviers de croissance" />
          <Slider label="Horizon" val={horizon} set={setHorizon} min={1} max={3} step={1} unit=" an(s)" color={T.gold} />
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: T.dim, marginBottom: 5 }}>Scénario</div>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              style={{ width: "100%", background: T.panel2, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
            >
              {SCEN_OPTS.map((s) => (
                <option key={s.k} value={s.k}>
                  {s.l}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <div>
          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
            <Card>
              <Kpi label="Revenu projeté" value={fmt(R.revenu * 1e6)} accent={T.emerald} sub={(R.delta >= 0 ? "+" : "") + fmt(R.delta * 1e6) + " vs base"} />
            </Card>
            <Card>
              <Kpi label="Marge brute" value={pct(R.margin)} accent={R.margin >= BASE.objMarge ? T.emerald : T.gold} sub={"objectif " + pct(BASE.objMarge)} />
            </Card>
            <Card>
              <Kpi label="Part de récurrent" value={pct(R.recShare)} accent={T.steel} sub="santé stratégique" />
            </Card>
            <Card>
              <Kpi label="Marge en valeur" value={fmt(R.margeVal * 1e6)} accent={T.gold} sub="revenu × marge" />
            </Card>
          </div>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 12, marginBottom: 12 }}>
            <Card>
              <Eyebrow color={T.gold}>Score stratégique</Eyebrow>
              <div style={{ marginTop: 10 }}>
                <Gauge score={R.score} />
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: T.dim, lineHeight: 1.5 }}>{reco}</div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <span style={{ color: T.dim }}>Tension trésorerie / fournisseurs</span>
                <Badge c={tensLbl[1] as string}>{tensLbl[0]}</Badge>
              </div>
              <div style={{ marginTop: 5, height: 7, background: T.panel2, borderRadius: 4 }}>
                <div style={{ width: `${R.tension * 100}%`, height: "100%", background: tensLbl[1] as string, borderRadius: 4 }} />
              </div>
            </Card>
            <Card>
              <Eyebrow color={T.emerald}>Pont de valeur — base → projeté (M FCFA)</Eyebrow>
              <div style={{ height: 230, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={R.wf} margin={{ left: 0, right: 8, top: 8, bottom: 24 }}>
                    <CartesianGrid stroke={T.line} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: T.dim, fontSize: 9.5 }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={54} />
                    <YAxis tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} tick={{ fill: T.faint, fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Bar dataKey="base" stackId="a" fill="transparent" />
                    <Bar dataKey="pos" stackId="a" radius={[3, 3, 0, 0]}>
                      {R.wf.map((r, i) => (
                        <Cell key={i} fill={r.kind === "start" ? T.steel : r.kind === "end" ? T.gold : T.emerald} />
                      ))}
                    </Bar>
                    <Bar dataKey="neg" stackId="a" radius={[3, 3, 0, 0]}>
                      {R.wf.map((_r, i) => (
                        <Cell key={i} fill={T.clay} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
          <Card>
            <Eyebrow color={T.steel}>Trajectoire du revenu (annualisé)</Eyebrow>
            <div style={{ height: 180, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={R.traj} margin={{ left: 0, right: 12, top: 8, bottom: 6 }}>
                  <CartesianGrid stroke={T.line} vertical={false} />
                  <XAxis dataKey="y" tick={{ fill: T.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => fmt(v * 1e6)} tick={{ fill: T.faint, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={BASE.ambition} stroke={T.gold} strokeDasharray="4 4" label={{ value: "Ambition", fill: T.gold, fontSize: 10, position: "insideTopRight" }} />
                  <Line type="monotone" dataKey="v" stroke={T.emerald} strokeWidth={2.5} dot={{ r: 3, fill: T.emerald }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop: 6, fontSize: 11.5, color: T.faint }}>
              Atterrissage à l'horizon : <b style={{ color: R.revenu >= BASE.ambition ? T.emerald : T.gold }}>{pct(R.revenu / BASE.ambition)}</b> de l'ambition ({fmt(BASE.ambition * 1e6)}).
            </div>
          </Card>
        </div>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card>
          <Eyebrow color={T.gold}>Analyse de sensibilité (tornado)</Eyebrow>
          <div style={{ marginTop: 12 }}>
            {tor.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <div style={{ width: 150, fontSize: 11.5, color: T.dim, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.l}</div>
                <div style={{ flex: 1, position: "relative", height: 16, background: T.panel2, borderRadius: 4 }}>
                  <div style={{ position: "absolute", left: m.lo + "%", width: Math.max(m.hi - m.lo, 1) + "%", top: 0, bottom: 0, background: T.gold + "99", borderRadius: 4 }} />
                  <div style={{ position: "absolute", left: R.score + "%", top: -2, bottom: -2, width: 2, background: T.ink }} />
                </div>
                <div style={{ width: 34, fontSize: 11, color: T.gold, textAlign: "right", fontWeight: 600 }}>±{Math.round(m.sw)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: T.faint, lineHeight: 1.5 }}>
            Amplitude du score stratégique quand chaque levier varie de son minimum à son maximum (autres leviers inchangés). Trait blanc = score actuel. Les leviers du haut sont ceux sur lesquels agir en priorité.
          </div>
        </Card>
        <Card>
          <Eyebrow color={T.steel}>Comparaison de scénarios</Eyebrow>
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: T.faint, fontSize: 10.5, textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "5px 6px" }}>Profil</th>
                  <th style={{ padding: "5px 6px" }}>Revenu</th>
                  <th style={{ padding: "5px 6px" }}>Marge</th>
                  <th style={{ padding: "5px 6px" }}>Récur.</th>
                  <th style={{ padding: "5px 6px" }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {["Prudent", "Base", "Ambition", "Ma simulation"].map((k, i) => {
                  const cRow = cmp[k];
                  const col = k === "Ma simulation" ? T.gold : k === "Ambition" ? T.emerald : k === "Prudent" ? T.clay : T.steel;
                  return (
                    <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                      <td style={{ padding: "7px 6px", color: T.ink, fontWeight: k === "Ma simulation" ? 700 : 500 }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: col, marginRight: 6 }} />
                        {k}
                      </td>
                      <td style={{ padding: "7px 6px", textAlign: "right", color: T.dim, fontVariantNumeric: "tabular-nums" }}>{fmt(cRow.revenu * 1e6)}</td>
                      <td style={{ padding: "7px 6px", textAlign: "right", color: T.dim }}>{pct(cRow.margin)}</td>
                      <td style={{ padding: "7px 6px", textAlign: "right", color: T.dim }}>{pct(cRow.recShare)}</td>
                      <td style={{ padding: "7px 6px", textAlign: "right" }}>
                        <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, color: col }}>{cRow.score}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}>
            {["Prudent", "Base", "Ambition", "Ma simulation"].map((k, i) => {
              const cRow = cmp[k];
              const col = k === "Ma simulation" ? T.gold : k === "Ambition" ? T.emerald : k === "Prudent" ? T.clay : T.steel;
              return (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.dim, marginBottom: 2 }}>
                    <span>{k}</span>
                    <span>{cRow.score}/100</span>
                  </div>
                  <div style={{ height: 6, background: T.panel2, borderRadius: 4 }}>
                    <div style={{ width: cRow.score + "%", height: "100%", background: col, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
