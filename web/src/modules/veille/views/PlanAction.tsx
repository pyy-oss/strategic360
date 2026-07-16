import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { T, PROX } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge, Tip } from "../../../design/ui";
import { quadrant } from "../data";
import { useIsExec } from "../../../lib/rbac";
import { useAuthClaims } from "../../../lib/AuthProvider";
import { slugifyClient } from "../lib/copilote";
import { actionPriority, createAction, updateAction, createWinLossEntry, useActions, ACTION_STATUSES, type ActionStatus } from "../lib/execution";
import { updateBizOpportunity, useBizOpportunities, type BizOpportunityProbability, type BizOpportunityStatus } from "../lib/intel";
import { usePaged, Pager } from "../components/Pager";
import { Select, Input, DateField } from "../../../design/fields";
import { Modal, useToast } from "../../../design/overlay";

const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** Affiche une échéance ISO (yyyy-mm-dd) en clair « 3 juil. 2026 » ; laisse tout autre texte tel quel. */
function fmtEcheance(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!m) return v || "—";
  return `${+m[3]} ${MOIS_COURT[+m[2] - 1]} ${m[1]}`;
}

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
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [owners, setOwners] = useState<Record<string, string>>({});
  // Longue liste cumulative (audit design) : filtre par statut + pagination.
  const [oppFilter, setOppFilter] = useState<"all" | BizOpportunityStatus>("all");
  const oppFiltered = opportunities.filter((o) => oppFilter === "all" || o.status === oppFilter);
  const oppPaged = usePaged(oppFiltered, 10, oppFilter);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>💼 Opportunités business (IA)</Eyebrow>
        {opportunities.length > 0 && <Badge c={T.emerald}>{opportunities.length}</Badge>}
      </div>
      {opportunities.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {([["all", "Toutes"], ["new", "Nouvelles"], ["qualified", "Qualifiées"], ["dropped", "Écartées"]] as const).map(([k, l]) => (
            <button key={k} className={`pill ${oppFilter === k ? "on" : ""}`} onClick={() => setOppFilter(k)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && opportunities.length === 0 && (
          <div style={{ fontSize: 12.5, color: T.faint }}>Chargement des opportunités…</div>
        )}
        {!loading && opportunities.length === 0 && (
          <div style={{ fontSize: 12.5, color: T.faint }}>
            Aucune opportunité détectée pour l'instant — alimenté par l'enrichissement IA hebdomadaire.
          </div>
        )}
        {!loading && opportunities.length > 0 && oppFiltered.length === 0 && (
          <div style={{ fontSize: 12.5, color: T.faint }}>Aucune opportunité pour ce filtre.</div>
        )}
        {oppPaged.pageItems.map((o, i) => (
          <div key={o.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none", opacity: o.status === "dropped" ? 0.55 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 600 }}>{o.name}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <Badge c={OPP_STATUS_META[o.status]?.c}>{OPP_STATUS_META[o.status]?.l ?? o.status}</Badge>
                {o.source === "cross-sell" && <Badge c={T.emerald}>↗ Cross-sell</Badge>}
                {o.source === "upsell" && <Badge c={T.gold}>⤴ Upsell</Badge>}
                {o.source === "managed" && <Badge c={T.plum}>♻ Récurrent</Badge>}
                {o.source === "relance" && <Badge c={T.clay}>↺ Relance dormant</Badge>}
                {o.triggerEvent && <Badge c={T.gold}>⚡ Déclenché par la veille</Badge>}
                <Badge c={T.plum}>{o.client}</Badge>
                <Badge c={T.steel}>BU {o.bu}</Badge>
                <Badge c={T.gold}>Montant estimé : {o.estAmount || "—"}</Badge>
                <Badge c={o.horizon === "imminent" ? T.clay : T.faint}>
                  {o.deadline ? `Échéance ${o.deadline}` : PROX[o.horizon]?.l ?? o.horizon}
                </Badge>
                <Badge c={PROBA_META[o.probability]?.c}>{PROBA_META[o.probability]?.l ?? o.probability}</Badge>
              </div>
              {/* Unification des référentiels (audit 2026-07) : relie l'opportunité IA au compte RÉEL
                  du portefeuille (pipeline nt360) via un deep-link Copilote présélectionné. */}
              {o.client && (
                <div style={{ marginTop: 6 }}>
                  <button className="pill" style={{ fontSize: 11.5 }}
                    onClick={() => navigate(`/veille/copilote?account=${encodeURIComponent(slugifyClient(o.client))}`)}
                    title="Ouvrir ce compte dans le Copilote (pipeline réel nt360)">
                    ↗ Ouvrir « {o.client} » dans le Copilote
                  </button>
                </div>
              )}
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
      <Pager {...oppPaged} />
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
function NewActionPanel({ open, onClose, defaultOwner = "" }: { open: boolean; onClose: () => void; defaultOwner?: string }) {
  const [form, setForm] = useState<NewActionForm>({ ...EMPTY_FORM, owner: defaultOwner });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

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
      setForm({ ...EMPTY_FORM, owner: defaultOwner });
      toast.success("Action enregistrée.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle action">
      <form onSubmit={submit}>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Titre *</label>
            <Input value={form.title} onChange={(v) => set("title", v)} required />
          </div>
          <div>
            <label style={labelStyle}>Impact (1-5)</label>
            <Input type="number" min={1} max={5} value={String(form.impact)} onChange={(v) => set("impact", Number(v))} />
          </div>
          <div>
            <label style={labelStyle}>Urgence (1-5)</label>
            <Input type="number" min={1} max={5} value={String(form.urgence)} onChange={(v) => set("urgence", Number(v))} />
          </div>
          <div>
            <label style={labelStyle}>Effort (1-5)</label>
            <Input type="number" min={1} max={5} value={String(form.effort)} onChange={(v) => set("effort", Number(v))} />
          </div>
          <div>
            <label style={labelStyle}>Porteur</label>
            <Input value={form.owner} onChange={(v) => set("owner", v)} />
          </div>
          <div>
            <label style={labelStyle}>Échéance</label>
            <DateField value={form.echeance} onChange={(v) => set("echeance", v)} ariaLabel="Échéance" />
          </div>
          <div>
            <label style={labelStyle}>Statut</label>
            <Select value={form.statut} onChange={(v) => set("statut", v as ActionStatus)} ariaLabel="Statut"
              options={["À planifier", "À lancer", "En cours", "À surveiller", "Immédiat"].map((s) => ({ value: s, label: s }))} />
          </div>
          <div>
            <label style={labelStyle}>Source</label>
            <Input value={form.source} onChange={(v) => set("source", v)} placeholder="ex: Signal #2" />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer l'action"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Capture du résultat commercial (win/loss) à la conclusion d'une action — alimente le taux de
 * victoire réel (Concurrence, battlecards du Copilote) ET l'attribution en montant gagné. Optionnel :
 * « Passer » si l'action n'est pas une affaire commerciale (le statut reste appliqué). */
function OutcomeCaptureModal({ outcome, onClose }: { outcome: { title: string; result: "win" | "loss" } | null; onClose: () => void }) {
  const [montant, setMontant] = useState("");
  const [concurrent, setConcurrent] = useState("");
  const [lecon, setLecon] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

  React.useEffect(() => { setMontant(""); setConcurrent(""); setLecon(""); }, [outcome]);
  if (!outcome) return null;
  const win = outcome.result === "win";

  async function save() {
    setSaving(true);
    try {
      const amt = Number(String(montant).replace(/[^\d.-]/g, ""));
      await createWinLossEntry({
        competitor: concurrent.trim() || "—",
        result: outcome!.result,
        amount: Number.isFinite(amt) && amt > 0 ? Math.round(amt) : undefined,
        lesson: lecon.trim() || undefined,
        date: new Date().toISOString().slice(0, 10),
      });
      toast.success(win ? "Affaire gagnée enregistrée." : "Affaire perdue enregistrée.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={win ? "Affaire gagnée — enregistrer le résultat" : "Affaire perdue — enregistrer le résultat"}>
      <div style={{ fontSize: 12.5, color: T.dim, marginBottom: 12, lineHeight: 1.5 }}>
        « {outcome.title} » — le résultat alimente le <b style={{ color: T.ink }}>taux de victoire réel</b> et la mesure du CA.
        Passez si ce n'est pas une affaire commerciale.
      </div>
      <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Montant (XOF)</label>
          <Input value={montant} onChange={setMontant} placeholder="ex: 45000000" />
        </div>
        <div>
          <label style={labelStyle}>Concurrent {win ? "battu" : "gagnant"} (optionnel)</label>
          <Input value={concurrent} onChange={setConcurrent} placeholder="ex: Concurrent X" />
        </div>
        <div>
          <label style={labelStyle}>Leçon / raison (optionnel)</label>
          <Input value={lecon} onChange={setLecon} placeholder={win ? "ce qui a fait la différence" : "ce qui a manqué"} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="pill" onClick={onClose}>Passer</button>
        <button type="button" className="pill on" onClick={save} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer le résultat"}
        </button>
      </div>
    </Modal>
  );
}

/** "Plan d'action" — ported from `PlanAction` in the maquette; data source swapped to Firestore
 * `actions` (V6). */
export function PlanAction() {
  const { actions, loading } = useActions();
  const isExec = useIsExec();
  const { user, role } = useAuthClaims();
  // Adoption (audit doubler-CA) : la création d'action n'est plus réservée aux exec — un commercial
  // doit pouvoir enregistrer ce qu'il a à faire (miroir de la règle Firestore `commercial()`).
  const canContribute = isExec || role === "commercial" || role === "commercial_dir";
  const myUid = user?.uid ?? "";
  const defaultOwner = user?.displayName || user?.email || "";
  const [showForm, setShowForm] = useState(false);
  // Capture du résultat commercial quand une action se conclut (levier VICTOIRE + attribution) :
  // « Gagné » → win, « Abandonné » → loss. On capture les DEUX côtés, sinon le taux de victoire
  // (consommé par le Copilote) serait biaisé à 100 %. Optionnel (une action peut être non-commerciale).
  const [outcomeFor, setOutcomeFor] = useState<{ title: string; result: "win" | "loss" } | null>(null);
  const onStatut = (a: { id: string; t: string }, v: string) => {
    void updateAction(a.id, { statut: v as ActionStatus });
    if (v === "Gagné") setOutcomeFor({ title: a.t, result: "win" });
    else if (v === "Abandonné") setOutcomeFor({ title: a.t, result: "loss" });
  };

  // Jitter DÉTERMINISTE seedé sur l'id (passe finale 2026-07) : impact/urgence sont des entiers 1-5,
  // donc plusieurs actions se superposaient EXACTEMENT sur la matrice (illisible dès 2 actions au même
  // couple). On décale chaque bulle de ±0.12 de façon stable (pas de Math.random qui bougerait à
  // chaque rendu), sans changer les axes entiers.
  const jitter = (seed: string, spread = 0.12): number => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return ((h % 1000) / 1000 - 0.5) * 2 * spread;
  };
  const acts = actions
    .map((a) => ({
      ...a,
      imp: a.impact,
      urg: a.urgence,
      impJ: a.impact + jitter(a.id + "i"),
      urgJ: a.urgence + jitter(a.id + "u"),
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
        {canContribute && (
          <button className="pill on" onClick={() => setShowForm((v) => !v)}>
            + Nouvelle action
          </button>
        )}
      </div>
      {canContribute && <NewActionPanel open={showForm} onClose={() => setShowForm(false)} defaultOwner={defaultOwner} />}
      <OutcomeCaptureModal outcome={outcomeFor} onClose={() => setOutcomeFor(null)} />
      {loading && actions.length === 0 && <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>Chargement du plan d'action…</div>}
      {!loading && actions.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>
          Aucune action enregistrée pour l'instant. {canContribute ? "Utilisez « + Nouvelle action » pour en créer une." : ""}
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
                  <XAxis type="number" dataKey="urgJ" name="Urgence" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: T.dim, fontSize: 10 }} label={{ value: "Urgence →", position: "insideBottom", offset: -8, fill: T.dim, fontSize: 11 }} />
                  <YAxis type="number" dataKey="impJ" name="Impact" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: T.dim, fontSize: 10 }} label={{ value: "Impact →", angle: -90, position: "insideLeft", fill: T.dim, fontSize: 11 }} />
                  <ZAxis type="number" dataKey="ev" range={[120, 1000]} />
                  <ReferenceLine x={3.5} stroke={T.faint} />
                  <ReferenceLine y={3.5} stroke={T.faint} />
                  <Tooltip content={<Tip />} cursor={{ stroke: T.faint }} />
                  {/* Clic sur une bulle → défile vers la ligne de l'action dans le tableau ci-dessous. */}
                  <Scatter data={acts.map((a) => ({ ...a, n: a.t }))} cursor="pointer"
                    onClick={(p: { id?: string }) => { const el = p && p.id ? document.getElementById(`act-row-${p.id}`) : null; el?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                    {acts.map((a, i) => (
                      <Cell key={i} fill={a.q.c} fillOpacity={0.75} stroke={a.q.c} strokeWidth={1} />
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
              <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 12.5 }}>
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
                    <tr key={a.id} id={`act-row-${a.id}`} style={{ borderTop: `1px solid ${T.line}` }}>
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
                      <td style={{ padding: "8px", color: T.dim }}>{fmtEcheance(a.ech)}</td>
                      <td style={{ padding: "8px" }}>
                        {isExec || a.createdBy === myUid ? (
                          <Select
                            value={a.st}
                            onChange={(v) => onStatut(a, v)}
                            ariaLabel={`Statut de ${a.t}`}
                            options={ACTION_STATUSES.map((s) => ({ value: s, label: s }))}
                          />
                        ) : (
                          <Badge c={a.st === "En cours" ? T.emerald : a.st === "À surveiller" ? T.faint : T.gold}>{a.st}</Badge>
                        )}
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
