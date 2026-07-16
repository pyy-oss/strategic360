import React, { useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { usePaged, Pager } from "../components/Pager";
import { Select, Input } from "../../../design/fields";
import { Modal, useToast } from "../../../design/overlay";
import { T, RING, QUAD_TECH, pct } from "../../../design/tokens";
import { Eyebrow, Card, Tip, Badge } from "../../../design/ui";
import { useClaims } from "../../../lib/rbac";
import {
  createInnovationBet,
  createTechRadarBlip,
  riceScore,
  useInnovationPortfolio,
  useTechRadar,
  type TechRadarMomentum,
  type TechRadarRing,
} from "../lib/innovation";

const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

/** "Ajouter une technologie" — gated on role ∈ {direction, innovation} (matches
 * firestore.rules' techRadar write gate), same panel convention as Execution.tsx. */
function NewBlipPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [quadrant, setQuadrant] = useState(0);
  const [ring, setRing] = useState<TechRadarRing>("evaluer");
  const [momentum, setMomentum] = useState<TechRadarMomentum>("→");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Le nom est requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createTechRadarBlip({ name: name.trim(), quadrant, ring, momentum, linkedItems: [] });
      toast.success("Technologie ajoutée au radar.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ajouter une technologie">
      <form onSubmit={submit}>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Nom *</label>
            <Input value={name} onChange={setName} required />
          </div>
          <div>
            <label style={labelStyle}>Quadrant</label>
            <Select value={String(quadrant)} onChange={(v) => setQuadrant(Number(v))} ariaLabel="Quadrant"
              options={QUAD_TECH.map((q, i) => ({ value: String(i), label: q }))} />
          </div>
          <div>
            <label style={labelStyle}>Anneau</label>
            <Select value={ring} onChange={(v) => setRing(v as TechRadarRing)} ariaLabel="Anneau"
              options={(["adopter", "essayer", "evaluer", "suspendre"] as TechRadarRing[]).map((r) => ({ value: r, label: RING[r].l }))} />
          </div>
          <div>
            <label style={labelStyle}>Momentum</label>
            <Select value={momentum} onChange={(v) => setMomentum(v as TechRadarMomentum)} ariaLabel="Momentum"
              options={[{ value: "↑", label: "↑ En hausse" }, { value: "→", label: "→ Stable" }, { value: "↓", label: "↓ En baisse" }]} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer la technologie"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Ajouter un pari" — innovationPortfolio contribution (RICE computed at write time). */
function NewBetPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ title: "", reach: 5, impact: 5, confidence: 0.7, effort: 5, stage: "idée", owner: "", horizon: "H2" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setErr("Le titre est requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createInnovationBet({
        title: form.title.trim(),
        reach: form.reach,
        impact: form.impact,
        confidence: form.confidence,
        effort: form.effort,
        stage: form.stage,
        owner: form.owner.trim() || undefined,
        horizon: form.horizon,
      });
      toast.success("Pari d'innovation enregistré.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ajouter un pari d'innovation" width={640}>
      <form onSubmit={submit}>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Titre *</label>
            <Input value={form.title} onChange={(v) => set("title", v)} required />
          </div>
          <div>
            <label style={labelStyle}>Reach (1-10)</label>
            <Input type="number" min={1} max={10} value={String(form.reach)} onChange={(v) => set("reach", Number(v))} />
          </div>
          <div>
            <label style={labelStyle}>Impact (1-10)</label>
            <Input type="number" min={1} max={10} value={String(form.impact)} onChange={(v) => set("impact", Number(v))} />
          </div>
          <div>
            <label style={labelStyle}>Confiance (0-1)</label>
            <Input type="number" min={0} max={1} step={0.05} value={String(form.confidence)} onChange={(v) => set("confidence", Number(v))} />
          </div>
          <div>
            <label style={labelStyle}>Effort (1-10)</label>
            <Input type="number" min={1} max={10} value={String(form.effort)} onChange={(v) => set("effort", Number(v))} />
          </div>
          <div>
            <label style={labelStyle}>Stade</label>
            <Select value={form.stage} onChange={(v) => set("stage", v)} ariaLabel="Stade"
              options={["idée", "exploration", "poc", "pilote", "scale"].map((s) => ({ value: s, label: s }))} />
          </div>
          <div>
            <label style={labelStyle}>Porteur</label>
            <Input value={form.owner} onChange={(v) => set("owner", v)} />
          </div>
          <div>
            <label style={labelStyle}>Horizon</label>
            <Select value={form.horizon} onChange={(v) => set("horizon", v)} ariaLabel="Horizon"
              options={[{ value: "H1", label: "H1" }, { value: "H2", label: "H2" }, { value: "H3", label: "H3" }]} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer le pari"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * "Tech Radar & Innovation" — reads the live Firestore `techRadar` + `innovationPortfolio`
 * collections only (no sample fallback), with contribution forms gated on role ∈
 * {direction, innovation} (the server-side write gate for both collections).
 */
export function Innovation() {
  const R = 150,
    CX = 170,
    CY = 170;

  const { blips: liveBlips, loading: loadingRadar } = useTechRadar();
  const { bets: liveBets, loading: loadingInnov } = useInnovationPortfolio();
  const { role } = useClaims();
  const canContribute = role === "direction" || role === "innovation";
  const [showBlipForm, setShowBlipForm] = useState(false);
  const [showBetForm, setShowBetForm] = useState(false);

  const RADAR_TECH = liveBlips.map((b) => ({ n: b.name, quad: b.quadrant, ring: b.ring, mom: b.momentum }));
  const INNOV = liveBets.map((b) => ({ n: b.title, reach: b.reach, impact: b.impact, conf: b.confidence, effort: b.effort }));

  const quadCount: Record<number, number> = {};
  RADAR_TECH.forEach((b) => {
    quadCount[b.quad] = (quadCount[b.quad] || 0) + 1;
  });
  const idxInQuad: Record<number, number> = {};
  const blips = RADAR_TECH.map((b) => {
    idxInQuad[b.quad] = idxInQuad[b.quad] || 0;
    const i = idxInQuad[b.quad]++;
    const n = quadCount[b.quad];
    const a0 = b.quad * 90 + (90 / (n + 1)) * (i + 1);
    const a = (a0 * Math.PI) / 180;
    const rad = RING[b.ring].r * R;
    return { ...b, x: CX + rad * Math.cos(a), y: CY - rad * Math.sin(a) };
  });
  const rice = INNOV.map((o) => ({ ...o, rice: riceScore({ reach: o.reach, impact: o.impact, confidence: o.conf, effort: o.effort }) }));
  // Longues listes (audit design) : pagination de la légende du radar et du classement RICE.
  // Le radar SVG et le nuage RICE au-dessus continuent d'afficher TOUT (vue d'ensemble).
  const blipsPaged = usePaged(liveBlips, 12);
  const sortedBets = [...liveBets].sort((a, b) => (b.rice ?? 0) - (a.rice ?? 0));
  const betsPaged = usePaged(sortedBets, 10);
  return (
    <div>
      {canContribute && <NewBlipPanel open={showBlipForm} onClose={() => setShowBlipForm(false)} />}
      {canContribute && <NewBetPanel open={showBetForm} onClose={() => setShowBetForm(false)} />}
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.plum}>Tech Radar</Eyebrow>
            {canContribute && (
              <button className="pill on" onClick={() => setShowBlipForm((v) => !v)}>
                + Ajouter une technologie
              </button>
            )}
          </div>
          {loadingRadar && liveBlips.length === 0 && <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Chargement…</div>}
          {!loadingRadar && liveBlips.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Tech Radar vide — ajoutez des technologies.</div>
          )}
          {liveBlips.length > 0 && (
            <>
              <svg viewBox="0 0 340 360" style={{ width: "100%", height: 320, marginTop: 6 }}>
                {["suspendre", "evaluer", "essayer", "adopter"].map((r) => (
                  <circle key={r} cx={CX} cy={CY} r={RING[r].r * R} fill="none" stroke={T.line} />
                ))}
                <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke={T.line} />
                <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke={T.line} />
                {QUAD_TECH.map((q, i) => {
                  const a = ((i * 90 + 45) * Math.PI) / 180;
                  return (
                    <text key={i} x={CX + (R + 8) * Math.cos(a)} y={CY - (R + 8) * Math.sin(a)} fill={T.faint} fontSize="10" textAnchor="middle">
                      {q}
                    </text>
                  );
                })}
                {blips.map((b, i) => (
                  <g key={i}>
                    <circle cx={b.x} cy={b.y} r="5" fill={RING[b.ring].c} />
                    {/* Au-delà de 12 blips les étiquettes se superposent et rendent le radar
                        illisible — on les masque et la liste sous le graphique prend le relais. */}
                    {blips.length <= 12 && (
                      <text x={b.x + 7} y={b.y + 3} fill={T.dim} fontSize="8.5">
                        {b.n.length > 26 ? `${b.n.slice(0, 26)}…` : b.n}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, justifyContent: "center" }}>
                {Object.keys(RING).map((r) => (
                  <span key={r} style={{ color: T.dim }}>
                    <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: RING[r].c, marginRight: 4 }} />
                    {RING[r].l}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {blipsPaged.pageItems.map((b, i) => (
                  <div key={b.id ?? i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, borderTop: i > 0 ? `1px solid ${T.line}` : "none", paddingTop: i > 0 ? 4 : 0 }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: RING[b.ring]?.c ?? T.faint, flexShrink: 0, position: "relative", top: 0 }} />
                    <span style={{ color: T.ink, fontWeight: 600 }}>{b.name}</span>
                    <span style={{ color: T.faint }}>{QUAD_TECH[b.quadrant] ?? ""} · {b.ring}{b.momentum ? ` · ${b.momentum}` : ""}</span>
                  </div>
                ))}
              </div>
              <Pager {...blipsPaged} />
            </>
          )}
        </Card>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.emerald}>Portefeuille d'innovation (RICE)</Eyebrow>
            {canContribute && (
              <button className="pill on" onClick={() => setShowBetForm((v) => !v)}>
                + Ajouter un pari
              </button>
            )}
          </div>
          {loadingInnov && liveBets.length === 0 && <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Chargement…</div>}
          {!loadingInnov && liveBets.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Portefeuille d'innovation vide.</div>
          )}
          {liveBets.length > 0 && (
            <>
              <div style={{ height: 250, marginTop: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ left: 6, right: 16, top: 10, bottom: 16 }}>
                    <CartesianGrid stroke={T.line} />
                    <XAxis type="number" dataKey="effort" name="Effort" domain={[0, 10]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Effort →", position: "insideBottom", offset: -6, fill: T.dim, fontSize: 11 }} />
                    <YAxis type="number" dataKey="impact" name="Impact" domain={[0, 10]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Impact →", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
                    <ZAxis type="number" dataKey="rice" range={[120, 900]} />
                    <Tooltip content={<Tip />} cursor={{ stroke: T.faint }} />
                    <Scatter data={rice}>
                      {rice.map((o, i) => (
                        <Cell key={i} fill={o.effort <= o.impact ? T.emerald : T.gold} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={{ marginTop: 6, fontSize: 11.5, color: T.faint }}>Bulle = score RICE. Quadrant haut-gauche (impact fort / effort faible) = à lancer en priorité.</div>
            </>
          )}
        </Card>
      </div>
      <Card>
        <Eyebrow color={T.emerald}>Paris d'innovation — priorisation RICE</Eyebrow>
        {liveBets.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Portefeuille d'innovation vide.</div>
        ) : (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {betsPaged.pageItems
              .map((o, i) => (
                <div key={o.id ?? i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12.5, padding: "8px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none" }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, color: T.emerald, minWidth: 40 }}>{o.rice ?? riceScore({ reach: o.reach, impact: o.impact, confidence: o.confidence, effort: o.effort })}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: T.ink, fontWeight: 600 }}>{o.title}</div>
                    {/* Mapping actionnable (2026-07) : secteur métier → offre NT → comptes/profils cibles. */}
                    {(o.sector || o.offre) && (
                      <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        {o.sector && <Badge>{o.sector}</Badge>}
                        {o.offre && <span style={{ fontSize: 11.5, color: T.steel }}>↳ {o.offre}</span>}
                      </div>
                    )}
                    {Array.isArray(o.comptesCibles) && o.comptesCibles.length > 0 && (
                      <div style={{ marginTop: 3, fontSize: 11.5, color: T.faint }}>Cibles : {o.comptesCibles.join(" · ")}</div>
                    )}
                    {/* Auditabilité (audit 2026-07) : justification + nombre de signaux sources. */}
                    {o.rationale && (
                      <div style={{ marginTop: 3, fontSize: 11.5, color: T.dim, fontStyle: "italic" }}>
                        {o.rationale}
                        {Array.isArray(o.sourceSignals) && o.sourceSignals.length > 0 && (
                          <span style={{ color: T.dim }}> · {o.sourceSignals.length} {o.sourceSignals.length > 1 ? "signaux sources" : "signal source"}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <span style={{ color: T.faint, flexShrink: 0, whiteSpace: "nowrap" }}>
                    R{o.reach}·I{o.impact}·C{pct(o.confidence)}·E{o.effort}
                  </span>
                </div>
              ))}
            <Pager {...betsPaged} />
          </div>
        )}
      </Card>
    </div>
  );
}
