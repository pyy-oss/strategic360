import React, { useState } from "react";
import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import { T, QCOL, pct } from "../../../design/tokens";
import { Eyebrow, Card, Tip, Badge } from "../../../design/ui";
import { SWOT, PESTEL, PORTER, BCG, CANVAS } from "../data";
import { useQuantiSummary } from "../lib/quanti";

/**
 * "Cadres stratégiques" — ported from `Cadres` in the maquette.
 *
 * V4 wiring (BUILD_KIT.md §11 "Cadres lit frameworks/* + summaries/quanti Porter/BCG"):
 *   - Porter tab: `pouvoirFournisseurs`/`pouvoirClients` come from `summaries/quanti.porterForces`
 *     when available (Top-3 fournisseur / Top-5 client concentration — real numbers derived from
 *     `orders`/`opportunities`). The other 3 forces (Rivalité, Substituts, Nouveaux entrants)
 *     have NO internal-data proxy at all (BUILD_KIT.md never claims otherwise) — they stay on the
 *     static maquette values. This is a deliberately MIXED-SOURCE radar chart, documented inline
 *     and via a "temps réel" badge on the two wired forces.
 *   - BCG tab: swapped for `summaries/quanti.bcg` (per-BU part/croissance/marge from `orders`)
 *     when the array is non-empty; falls back to the static maquette `BCG` sample (with a badge)
 *     when no P&L has been ingested yet — an empty chart would be a worse UX than a clearly
 *     labeled example.
 */
