import React, { useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { T, PROX } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge, Tip } from "../../../design/ui";
import { quadrant } from "../data";
import { useIsExec } from "../../../lib/rbac";
import { actionPriority, createAction, useActions, type ActionStatus } from "../lib/execution";
import { updateBizOpportunity, useBizOpportunities, type BizOpportunityProbability, type BizOpportunityStatus } from "../lib/intel";

const PROBA_META: Record<BizOpportunityProbability, { l: string; c: string }> = {
  high: { l: "Probabilité haute", c: T.emerald },
  medium: { l: "Probabilité moyenne", c: T.gold },
  low: { l: "Probabilité basse", c: T.faint },
};

const OPP_STATUS_META: Record<BizOpportunityStatus, { l: string; c: string }> = {
  new: { l: "Nouvelle", c: T.gold },
  qualified: { l: "Qualifiée", c: T.emerald },
  dropped: { l: "Écartée", c: T.faint },
};

/** « 💼 Opportunités business (IA) » — pipeline `bizOpportunities` alimenté par l'enrichissement
 * IA hebdomadaire (plan d'audit §6.1/§6.2). Qualification humaine réservée aux exécutifs. */
function BizOpportunitiesSection({ isExec }: { isExec: boolean }) {
  const { opportunities, loading } = useBizOpportunities();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [owners, setOwners] = useState<Record<string, string>>({});

  async function setStatus(id: string, status: BizOpportunityStatus) {
    setBusyId(id);
    try {
      await updateBizOpportunity(id, { status });
    } finally {
      setBusyId(null);
    }
  }

  // M12 audit : « Convertir en action » transforme une opportunité en LEAD ACTIONNABLE — crée une
  // action liée (linkedItemId = opp:<id>, traçabilité), affecte le porteur, passe l'opp en qualifiée
  // et mémorise l'actionId. Fini le simple clic « qualifier » sans responsable ni suivi.
  async function convertToAction(o: (typeof opportunities)[number]) {
    const owner = (owners[o.id] || o.owner || "").trim();
    if (!owner) return;
    setBusyId(o.id);
    try {
      const actionId = await createAction({
        title: `${o.name} — ${o.nextAction || "à traiter"}`,
        impact: o.probability === "high" ? 5 : o.probability === "medium" ? 4 : 3,
        urgence: o.horizon === "imminent" ? 5 : o.horizon === "court" ? 4 : 3,
        effort: 3,
        ev: 0,
        owner,
        echeance: o.deadline || o.nextActionDate || "",
        statut: "À planifier",
        source: `Opportunité : ${o.name}`,
        linkedItemId: `opp:${o.id}`,
      });
      await updateBizOpportunity(o.id, { status: "qualified", owner, actionId });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <Eyebrow color={T.emerald}>💼 Opportunités business (IA)</Eyebrow>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && opportunities.length === 0 && (
          <div style={{ fontSize: 12.5, color: T.faint }}>Chargement des opportunités…</div>
        )}
        {!loading && opportunities.length === 0 && (
          <div style={{ fontSize: 12.5, color: T.faint }}>
            Aucune opportunité détectée pour l'instant — alimenté par l'enrichissement IA hebdomadaire.
          </div>
        )}
        {opportunities.map((o, i) => (
          <div key={o.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none", opacity: o.status === "dropped" ? 0.55 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 600 }}>{o.name}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <Badge c={OPP_STATUS_META[o.status]?.c}>{OPP_STATUS_META[o.status]?.l ?? o.status}</Badge>
                <Badge c={T.plum}>{o.client}</Badge>
                <Badge c={T.steel}>BU {o.bu}</Badge>
                <Badge c={T.gold}>Montant estimé : {o.estAmount || "—"}</Badge>
                <Badge c={o.horizon === "imminent" ? T.clay : T.faint}>
                  {o.deadline ? `Échéance ${o.deadline}` : PROX[o.horizon]?.l ?? o.horizon}
                </Badge>
                <Badge c={PROBA_META[o.probability]?.c}>{PROBA_META[o.probability]?.l ?? o.probability}</Badge>
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: T.dim }}>
                <b style={{ color: T.steel }}>Offre :</b> {o.offering}
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5, color: T.dim }}>
                <b style={{ color: T.gold }}>Prochaine action :</b> {o.nextAction}
              </div>
              {o.competitorsLikely && o.competitorsLikely.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 12.5, color: T.dim }}>
                  <b style={{ color: T.clay }}>Concurrents probables :</b> {o.competitorsLikely.join(", ")}
                </div>
              )}
              {o.owner && (
                <div style={{ marginTop: 4, fontSize: 12.5, color: T.emerald }}>
                  <b>Porteur :</b> {o.owner}{o.actionId ? " · action créée ✓" : ""}
                </div>
              )}
            </div>
            {isExec && o.status !== "dropped" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 172 }}>
                <input
                  className="inp"
                  placeholder="Porteur (commercial)"
                  value={owners[o.id] ?? o.owner ?? ""}
                  onChange={(e) => setOwners((m) => ({ ...m, [o.id]: e.target.value }))}
                  style={{ fontSize: 12, padding: "5px 8px" }}
                />
                <button
                  className="pill on"
                  disabled={busyId === o.id || !(owners[o.id] ?? o.owner ?? "").trim()}
                  onClick={() => convertToAction(o)}
                  title="Crée une action liée et qualifie l'opportunité"
                >
                  {o.actionId ? "Ré-affecter" : "Convertir en action →"}
                </button>
                <button className="pill" disabled={busyId === o.id} onClick={() => setStatus(o.id, "dropped")}>
                  Écarter
                </button>
              </div>
            )}
            {isExec && o.status === "dropped" && (
              <div>
                <button className="pill" disabled={busyId === o.id} onClick={() => setStatus(o.id, "new")}>
                  Réactiver
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

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
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
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
      <BizOpportunitiesSection isExec={isExec} />
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
              <Kpi label="Score du plan (impact×urgence/effort)" value={`${totEv} pts`} accent={T.emerald} sub="Σ des scores d'action" />
            </Card>
            <Card>
              <Kpi label="À faire maintenant" value={now} accent={T.clay} sub="impact & urgence forts" />
            </Card>
            <Card>
              <Kpi label="À lancer / immédiat" value={lancer} accent={T.gold} sub="actions non démarrées" />
            </Card>
          </div>
          <Card style={{ marginBottom: 14 }}>
            <Eyebrow color={T.gold}>Matrice de priorisation — impact × urgence (taille = score de priorité)</Eyebrow>
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
            <div className="tbl-scroll" style={{ marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: T.faint, fontSize: 10.5, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>#</th>
                    <th style={{ padding: "6px 8px" }}>Action</th>
                    <th style={{ padding: "6px 8px" }}>Zone</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Score</th>
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
                      <td style={{ padding: "8px", textAlign: "right", color: T.emerald, fontVariantNumeric: "tabular-nums" }}>{a.ev} pts</td>
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
