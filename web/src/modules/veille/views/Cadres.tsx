import React, { useState } from "react";
import {
  ResponsiveContainer,
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
import { useIsExec } from "../../../lib/rbac";
import { useFramework, updateFramework } from "../lib/frameworks";
import { useQuantiSummary } from "../lib/quanti";

/**
 * "Cadres stratégiques" — SWOT / PESTEL / Canvas are live `frameworks/{key}` documents
 * (exec-write, `updateFramework`), edited in-app via the simple per-quadrant editors below.
 * Porter / BCG read `summaries/quanti` (real internal imports) and show explicit empty states
 * until the P&L / LIVE files have been ingested — no sample values are ever rendered.
 */

/* ---- Content shapes stored in frameworks/{swot,pestel,canvas} ---- */

const SWOT_KEYS = ["Forces", "Faiblesses", "Opportunités", "Menaces"] as const;
type SwotContent = Record<string, string[]>;

interface PestelFactor {
  f: string;
  imp: number; // 0-1
  tr: string; // ↑ / → / ↓
  d: string;
}
type PestelContent = { factors: PestelFactor[] };
const PESTEL_FACTORS = ["Politique", "Économique", "Social", "Technologique", "Environnemental", "Légal"];

interface CanvasBlock {
  t: string;
  d: string;
}
type CanvasContent = { blocks: CanvasBlock[] };
const CANVAS_BLOCKS = [
  "Partenaires clés",
  "Activités clés",
  "Propositions de valeur",
  "Relations clients",
  "Segments clients",
  "Ressources clés",
  "Canaux",
  "Structure de coûts",
  "Revenus",
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: T.panel2,
  border: `1px solid ${T.line}`,
  borderRadius: 8,
  padding: "7px 10px",
  color: T.ink,
  fontSize: 12.5,
  fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

function EmptyFramework({ label }: { label: string }) {
  return (
    <Card>
      <Eyebrow color={T.faint}>{label}</Eyebrow>
      <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Cadre non renseigné — à compléter par la Direction.</div>
    </Card>
  );
}

function EditorShell({
  title,
  onClose,
  onSave,
  saving,
  err,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  err: string | null;
  children: React.ReactNode;
}) {
  return (
    <Card style={{ marginBottom: 14, borderColor: T.gold }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>{title}</span>
        <button type="button" className="pill" onClick={onClose}>
          Fermer
        </button>
      </div>
      {children}
      {err && <div style={{ color: T.clay, fontSize: 12, margin: "8px 0" }}>{err}</div>}
      <button type="button" className="pill on" style={{ marginTop: 10 }} disabled={saving} onClick={onSave}>
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Card>
  );
}

function useSave(key: string) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(content: unknown, onDone: () => void) {
    setSaving(true);
    setErr(null);
    try {
      await updateFramework(key, content);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }
  return { saving, err, save };
}

/* ---- SWOT ---- */

function SwotEditor({ initial, onClose }: { initial: SwotContent | null; onClose: () => void }) {
  const [txt, setTxt] = useState<Record<string, string>>(() =>
    Object.fromEntries(SWOT_KEYS.map((k) => [k, (initial?.[k] ?? []).join("\n")]))
  );
  const { saving, err, save } = useSave("swot");
  return (
    <EditorShell
      title="SWOT — édition (une entrée par ligne)"
      onClose={onClose}
      saving={saving}
      err={err}
      onSave={() => {
        const content: SwotContent = Object.fromEntries(
          SWOT_KEYS.map((k) => [k, txt[k].split("\n").map((s) => s.trim()).filter(Boolean)])
        );
        void save(content, onClose);
      }}
    >
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {SWOT_KEYS.map((k) => (
          <div key={k}>
            <label style={labelStyle}>{k}</label>
            <textarea style={{ ...inputStyle, minHeight: 110, resize: "vertical" }} value={txt[k]} onChange={(e) => setTxt((t) => ({ ...t, [k]: e.target.value }))} />
          </div>
        ))}
      </div>
    </EditorShell>
  );
}

function SwotTab() {
  const { data: fw, loading } = useFramework<SwotContent>("swot");
  const isExec = useIsExec();
  const [editing, setEditing] = useState(false);
  const swotC: Record<string, string> = { Forces: T.emerald, Faiblesses: T.clay, Opportunités: T.steel, Menaces: T.gold };
  if (loading) return <Card><div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div></Card>;
  const content = fw?.content ?? null;
  const hasContent = !!content && SWOT_KEYS.some((k) => (content[k] ?? []).length > 0);
  return (
    <div>
      {isExec && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          {!editing && (
            <button className="pill on" onClick={() => setEditing(true)}>
              {hasContent ? "Modifier le SWOT" : "+ Renseigner le SWOT"}
            </button>
          )}
        </div>
      )}
      {editing && isExec && <SwotEditor initial={content} onClose={() => setEditing(false)} />}
      {!hasContent && !editing && <EmptyFramework label="SWOT" />}
      {hasContent && (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {SWOT_KEYS.map((k) => (
            <Card key={k} style={{ borderTop: `3px solid ${swotC[k]}` }}>
              <Eyebrow color={swotC[k]}>{k}</Eyebrow>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, color: T.dim, lineHeight: 1.7 }}>
                {(content?.[k] ?? []).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- PESTEL ---- */

function PestelEditor({ initial, onClose }: { initial: PestelContent | null; onClose: () => void }) {
  const [rows, setRows] = useState<PestelFactor[]>(() =>
    PESTEL_FACTORS.map((f) => initial?.factors?.find((x) => x.f === f) ?? { f, imp: 0.5, tr: "→", d: "" })
  );
  const { saving, err, save } = useSave("pestel");
  const set = (i: number, patch: Partial<PestelFactor>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <EditorShell
      title="PESTEL — édition"
      onClose={onClose}
      saving={saving}
      err={err}
      onSave={() => void save({ factors: rows.filter((r) => r.d.trim()) } satisfies PestelContent, onClose)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r, i) => (
          <div key={r.f} style={{ display: "grid", gridTemplateColumns: "130px 90px 70px 1fr", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{r.f}</span>
            <div>
              <label style={labelStyle}>Impact (%)</label>
              <input type="number" min={0} max={100} style={inputStyle} value={Math.round(r.imp * 100)} onChange={(e) => set(i, { imp: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} />
            </div>
            <div>
              <label style={labelStyle}>Tendance</label>
              <select style={inputStyle} value={r.tr} onChange={(e) => set(i, { tr: e.target.value })}>
                <option value="↑">↑</option>
                <option value="→">→</option>
                <option value="↓">↓</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={r.d} onChange={(e) => set(i, { d: e.target.value })} />
            </div>
          </div>
        ))}
      </div>
    </EditorShell>
  );
}

function PestelTab() {
  const { data: fw, loading } = useFramework<PestelContent>("pestel");
  const isExec = useIsExec();
  const [editing, setEditing] = useState(false);
  if (loading) return <Card><div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div></Card>;
  const factors = fw?.content?.factors ?? [];
  const hasContent = factors.length > 0;
  return (
    <div>
      {isExec && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          {!editing && (
            <button className="pill on" onClick={() => setEditing(true)}>
              {hasContent ? "Modifier le PESTEL" : "+ Renseigner le PESTEL"}
            </button>
          )}
        </div>
      )}
      {editing && isExec && <PestelEditor initial={fw?.content ?? null} onClose={() => setEditing(false)} />}
      {!hasContent && !editing && <EmptyFramework label="PESTEL" />}
      {hasContent && (
        <Card>
          <Eyebrow color={T.gold}>PESTEL — Afrique de l'Ouest / Côte d'Ivoire</Eyebrow>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {factors.map((p, i) => (
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
    </div>
  );
}

/* ---- Canvas ---- */

function CanvasEditor({ initial, onClose }: { initial: CanvasContent | null; onClose: () => void }) {
  const [txt, setTxt] = useState<Record<string, string>>(() =>
    Object.fromEntries(CANVAS_BLOCKS.map((t) => [t, initial?.blocks?.find((b) => b.t === t)?.d ?? ""]))
  );
  const { saving, err, save } = useSave("canvas");
  return (
    <EditorShell
      title="Business Model Canvas — édition"
      onClose={onClose}
      saving={saving}
      err={err}
      onSave={() => {
        const blocks: CanvasBlock[] = CANVAS_BLOCKS.map((t) => ({ t, d: txt[t].trim() })).filter((b) => b.d);
        void save({ blocks } satisfies CanvasContent, onClose);
      }}
    >
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        {CANVAS_BLOCKS.map((t) => (
          <div key={t}>
            <label style={labelStyle}>{t}</label>
            <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={txt[t]} onChange={(e) => setTxt((x) => ({ ...x, [t]: e.target.value }))} />
          </div>
        ))}
      </div>
    </EditorShell>
  );
}

function CanvasTab() {
  const { data: fw, loading } = useFramework<CanvasContent>("canvas");
  const isExec = useIsExec();
  const [editing, setEditing] = useState(false);
  if (loading) return <Card><div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div></Card>;
  const blocks = fw?.content?.blocks ?? [];
  const hasContent = blocks.length > 0;
  return (
    <div>
      {isExec && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          {!editing && (
            <button className="pill on" onClick={() => setEditing(true)}>
              {hasContent ? "Modifier le Canvas" : "+ Renseigner le Canvas"}
            </button>
          )}
        </div>
      )}
      {editing && isExec && <CanvasEditor initial={fw?.content ?? null} onClose={() => setEditing(false)} />}
      {!hasContent && !editing && <EmptyFramework label="Business Model Canvas" />}
      {hasContent && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {blocks.map((b, i) => (
            <Card key={i} style={{ gridColumn: i === 2 ? "3" : i === 8 ? "1 / span 3" : "auto" }}>
              <Eyebrow color={T.plum}>{b.t}</Eyebrow>
              <div style={{ marginTop: 8, fontSize: 12.5, color: T.dim, lineHeight: 1.5 }}>{b.d}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Porter / BCG (summaries/quanti) ---- */

function PorterTab() {
  const { data: quanti } = useQuantiSummary();
  const pf = quanti?.porterForces;
  if (!quanti || (pf?.pouvoirFournisseurs == null && pf?.pouvoirClients == null)) {
    return (
      <Card>
        <Eyebrow color={T.clay}>Porter — 5 forces</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
          En attente des imports internes (P&L/LIVE) — voir README.
        </div>
      </Card>
    );
  }
  const forces: { force: string; v: number | null; note: string }[] = [
    { force: "Pouvoir fournisseurs", v: pf?.pouvoirFournisseurs ?? null, note: "Concentration Top-3 fournisseurs (CAS) — calculé depuis les imports P&L (orders)." },
    { force: "Pouvoir clients", v: pf?.pouvoirClients ?? null, note: "Concentration Top-5 clients (montant pipeline) — calculé depuis les imports LIVE (opportunities)." },
    { force: "Rivalité", v: null, note: "En attente de saisie/imports." },
    { force: "Substituts", v: null, note: "En attente de saisie/imports." },
    { force: "Nouveaux entrants", v: null, note: "En attente de saisie/imports." },
  ];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={T.clay}>Porter — 5 forces (quantifiées)</Eyebrow>
        <Badge c={T.emerald}>Fournisseurs/clients : temps réel</Badge>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {forces.map((f) => (
          <div key={f.force}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: T.ink, fontWeight: 600 }}>{f.force}</span>
              <span style={{ color: f.v != null ? T.clay : T.faint, fontVariantNumeric: "tabular-nums" }}>{f.v != null ? Math.round(f.v) : "—"}</span>
            </div>
            <div style={{ height: 7, background: T.panel2, borderRadius: 4, marginBottom: 4 }}>
              <div style={{ width: `${f.v != null ? Math.min(Math.max(f.v, 0), 100) : 0}%`, height: "100%", background: T.clay, borderRadius: 4 }} />
            </div>
            <div style={{ fontSize: 11.5, color: T.faint }}>{f.note}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BcgTab() {
  const { data: quanti } = useQuantiSummary();
  const bcg = quanti?.bcg ?? [];
  if (bcg.length === 0) {
    return (
      <Card>
        <Eyebrow color={T.emerald}>Matrice BCG — portefeuille d'activités</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente des imports internes (P&L).</div>
      </Card>
    );
  }
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={T.emerald}>Matrice BCG — portefeuille d'activités (taille = marge)</Eyebrow>
        <Badge c={T.emerald}>Temps réel (imports P&L)</Badge>
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
            <Scatter data={[...bcg]}>
              {bcg.map((b, i) => (
                <Cell key={i} fill={QCOL[b.q]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginTop: 6 }}>
        {bcg.map((b, i) => (
          <span key={i} style={{ color: T.dim }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: QCOL[b.q], marginRight: 5 }} />
            {b.n} <span style={{ color: T.faint }}>({b.q})</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

export function Cadres() {
  const [c, setC] = useState("swot");
  const CN: [string, string][] = [
    ["swot", "SWOT"],
    ["pestel", "PESTEL"],
    ["porter", "Porter"],
    ["bcg", "BCG"],
    ["canvas", "Canvas"],
  ];
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

      {c === "swot" && <SwotTab />}
      {c === "pestel" && <PestelTab />}
      {c === "porter" && <PorterTab />}
      {c === "bcg" && <BcgTab />}
      {c === "canvas" && <CanvasTab />}
    </div>
  );
}
