import React, { useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { T, fmt } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge, Tip } from "../../../design/ui";
import { quadrant } from "../data";
import { useIsExec } from "../../../lib/rbac";
import { actionPriority, createAction, useActions, type ActionStatus } from "../lib/execution";

interface NewActionForm {
  title: string;
  impact: number; // 1-5, matches the existing quadrant() thresholds (>=4) and chart domain [0,6]
  urgence: number; // 1-5
  effort: number; // 1-5
  owner: string;
  echeance: string;
  statut: ActionStatus;
  source: string;
}

const EMPTY_FORM: NewActionForm = {
  title: "",
  impact: 3,
  urgence: 3,
  effort: 3,
  owner: "",
  echeance: "",
  statut: "À planifier",
  source: "",
};

/** "Nouvelle action" — contribution panel, exec-gated (BUILD_KIT.md §7: `actions` → exécutifs).
 * `ev` (valeur attendue) is derived on submit from the impact×urgence/effort formula (BUILD_KIT.md
 * §8.3) as a proxy — the action's own fields carry no independent monetary base, so this mirrors
 * the same priority formula used for the quadrant/sort rather than an unrelated manual estimate. */
function NewActionPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<NewActionForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof NewActionForm>(k: K, v: NewActionForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setErr("Le titre est requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const ev = actionPriority({ impact: form.impact, urgence: form.urgence, effort: form.effort }) * 100;
      await createAction({
        title: form.title.trim(),
        impact: form.impact,
        urgence: form.urgence,
        effort: form.effort,
        ev: Math.round(ev),
        owner: form.owner.trim(),
        echeance: form.echeance.trim(),
        statut: form.statut,
        source: form.source.trim() || undefined,
      });
      setForm(EMPTY_FORM);
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
          <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>Nouvelle action</span>
          <button type="button" className="pill" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Titre *</label>
            <input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} required />
          </div>
          <div>
            <label style={labelStyle}>Impact (1-5)</label>
            <input type="number" min={1} max={5} style={inputStyle} value={form.impact} onChange={(e) => set("impact", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Urgence (1-5)</label>
            <input type="number" min={1} max={5} style={inputStyle} value={form.urgence} onChange={(e) => set("urgence", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Effort (1-5)</label>
            <input type="number" min={1} max={5} style={inputStyle} value={form.effort} onChange={(e) => set("effort", Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>Porteur</label>
            <input style={inputStyle} value={form.owner} onChange={(e) => set("owner", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Échéance</label>
            <input style={inputStyle} value={form.echeance} onChange={(e) => set("echeance", e.target.value)} placeholder="ex: T3, Immédiat" />
          </div>
          <div>
            <label style={labelStyle}>Statut</label>
            <select style={inputStyle} value={form.statut} onChange={(e) => set("statut", e.target.value as ActionStatus)}>
              <option>À planifier</option>
              <option>À lancer</option>
              <option>En cours</option>
              <option>À surveiller</option>
              <option>Immédiat</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Source</label>
            <input style={inputStyle} value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="ex: Signal #2" />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <button type="submit" className="pill on" disabled={submitting}>
          {submitting ? "Enregistrement…" : "Enregistrer l'action"}
        </button>
      </form>
    </Card>
  );
}

/** "Plan d'action" — ported from `PlanAction` in the maquette; data source swapped to Firestore
 * `actions` (V6). */
export function PlanAction() {
  const { actions, loading } = useActions();
  const isExec = useIsExec();
  const [showForm, setShowForm] = useState(false);

  const acts = actions
    .map((a) => ({
      ...a,
      imp: a.impact,
      urg: a.urgence,
      eff: a.effort,
      t: a.title,
      ech: a.echeance,
      st: a.statut,
      src: a.source ?? "—",
      prio: actionPriority({ impact: a.impact, urgence: a.urgence, effort: a.effort }),
      q: quadrant({ imp: a.impact, urg: a.urgence }),
    }))
    .sort((x, y) => y.prio - x.prio);
  const totEv = acts.reduce((s, a) => s + a.ev, 0);
  const now = acts.filter((a) => a.q.l === "Faire maintenant").length;
  const lancer = acts.filter((a) => a.st === "À lancer" || a.st === "Immédiat").length;

  return (
    <div>
      <div style={{ fontSize: 12, color: T.plum, marginBottom: 14, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span>✅ La boucle « et maintenant ? » : chaque signal et événement converge en actions priorisées (impact × urgence, effort, valeur attendue), avec porteur et échéance. C'est ce qui relie l'intelligence à la valeur.</span>
        {isExec && (
          <button className="pill on" onClick={() => setShowForm((v) => !v)}>
            + Nouvelle action
          </button>
        )}
      </div>
      {showForm && isExec && <NewActionPanel onClose={() => setShowForm(false)} />}
      {loading && actions.length === 0 && <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>Chargement du plan d'action…</div>}
      {!loading && actions.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>
          Aucune action enregistrée pour l'instant. {isExec ? "Utilisez « + Nouvelle action » pour en créer une." : ""}
        </div>
      )}
      {actions.length > 0 && (
        <>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
            <Card>
              <Kpi label="Valeur attendue du plan" value={fmt(totEv * 1e6)} accent={T.emerald} sub="Σ des actions" />
            </Card>
            <Card>
              <Kpi label="À faire maintenant" value={now} accent={T.clay} sub="impact & urgence forts" />
            </Card>
            <Card>
              <Kpi label="À lancer / immédiat" value={lancer} accent={T.gold} sub="actions non démarrées" />
            </Card>
          </div>
          <Card style={{ marginBottom: 14 }}>
            <Eyebrow color={T.gold}>Matrice de priorisation — impact × urgence (taille = valeur attendue)</Eyebrow>
            <div style={{ height: 300, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ left: 6, right: 20, top: 10, bottom: 20 }}>
                  <CartesianGrid stroke={T.line} />
                  <XAxis type="number" dataKey="urg" name="Urgence" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Urgence →", position: "insideBottom", offset: -8, fill: T.dim, fontSize: 11 }} />
                  <YAxis type="number" dataKey="imp" name="Impact" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: T.faint, fontSize: 10 }} label={{ value: "Impact →", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
                  <ZAxis type="number" dataKey="ev" range={[120, 1000]} />
                  <ReferenceLine x={3.5} stroke={T.faint} />
                  <ReferenceLine y={3.5} stroke={T.faint} />
                  <Tooltip content={<Tip />} cursor={{ stroke: T.faint }} />
                  <Scatter data={acts.map((a) => ({ ...a, n: a.t }))}>
                    {acts.map((a, i) => (
                      <Cell key={i} fill={a.q.c} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
              {(
                [
                  ["Faire maintenant", T.clay],
                  ["Traiter vite", T.gold],
                  ["Planifier", T.emerald],
                  ["Surveiller", T.faint],
                ] as [string, string][]
              ).map(([l, c], i) => (
                <span key={i} style={{ color: T.dim }}>
                  <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: c, marginRight: 5 }} />
                  {l}
                </span>
              ))}
            </div>
          </Card>
          <Card>
            <Eyebrow color={T.steel}>Plan d'action priorisé</Eyebrow>
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: T.faint, fontSize: 10.5, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>#</th>
                    <th style={{ padding: "6px 8px" }}>Action</th>
                    <th style={{ padding: "6px 8px" }}>Zone</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Val. att.</th>
                    <th style={{ padding: "6px 8px" }}>Porteur</th>
                    <th style={{ padding: "6px 8px" }}>Échéance</th>
                    <th style={{ padding: "6px 8px" }}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {acts.map((a, i) => (
                    <tr key={a.id} style={{ borderTop: `1px solid ${T.line}` }}>
                      <td style={{ padding: "8px", color: T.gold, fontFamily: "'Bricolage Grotesque'", fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ padding: "8px", color: T.ink }}>
                        {a.t}
                        <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2 }}>
                          {a.src} · I{a.imp}·U{a.urg}·E{a.eff}
                        </div>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <Badge c={a.q.c}>{a.q.l}</Badge>
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: T.emerald, fontVariantNumeric: "tabular-nums" }}>{fmt(a.ev * 1e6)}</td>
                      <td style={{ padding: "8px", color: T.dim }}>{a.owner}</td>
                      <td style={{ padding: "8px", color: T.dim }}>{a.ech}</td>
                      <td style={{ padding: "8px" }}>
                        <Badge c={a.st === "En cours" ? T.emerald : a.st === "À surveiller" ? T.faint : T.gold}>{a.st}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
