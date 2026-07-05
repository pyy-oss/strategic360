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
import { Select } from "../../../design/fields";
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
          <div key={r.f} className="pestel-row" style={{ display: "grid", gridTemplateColumns: "130px 90px 70px 1fr", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{r.f}</span>
            <div>
              <label style={labelStyle}>Impact (%)</label>
              <input type="number" min={0} max={100} style={inputStyle} value={Math.round(r.imp * 100)} onChange={(e) => set(i, { imp: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} />
            </div>
            <div>
              <label style={labelStyle}>Tendance</label>
              <Select value={r.tr} onChange={(v) => set(i, { tr: v })} ariaLabel="Tendance"
                options={[{ value: "↑", label: "↑ En hausse" }, { value: "→", label: "→ Stable" }, { value: "↓", label: "↓ En baisse" }]} />
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
        <div className="canvas-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
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


/* ---- Contexte entreprise (dynamique — frameworks/companyContext) ---- */

type ContexteContent = { text: string; changes?: string[] };

function ContexteEditor({ initial, onClose }: { initial: ContexteContent | null; onClose: () => void }) {
  const [text, setText] = useState(initial?.text ?? "");
  const { saving, err, save } = useSave("companyContext");
  return (
    <EditorShell
      title="Contexte entreprise — édition"
      onClose={onClose}
      saving={saving}
      err={err}
      onSave={() => {
        if (text.trim()) void save({ text: text.trim() } satisfies ContexteContent, onClose);
      }}
    >
      <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 8 }}>
        Ce texte est injecté dans TOUS les prompts IA (classification des signaux, SWOT/PESTEL, opportunités, briefing).
        Après votre édition, l'IA ne le réécrira plus automatiquement — vous en gardez la main.
      </div>
      <textarea style={{ ...inputStyle, minHeight: 380, resize: "vertical", fontSize: 12, lineHeight: 1.55 }} value={text} onChange={(e) => setText(e.target.value)} />
    </EditorShell>
  );
}

function ContexteTab() {
  const { data: fw, loading } = useFramework<ContexteContent>("companyContext");
  const isExec = useIsExec();
  const [editing, setEditing] = useState(false);
  if (loading) return <Card><div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div></Card>;
  const text = fw?.content?.text ?? "";
  const changes = fw?.content?.changes ?? [];
  const aiMaintained = typeof fw?.updatedBy === "string" && fw.updatedBy.startsWith("ai:");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Badge c={aiMaintained ? T.emerald : T.gold}>{aiMaintained ? "Maintenu par l'IA (rafraîchi chaque lundi)" : "Édité par la Direction — IA en lecture seule"}</Badge>
          {fw?.version != null && <Badge c={T.faint}>v{fw.version}</Badge>}
        </div>
        {isExec && !editing && (
          <button className="pill on" onClick={() => setEditing(true)}>
            {text ? "Modifier le contexte" : "+ Renseigner le contexte"}
          </button>
        )}
      </div>
      {editing && isExec && <ContexteEditor initial={fw?.content ?? null} onClose={() => setEditing(false)} />}
      {!text && !editing && (
        <Card>
          <Eyebrow color={T.faint}>Contexte entreprise</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
            Pas encore initialisé — le seed ou le prochain enrichissement IA le créera.
          </div>
        </Card>
      )}
      {text && (
        <Card>
          <Eyebrow color={T.plum}>Contexte injecté dans tous les prompts IA</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{text}</div>
          {changes.length > 0 && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
              <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 4 }}>Dernières mises à jour IA :</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: T.faint, lineHeight: 1.6 }}>
                {changes.map((c, i) => (<li key={i}>{c}</li>))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ---- Porter / BCG (summaries/quanti) ---- */

type PorterForce = { v: number; note: string };
type PorterContent = { rivalite?: PorterForce; substituts?: PorterForce; nouveauxEntrants?: PorterForce };

function PorterTab() {
  const { data: quanti } = useQuantiSummary();
  // 3 forces qualitatives estimées par l'IA (M3 audit) — frameworks/porter.
  const { data: porterFw } = useFramework<PorterContent>("porter");
  const ai = porterFw?.content;
  const pf = quanti?.porterForces;
  const hasQuant = pf?.pouvoirFournisseurs != null || pf?.pouvoirClients != null;
  const hasAi = !!(ai?.rivalite || ai?.substituts || ai?.nouveauxEntrants);
  if (!hasQuant && !hasAi) {
    return (
      <Card>
        <Eyebrow color={T.clay}>Porter — 5 forces</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
          En attente des imports internes (P&L/LIVE) et de la première génération IA — voir README.
        </div>
      </Card>
    );
  }
  const forces: { force: string; v: number | null; note: string }[] = [
    { force: "Pouvoir fournisseurs", v: pf?.pouvoirFournisseurs ?? null, note: "Concentration Top-3 fournisseurs (CAS) — calculé depuis les imports P&L (orders)." },
    { force: "Pouvoir clients", v: pf?.pouvoirClients ?? null, note: "Concentration Top-5 clients (montant pipeline) — calculé depuis les imports LIVE (opportunities)." },
    { force: "Rivalité", v: ai?.rivalite?.v ?? null, note: ai?.rivalite?.note || "Estimée par l'IA depuis les signaux concurrents — en attente de génération." },
    { force: "Substituts", v: ai?.substituts?.v ?? null, note: ai?.substituts?.note || "Menace de désintermédiation (éditeurs/hyperscalers) — estimée par l'IA." },
    { force: "Nouveaux entrants", v: ai?.nouveauxEntrants?.v ?? null, note: ai?.nouveauxEntrants?.note || "Menace de nouveaux entrants — estimée par l'IA." },
  ];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={T.clay}>Porter — 5 forces</Eyebrow>
        <Badge c={T.emerald}>2 quantifiées (interne) · 3 estimées (IA)</Badge>
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
    ["ansoff", "Ansoff"],
    ["vrio", "VRIO"],
    ["valueChain", "Chaîne de valeur"],
    ["bcg", "BCG"],
    ["canvas", "Canvas"],
    ["contexte", "Contexte entreprise"],
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
      {c === "ansoff" && <AnsoffTab />}
      {c === "vrio" && <VrioTab />}
      {c === "valueChain" && <ValueChainTab />}
      {c === "bcg" && <BcgTab />}
      {c === "canvas" && <CanvasTab />}
      {c === "contexte" && <ContexteTab />}
    </div>
  );
}

/* ---- Ansoff / VRIO / Chaîne de valeur (cadres IA additionnels — audit 2026-07) ---- */

type AnsoffContent = { penetration?: string[]; devProduit?: string[]; devMarche?: string[]; diversification?: string[] };
function AnsoffTab() {
  const { data: fw } = useFramework<AnsoffContent>("ansoff");
  const a = fw?.content;
  const cells: { k: keyof AnsoffContent; l: string; c: string; sub: string }[] = [
    { k: "penetration", l: "Pénétration de marché", c: T.emerald, sub: "marchés actuels × offres actuelles" },
    { k: "devProduit", l: "Développement produit", c: T.gold, sub: "marchés actuels × nouvelles offres" },
    { k: "devMarche", l: "Développement marché", c: T.steel, sub: "nouveaux marchés × offres actuelles" },
    { k: "diversification", l: "Diversification", c: T.clay, sub: "nouveaux marchés × nouvelles offres" },
  ];
  if (!a) return <Card><Eyebrow color={T.gold}>Matrice d'Ansoff</Eyebrow><div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente de la première génération IA (enrichissement hebdomadaire).</div></Card>;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={T.gold}>Matrice d'Ansoff — leviers de croissance</Eyebrow>
        <Badge c={T.emerald}>Suggéré par l'IA</Badge>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {cells.map((cell) => (
          <div key={cell.k} style={{ background: T.panel2, borderRadius: 10, padding: "12px 14px", borderTop: `3px solid ${cell.c}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: cell.c }}>{cell.l}</div>
            <div style={{ fontSize: 10.5, color: T.faint, marginBottom: 8 }}>{cell.sub}</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: T.dim, lineHeight: 1.6 }}>
              {(a[cell.k] ?? []).map((it, i) => <li key={i}>{it}</li>)}
              {(a[cell.k] ?? []).length === 0 && <li style={{ color: T.faint, listStyle: "none" }}>—</li>}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

type VrioResource = { resource: string; valuable: boolean; rare: boolean; inimitable: boolean; organized: boolean; verdict: string; note: string };
function VrioTab() {
  const { data: fw } = useFramework<{ resources?: VrioResource[] }>("vrio");
  const rs = fw?.content?.resources ?? [];
  const VERDICT_C: Record<string, string> = { "avantage durable": T.emerald, "avantage temporaire": T.gold, "parité concurrentielle": T.steel, "désavantage": T.clay };
  const yn = (b: boolean) => <span style={{ color: b ? T.emerald : T.faint, fontWeight: 700 }}>{b ? "✓" : "—"}</span>;
  if (rs.length === 0) return <Card><Eyebrow color={T.steel}>Analyse VRIO</Eyebrow><div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente de la première génération IA (enrichissement hebdomadaire).</div></Card>;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={T.steel}>VRIO — avantages ressources & capacités</Eyebrow>
        <Badge c={T.emerald}>Suggéré par l'IA</Badge>
      </div>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: T.faint, textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Ressource</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>V</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>R</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>I</th>
              <th style={{ padding: "6px 8px", textAlign: "center" }}>O</th>
              <th style={{ padding: "6px 8px" }}>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rs.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${T.line}` }}>
                <td style={{ padding: "8px", color: T.ink }}><div style={{ fontWeight: 600 }}>{r.resource}</div><div style={{ color: T.faint, fontSize: 11 }}>{r.note}</div></td>
                <td style={{ padding: "8px", textAlign: "center" }}>{yn(r.valuable)}</td>
                <td style={{ padding: "8px", textAlign: "center" }}>{yn(r.rare)}</td>
                <td style={{ padding: "8px", textAlign: "center" }}>{yn(r.inimitable)}</td>
                <td style={{ padding: "8px", textAlign: "center" }}>{yn(r.organized)}</td>
                <td style={{ padding: "8px" }}><Badge c={VERDICT_C[r.verdict] ?? T.steel}>{r.verdict}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

type VcActivity = { activity: string; strength: number; lever: string };
function ValueChainTab() {
  const { data: fw } = useFramework<{ primary?: VcActivity[]; support?: VcActivity[] }>("valueChain");
  const vc = fw?.content;
  const hasData = !!(vc && ((vc.primary?.length ?? 0) + (vc.support?.length ?? 0) > 0));
  if (!hasData) return <Card><Eyebrow color={T.emerald}>Chaîne de valeur</Eyebrow><div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>En attente de la première génération IA (enrichissement hebdomadaire).</div></Card>;
  const row = (a: VcActivity, i: number) => (
    <div key={i} style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
        <span style={{ color: T.ink, fontWeight: 600 }}>{a.activity}</span>
        <span style={{ color: T.emerald, fontVariantNumeric: "tabular-nums" }}>{Math.round(a.strength)}/100</span>
      </div>
      <div style={{ height: 6, background: T.panel2, borderRadius: 4, marginBottom: 3 }}>
        <div style={{ width: `${Math.min(Math.max(a.strength, 0), 100)}%`, height: "100%", background: a.strength >= 66 ? T.emerald : a.strength >= 40 ? T.gold : T.clay, borderRadius: 4 }} />
      </div>
      {a.lever && <div style={{ fontSize: 11, color: T.faint }}><b style={{ color: T.gold }}>Levier :</b> {a.lever}</div>}
    </div>
  );
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={T.emerald}>Chaîne de valeur (Porter)</Eyebrow>
        <Badge c={T.emerald}>Suggéré par l'IA</Badge>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: T.steel, fontWeight: 600, marginBottom: 8 }}>Activités principales</div>
          {(vc!.primary ?? []).map(row)}
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.plum, fontWeight: 600, marginBottom: 8 }}>Activités de soutien</div>
          {(vc!.support ?? []).map(row)}
        </div>
      </div>
    </Card>
  );
}