export function Cadres() {
  const [c, setC] = useState("swot");
  const { data: quanti } = useQuantiSummary();

  const porterForces = quanti?.porterForces;
  const porterData = PORTER.map((p) => {
    if (p.force === "Pouvoir fournisseurs" && porterForces?.pouvoirFournisseurs != null) {
      return { ...p, v: porterForces.pouvoirFournisseurs, live: true };
    }
    if (p.force === "Pouvoir clients" && porterForces?.pouvoirClients != null) {
      return { ...p, v: porterForces.pouvoirClients, live: true };
    }
    return { ...p, live: false };
  });

  const bcgData = quanti?.bcg && quanti.bcg.length > 0 ? quanti.bcg : BCG;
  const bcgIsLive = !!(quanti?.bcg && quanti.bcg.length > 0);
  const CN: [string, string][] = [
    ["swot", "SWOT"],
    ["pestel", "PESTEL"],
    ["porter", "Porter"],
    ["bcg", "BCG"],
    ["canvas", "Canvas"],
  ];
  const swotC: Record<string, string> = { Forces: T.emerald, Faiblesses: T.clay, Opportunités: T.steel, Menaces: T.gold };
  return (
    <div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {CN.map(([k, l]) => (
          <button key={k} className={`pill ${c === k ? "on" : ""}`} onClick={() => setC(k)}>
            {l}
          </button>
        ))}
        <span style={{ fontSize: 11, color: T.faint, alignSelf: "center", marginLeft: 8 }}>Documents vivants — connectés aux données du cockpit</span>
      </div>

      {c === "swot" && (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {Object.keys(SWOT).map((k) => (
            <Card key={k} style={{ borderTop: `3px solid ${swotC[k]}` }}>
              <Eyebrow color={swotC[k]}>{k}</Eyebrow>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, color: T.dim, lineHeight: 1.7 }}>
                {SWOT[k].map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {c === "pestel" && (
        <Card>
          <Eyebrow color={T.gold}>PESTEL — Afrique de l'Ouest / Côte d'Ivoire</Eyebrow>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {PESTEL.map((p, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: T.ink, fontWeight: 600 }}>
                    {p.f} <span style={{ color: p.tr === "↑" ? T.emerald : T.faint }}>{p.tr}</span>
                  </span>
                  <span style={{ color: T.dim, fontSize: 11.5 }}>impact {pct(p.imp)}</span>
                </div>
                <div style={{ height: 7, background: T.panel2, borderRadius: 4, marginBottom: 4 }}>
                  <div style={{ width: `${p.imp * 100}%`, height: "100%", background: T.gold, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 12, color: T.dim }}>{p.d}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {c === "porter" && (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Eyebrow color={T.clay}>Porter — 5 forces (quantifiées)</Eyebrow>
              {porterForces && <Badge c={T.emerald}>Fournisseurs/clients : temps réel</Badge>}
            </div>
            <div style={{ height: 280, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={porterData} outerRadius="72%">
                  <PolarGrid stroke={T.line} />
                  <PolarAngleAxis dataKey="force" tick={{ fill: T.dim, fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: T.faint, fontSize: 9 }} axisLine={false} />
                  <Radar dataKey="v" stroke={T.clay} fill={T.clay} fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <Eyebrow color={T.clay}>Lecture</Eyebrow>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.5 }}>
              <div>
                <b style={{ color: T.ink }}>
                  Pouvoir fournisseurs ({porterData.find((p) => p.force === "Pouvoir fournisseurs")?.v ?? "—"})
                </b>{" "}
                — concentration Top-3 fournisseurs (CAS). <span style={{ color: T.steel }}>{porterForces?.pouvoirFournisseurs != null ? "Calculé depuis les imports P&L (orders)." : "Valeur d'exemple — en attente d'un import P&L."}</span>
              </div>
              <div>
                <b style={{ color: T.ink }}>
                  Pouvoir clients ({porterData.find((p) => p.force === "Pouvoir clients")?.v ?? "—"})
                </b>{" "}
                — concentration Top-5 clients (montant pipeline). <span style={{ color: T.steel }}>{porterForces?.pouvoirClients != null ? "Calculé depuis les imports LIVE (opportunities)." : "Valeur d'exemple — en attente d'un import LIVE."}</span>
              </div>
              <div>
                <b style={{ color: T.ink }}>Rivalité (75)</b> — intégrateurs + telcos B2B ; densité de signaux concurrents élevée. <span style={{ color: T.faint }}>Valeur d'exemple (non dérivable des sources internes).</span>
              </div>
              <div>
                <b style={{ color: T.ink }}>Substituts (55)</b> — cloud public direct, SaaS, régie interne. <span style={{ color: T.faint }}>Valeur d'exemple (non dérivable des sources internes).</span>
              </div>
              <div>
                <b style={{ color: T.ink }}>Nouveaux entrants (50)</b> — barrières moyennes (certifs, références, capital fournisseur). <span style={{ color: T.faint }}>Valeur d'exemple (non dérivable des sources internes).</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {c === "bcg" && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.emerald}>Matrice BCG — portefeuille d'activités (taille = marge)</Eyebrow>
            <Badge c={bcgIsLive ? T.emerald : T.faint}>{bcgIsLive ? "Temps réel (imports P&L)" : "Exemple — en attente d'un import P&L"}</Badge>
          </div>
          <div style={{ height: 320, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                <CartesianGrid stroke={T.line} />
                <XAxis type="number" dataKey="part" name="Part relative" domain={[0, 1]} reversed tick={{ fill: T.faint, fontSize: 10 }} tickFormatter={pct} label={{ value: "Part de marché relative", position: "insideBottom", offset: -8, fill: T.dim, fontSize: 11 }} />
                <YAxis type="number" dataKey="croissance" name="Croissance" domain={[0, 1]} tick={{ fill: T.faint, fontSize: 10 }} tickFormatter={pct} label={{ value: "Croissance du marché", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
                <ZAxis type="number" dataKey="marge" range={[400, 2600]} />
                <ReferenceLine x={0.5} stroke={T.faint} />
                <ReferenceLine y={0.5} stroke={T.faint} />
                <Tooltip content={<Tip />} cursor={{ stroke: T.faint }} />
                <Scatter data={[...bcgData]}>
                  {bcgData.map((b, i) => (
                    <Cell key={i} fill={QCOL[b.q]} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginTop: 6 }}>
            {bcgData.map((b, i) => (
              <span key={i} style={{ color: T.dim }}>
                <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: QCOL[b.q], marginRight: 5 }} />
                {b.n} <span style={{ color: T.faint }}>({b.q})</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {c === "canvas" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {CANVAS.map(([t, d], i) => (
            <Card key={i} style={{ gridColumn: i === 2 ? "3" : i === 8 ? "1 / span 3" : "auto" }}>
              <Eyebrow color={T.plum}>{t}</Eyebrow>
              <div style={{ marginTop: 8, fontSize: 12.5, color: T.dim, lineHeight: 1.5 }}>{d}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
