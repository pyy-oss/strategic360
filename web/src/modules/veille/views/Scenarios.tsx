import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useIsExec } from "../../../lib/rbac";
import { createScenario, useScenarios } from "../lib/execution";
import { useFramework } from "../lib/frameworks";
import { PUBLISHED_STATUSES, useIntelItems } from "../lib/intel";
import { matchSignposts, triggeredCount, type SignpostMatch } from "../lib/signposts";

/** Radar d'alerte des signes précurseurs (levier « waouh » n°6) : chaque signpost confronté aux
 * signaux réels — déclenché (avec signal-preuve cliquable) ou encore à guetter. */
function SignpostRadar({ matches }: { matches: SignpostMatch[] }) {
  const navigate = useNavigate();
  const { n, total } = triggeredCount(matches);
  if (total === 0) return null;
  const alert = n >= Math.ceil(total / 2) && n > 0;
  return (
    <div style={{ marginTop: 8, fontSize: 11.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <b style={{ color: alert ? T.clay : T.dim }}>{alert ? "⚠️ Rupture en approche —" : "Signes précurseurs :"}</b>
        <Badge c={alert ? T.clay : T.faint}>{n}/{total} déclenché{n > 1 ? "s" : ""}</Badge>
      </div>
      <ul style={{ margin: "2px 0 0", paddingLeft: 16, listStyle: "none" }}>
        {matches.map((m, j) => (
          <li key={j} style={{ marginBottom: 3 }}>
            <span style={{ color: m.triggered ? T.clay : T.faint, fontWeight: 700, marginRight: 6 }}>{m.triggered ? "●" : "○"}</span>
            <span style={{ color: T.dim }}>{m.text}</span>
            {m.items.map((it) => (
              <button
                key={it.id}
                onClick={() => navigate(`/veille/fil?ent=${encodeURIComponent(it.ent || "")}`)}
                title={it.title}
                style={{ border: "none", background: T.clay + "22", color: T.clay, cursor: "pointer", fontSize: 10, padding: "1px 6px", borderRadius: 6, marginLeft: 6 }}
              >
                preuve ↗
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

type ScenarioWorldAI = { title: string; probability: number; narrative: string; signposts: string[]; response: string };
type ScenariosContent = { axisX?: string; axisY?: string; worlds?: ScenarioWorldAI[] };

/** Suggestions de scénarios générées par l'IA (M4 audit) avec SIGNAUX PRÉCURSEURS à guetter —
 * rend le cadre actionnable (early-warning) au lieu d'inerte. L'exécutif adopte en créant un scénario. */
function AiScenarioSuggestions() {
  const { data: fw } = useFramework<ScenariosContent>("scenarios");
  const { items: rawItems } = useIntelItems();
  const items = React.useMemo(() => rawItems.filter((it) => PUBLISHED_STATUSES.has(it.status ?? "new")), [rawItems]);
  const s = fw?.content;
  if (!s || !(s.worlds && s.worlds.length)) return null;
  return (
    <Card style={{ marginTop: 14, borderColor: T.steel }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <Eyebrow color={T.steel}>Scénarios suggérés par l'IA — signaux précurseurs à guetter</Eyebrow>
        <Badge c={T.gold}>Suggéré · à adopter</Badge>
      </div>
      {(s.axisX || s.axisY) && (
        <div style={{ fontSize: 11.5, color: T.faint, marginTop: 6 }}>
          Axes d'incertitude : <b style={{ color: T.dim }}>{s.axisY}</b> × <b style={{ color: T.dim }}>{s.axisX}</b>
        </div>
      )}
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
        {s.worlds.map((w, i) => (
          <div key={i} style={{ background: T.panel2, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{w.title}</span>
              <Badge c={T.steel}>proba {pct(w.probability)}</Badge>
            </div>
            {w.narrative && <div style={{ fontSize: 12, color: T.dim, marginTop: 6, lineHeight: 1.5 }}>{w.narrative}</div>}
            {w.signposts.length > 0 && (
              <SignpostRadar matches={matchSignposts(w.signposts, items)} />
            )}
            {w.response && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: T.emerald }}>
                <b>Réponse préparée :</b> {w.response}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

const WORLD_COLORS = [T.gold, T.emerald, T.clay, T.steel];

interface WorldForm {
  q: string;
  d: string;
  p: string; // probability as string for the input
}

/** "Nouveau scénario" — exec-gated contribution panel, same convention as Execution.tsx's
 * `NewInitiativePanel`. */
function NewScenarioPanel({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [axisX, setAxisX] = useState("");
  const [axisY, setAxisY] = useState("");
  const [worlds, setWorlds] = useState<WorldForm[]>([
    { q: "", d: "", p: "0.25" },
    { q: "", d: "", p: "0.25" },
    { q: "", d: "", p: "0.25" },
    { q: "", d: "", p: "0.25" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setWorld = (i: number, patch: Partial<WorldForm>) => setWorlds((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !axisX.trim() || !axisY.trim() || worlds.some((w) => !w.q.trim() || !w.d.trim())) {
      setErr("Titre, axes et les 4 mondes (libellé + description) sont requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createScenario({
        title: title.trim(),
        axisX: axisX.trim(),
        axisY: axisY.trim(),
        worlds: worlds.map((w, i) => ({ q: w.q.trim(), d: w.d.trim(), c: WORLD_COLORS[i] })),
        probs: worlds.map((w) => Number(w.p) || 0),
        triggers: [],
        responses: [],
      });
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

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

  return (
    <Card style={{ marginBottom: 14, borderColor: T.gold }}>
      <form onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>Nouveau scénario</span>
          <button type="button" className="pill" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="g2 gform" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Titre *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <label style={labelStyle}>Axe X (incertitude horizontale) *</label>
            <input style={inputStyle} value={axisX} onChange={(e) => setAxisX(e.target.value)} required />
          </div>
          <div>
            <label style={labelStyle}>Axe Y (incertitude verticale) *</label>
            <input style={inputStyle} value={axisY} onChange={(e) => setAxisY(e.target.value)} required />
          </div>
          {worlds.map((w, i) => (
            <div key={i} style={{ gridColumn: i % 2 === 0 ? "1" : "2", border: `1px solid ${T.line}`, borderTop: `3px solid ${WORLD_COLORS[i]}`, borderRadius: 8, padding: 10 }}>
              <label style={labelStyle}>Monde {i + 1} — libellé *</label>
              <input style={inputStyle} value={w.q} onChange={(e) => setWorld(i, { q: e.target.value })} />
              <label style={{ ...labelStyle, marginTop: 8 }}>Description *</label>
              <textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical" }} value={w.d} onChange={(e) => setWorld(i, { d: e.target.value })} />
              <label style={{ ...labelStyle, marginTop: 8 }}>Probabilité (0-1)</label>
              <input type="number" min={0} max={1} step={0.05} style={inputStyle} value={w.p} onChange={(e) => setWorld(i, { p: e.target.value })} />
            </div>
          ))}
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <button type="submit" className="pill on" disabled={submitting}>
          {submitting ? "Enregistrement…" : "Enregistrer le scénario"}
        </button>
      </form>
    </Card>
  );
}

/** "Scénarios" — reads the live Firestore `scenarios` collection only (no sample fallback). */
export function Scenarios() {
  const { scenarios, loading } = useScenarios();
  const isExec = useIsExec();
  const [showForm, setShowForm] = useState(false);
  const live = scenarios[0];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: T.dim }}>
          {live ? (
            <>
              Planification par scénarios sur deux axes d'incertitude majeurs : <b style={{ color: T.ink }}>{live.axisY}</b> (vertical) × <b style={{ color: T.ink }}>{live.axisX}</b> (horizontal).
            </>
          ) : (
            <>Planification par scénarios sur deux axes d'incertitude majeurs.</>
          )}
        </div>
        {isExec && (
          <button className="pill on" onClick={() => setShowForm((v) => !v)}>
            + Nouveau scénario
          </button>
        )}
      </div>
      {showForm && isExec && <NewScenarioPanel onClose={() => setShowForm(false)} />}
      {loading && !live && (
        <Card>
          <div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div>
        </Card>
      )}
      {!loading && !live && (
        <Card>
          <Eyebrow color={T.faint}>Scénarios</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>Aucun scénario — à créer par un profil exécutif.</div>
        </Card>
      )}
      {live && (
        <>
          <div style={{ marginBottom: 10 }}>
            <Badge c={T.emerald}>{live.title}</Badge>
          </div>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[1, 0, 3, 2].map((idx) => {
              const w = live.worlds[idx];
              if (!w) return null;
              const p = live.probs?.[idx] ?? 0;
              return (
                <Card key={idx} style={{ borderTop: `3px solid ${w.c}`, minHeight: 150 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <Eyebrow color={w.c}>{w.q}</Eyebrow>
                    <Badge c={w.c}>proba {pct(p)}</Badge>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>{w.d}</div>
                  <div style={{ marginTop: 8, height: 6, background: T.panel2, borderRadius: 4 }}>
                    <div style={{ width: `${p * 100}%`, height: "100%", background: w.c, borderRadius: 4 }} />
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
      <AiScenarioSuggestions />
    </div>
  );
}
