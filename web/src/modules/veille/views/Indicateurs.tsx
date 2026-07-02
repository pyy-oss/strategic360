import React from "react";
import { T, STCOL } from "../../../design/tokens";
import { Eyebrow, Card, Spark, Badge } from "../../../design/ui";
import { KRI } from "../data";
import { useQuantiSummary } from "../lib/quanti";

/**
 * "Indicateurs avancés" (leading KRIs) — ported from `Indicateurs` in the maquette.
 *
 * V4 wiring (BUILD_KIT.md §11 "Indicateurs avancés lit summaries/quanti.kris"): the CURRENT
 * value/status of a few KRIs (matched by name — "Taux de conversion", "Saturation lignes
 * fournisseurs", "Délai commande→facturation") is overridden with the real value computed by
 * `functions/domain/quanti.js`'s `computeKris` when `summaries/quanti.kris` has a non-null entry
 * for that name. The SPARKLINE HISTORY (`data`/`dir`) intentionally stays on the static maquette
 * values for every KRI: `summaries/quanti` is a single point-in-time snapshot recomputed on each
 * ingest (no time-series store of past `summaries/quanti` versions exists in V4), so there is no
 * real trend to draw yet — showing the maquette's illustrative shape is a deliberate choice over
 * fabricating a fake trend, documented via a "temps réel (valeur actuelle)" badge on the wired
 * cards. A future phase could snapshot `summaries/quanti` into a `quantiHistory` collection to
 * make the sparkline real too. The other KRIs (Pipeline pondéré, Marge brute, AO actifs,
 * Menaces fort impact, Fraîcheur watchlist, Time-to-insight) have no source wired in V4 (Pipeline
 * pondéré IS computed server-side but not currently surfaced as a KRI card here — see
 * `summaries/quanti.pipelinePondere`, exposed via Radar/Valeur views instead) and stay fully
 * static, same as "Part de récurrent" (explicitly flagged null by computeKris — DELTA_01 §3bis.F).
 */
export function Indicateurs() {
  const { data: quanti } = useQuantiSummary();
  const liveByName = new Map((quanti?.kris ?? []).filter((k) => k.val != null).map((k) => [k.n, k]));
  const kris = KRI.map((k) => {
    const live = liveByName.get(k.n);
    if (!live) return { ...k, live: false };
    return { ...k, val: live.val as number, stat: (live.stat ?? k.stat) as string, live: true };
  });
  return (
    <div>
      <div style={{ fontSize: 12, color: T.plum, marginBottom: 14, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
        📈 Indicateurs avancés (leading) suivis dans le temps, avec seuils d'alerte. Contrairement aux KPIs de résultat, ils <b>anticipent</b> la performance et le risque — ce sont les capteurs du radar stratégique.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 }}>
        {kris.map((k, i) => {
          const first = k.data[0],
            last = k.data[k.data.length - 1];
          const chg = last - first;
          const good = (k.dir === "up" && chg >= 0) || (k.dir === "down" && chg <= 0);
          const arrow = chg > 0 ? "▲" : chg < 0 ? "▼" : "—";
          const col = STCOL[k.stat];
          return (
            <Card key={i} style={{ borderTop: `3px solid ${col}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <Eyebrow>{k.n}</Eyebrow>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: col, marginTop: 2 }} />
              </div>
              {k.live && (
                <div style={{ marginTop: 4 }}>
                  <Badge c={T.emerald}>Temps réel (valeur)</Badge>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 8 }}>
                <div>
                  <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 24, color: T.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {k.val}
                    {k.u}
                  </div>
                  <div style={{ fontSize: 11, color: good ? T.emerald : T.clay, marginTop: 4 }}>
                    {arrow} {Math.abs(Math.round(chg * 10) / 10)}
                    {k.u} <span style={{ color: T.faint }}>/ 8 pér.</span>
                  </div>
                </div>
                <Spark data={[...k.data]} color={col} />
              </div>
            </Card>
          );
        })}
      </div>
      <Card style={{ marginTop: 14 }}>
        <Eyebrow color={T.clay}>Alertes de seuil</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.7 }}>
          <div>
            <span style={{ color: T.clay, fontWeight: 700 }}>● Saturation lignes fournisseurs (78%)</span> — seuil de tension franchi : renégocier les lignes exposées et lisser les commandes (lien module Crédit Fournisseurs).
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: T.gold, fontWeight: 700 }}>● Part de récurrent (19%)</span> — sous la cible de 35% : accélérer le managed/SOC pour la prévisibilité et la marge.
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: T.gold, fontWeight: 700 }}>● Marge brute (21%)</span> — sous l'objectif 24% : pousser la montée en gamme (mix cyber/cloud).
          </div>
        </div>
      </Card>
    </div>
  );
}
