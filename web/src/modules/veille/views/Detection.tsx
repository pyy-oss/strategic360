import React, { useState } from "react";
import { T, ECAT, PROX, IMP, STANCE } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge } from "../../../design/ui";
import { useIntelItems } from "../lib/intel";

/** "Radar de détection" — ported from `Detection` in the maquette; data source swapped to
 * Firestore `intelItems` (V2). Rendering (sonar SVG, quadrants, badges) is unchanged.
 *
 * The sonar/list need `cat` (ECAT key) + `prox` (PROX key) to be positioned — those are optional
 * fields on `intelItems` (populated by detection-style contributions/ingestion, not every fiche
 * de veille). Items missing either are simply not plottable yet and are excluded here, exactly
 * like an empty EVENTS array would render an empty radar.
 */
export function Detection() {
  const [cat, setCat] = useState("all");
  const { items } = useIntelItems();
  const EVENTS = items.filter((e) => e.cat && ECAT[e.cat] && e.prox && PROX[e.prox]);
  const CX = 170,
    CY = 170,
    RR = 150;
  const idxIn: Record<number, number> = {};
  const blips = EVENTS.map((e) => {
    const q = ECAT[e.cat as string].q;
    idxIn[q] = idxIn[q] || 0;
    const i = idxIn[q]++;
    const cnt = EVENTS.filter((x) => ECAT[x.cat as string].q === q).length;
    const ang = ((q * 90 + (90 / (cnt + 1)) * (i + 1)) * Math.PI) / 180;
    const rad = PROX[e.prox as string].r * RR;
    return { ...e, x: CX + rad * Math.cos(ang), y: CY - rad * Math.sin(ang), size: e.impact === "high" ? 7 : e.impact === "medium" ? 5.2 : 4 };
  });
  const rows = EVENTS.filter((e) => cat === "all" || e.cat === cat).sort((a, b) => {
    const P: Record<string, number> = { imminent: 0, court: 1, moyen: 2, horizon: 3 };
    const I: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return P[a.prox as string] - P[b.prox as string] || I[a.impact] - I[b.impact];
  });
  const neuf = EVENTS.filter((e) => e.neuf).length;
  return (
    <div>
      <div style={{ fontSize: 12, color: T.plum, marginBottom: 14, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
        📡 Détection d'événements : implantations, expansions de groupe, risques/opportunités sectoriels, ruptures techno, réglementation, risque pays. Position = <b>catégorie</b> (secteur) × <b>imminence</b> (proximité du centre) ; taille = <b>impact</b> ; couleur = opportunité/menace.
      </div>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        {Object.keys(ECAT).map((k) => (
          <Card key={k}>
            <Kpi label={ECAT[k].l} value={EVENTS.filter((e) => e.cat === k).length} accent={ECAT[k].c} sub="événements suivis" />
          </Card>
        ))}
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.emerald}>Radar de détection</Eyebrow>
            <Badge c={T.emerald}>{neuf} nouveaux</Badge>
          </div>
          <svg viewBox="0 0 340 360" style={{ width: "100%", height: 330, marginTop: 4 }}>
            <defs>
              <linearGradient id="sw" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={T.emerald} stopOpacity="0.22" />
                <stop offset="100%" stopColor={T.emerald} stopOpacity="0" />
              </linearGradient>
            </defs>
            {["horizon", "moyen", "court", "imminent"].map((r) => (
              <circle key={r} cx={CX} cy={CY} r={PROX[r].r * RR} fill="none" stroke={T.line} />
            ))}
            <line x1={CX - RR} y1={CY} x2={CX + RR} y2={CY} stroke={T.line} />
            <line x1={CX} y1={CY - RR} x2={CX} y2={CY + RR} stroke={T.line} />
            <g>
              <path d="M170 170 L170 20 A150 150 0 0 1 276 64 Z" fill="url(#sw)" />
              <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 170 170" to="360 170 170" dur="7s" repeatCount="indefinite" />
            </g>
            {Object.keys(ECAT).map((k) => {
              const q = ECAT[k].q;
              const a = ((q * 90 + 45) * Math.PI) / 180;
              return (
                <text key={k} x={CX + (RR - 8) * Math.cos(a)} y={CY - (RR - 8) * Math.sin(a)} fill={ECAT[k].c} fontSize="9.5" textAnchor="middle" opacity="0.8">
                  {ECAT[k].l}
                </text>
              );
            })}
            <circle cx={CX} cy={CY} r="3" fill={T.faint} />
            {blips.map((b, i) => (
              <g key={b.id ?? i} opacity={cat === "all" || cat === b.cat ? 1 : 0.18}>
                {b.neuf && <circle cx={b.x} cy={b.y} r={b.size + 4} fill="none" stroke={STANCE[b.stance].c} strokeOpacity="0.4" />}
                <circle cx={b.x} cy={b.y} r={b.size} fill={STANCE[b.stance].c} />
              </g>
            ))}
          </svg>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, justifyContent: "center", marginTop: 2 }}>
            <span style={{ color: T.dim }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: T.emerald, marginRight: 4 }} />
              Opportunité
            </span>
            <span style={{ color: T.dim }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: T.clay, marginRight: 4 }} />
              Menace
            </span>
            <span style={{ color: T.dim }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: T.dim, marginRight: 4 }} />
              Neutre
            </span>
            <span style={{ color: T.faint }}>centre = imminent · bord = horizon</span>
          </div>
        </Card>
        <Card>
          <Eyebrow color={T.gold}>Types d'événements détectés</Eyebrow>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            {["Nouvelle implantation", "Expansion de groupe", "Entrée d'un concurrent", "Opportunité sectorielle", "Risque sectoriel", "Rupture / nouvelle techno", "Obsolescence / EOL", "Nouvelle réglementation", "Risque pays"].map((ty, i) => {
              const c = EVENTS.filter((e) => e.subtype === ty).length;
              const ev = EVENTS.find((e) => e.subtype === ty);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: ev ? ECAT[ev.cat as string].c : T.faint, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: c ? T.ink : T.faint }}>{ty}</span>
                  <Badge c={c ? T.gold : T.faint}>{c}</Badge>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: T.faint, lineHeight: 1.5 }}>
            Détection : veille automatisée (RSS + IA Vertex) + saisie analyste. Chaque événement peut déclencher une <b style={{ color: T.emerald }}>opportunité</b> (Pipeline) ou une <b style={{ color: T.clay }}>alerte sourcing</b> (Crédit Fournisseurs).
          </div>
        </Card>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: T.faint }}>Catégorie :</span>
        <button className={`pill ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
          Toutes
        </button>
        {Object.keys(ECAT).map((k) => (
          <button key={k} className={`pill ${cat === k ? "on" : ""}`} onClick={() => setCat(k)}>
            {ECAT[k].l}
          </button>
        ))}
      </div>
      {rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>Aucun événement de détection saisi pour l'instant.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((e) => (
          <Card key={e.id} style={{ borderLeft: `3px solid ${STANCE[e.stance].c}` }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge c={ECAT[e.cat as string].c}>{ECAT[e.cat as string].l}</Badge>
                  <span style={{ fontSize: 11.5, color: T.gold, fontWeight: 600 }}>{e.subtype}</span>
                  {e.neuf && <Badge c={T.emerald}>Nouveau</Badge>}
                </div>
                <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>{e.title}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Badge c={PROX[e.prox as string].r < 0.4 ? T.clay : T.faint}>{PROX[e.prox as string].l}</Badge>
                  <Badge c={IMP[e.impact].c}>Impact {IMP[e.impact].l}</Badge>
                  <Badge c={STANCE[e.stance].c}>{STANCE[e.stance].l}</Badge>
                  <Badge c={T.faint}>
                    {e.ent || "—"} · {e.geo || "—"}
                  </Badge>
                  <Badge c={T.steel}>Fiabilité {e.confidence ?? e.sourceRating}</Badge>
                </div>
                {e.soWhat && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim }}>
                    <b style={{ color: T.plum }}>So-what :</b> {e.soWhat}
                  </div>
                )}
                {e.recommendedAction && (
                  <div style={{ marginTop: 4, fontSize: 12.5, color: T.dim }}>
                    <b style={{ color: T.gold }}>Action :</b> {e.recommendedAction}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
