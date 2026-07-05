import React, { useState } from "react";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useIsExec } from "../../../lib/rbac";
import {
  createDecision,
  createInitiative,
  useDecisions,
  useInitiatives,
  useStrategicThemes,
  type DecisionStatus,
  type InitiativeHorizon,
  type InitiativeStatus,
} from "../lib/execution";
import { usePaged, Pager } from "../components/Pager";
import { Select, DateField, Input } from "../../../design/fields";
import { Modal, useToast } from "../../../design/overlay";

interface NewInitiativeForm {
  title: string;
  themeId: string;
  objective: string;
  keyResults: string;
  owner: string;
  status: InitiativeStatus;
  horizon: InitiativeHorizon;
  dueDate: string;
  progress: number; // 0-100 in the form, converted to 0-1 on submit
}

const EMPTY_FORM: NewInitiativeForm = {
  title: "",
  themeId: "",
  objective: "",
  keyResults: "",
  owner: "",
  status: "en cours",
  horizon: "H1",
  dueDate: "",
  progress: 0,
};

/** "Nouvelle initiative" — contribution panel, exec-gated (BUILD_KIT.md §7 "cadres/scénarios/
 * décisions/OKR → exécutifs"), same layout convention as Fil.tsx's `NewItemPanel` (V2). */
function NewInitiativePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<NewInitiativeForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { themes } = useStrategicThemes();
  const toast = useToast();

  const set = <K extends keyof NewInitiativeForm>(k: K, v: NewInitiativeForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.objective.trim()) {
      setErr("Le titre et l'objectif sont requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createInitiative({
        title: form.title.trim(),
        themeId: form.themeId || undefined,
        objective: form.objective.trim(),
        keyResults: form.keyResults.split(",").map((s) => s.trim()).filter(Boolean),
        owner: form.owner.trim(),
        status: form.status,
        horizon: form.horizon,
        dueDate: form.dueDate || undefined,
        progress: form.progress / 100,
        linkedItems: [],
      });
      setForm(EMPTY_FORM);
      toast.success("Initiative enregistrée.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle initiative">
      <form onSubmit={submit}>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Titre *</label>
            <Input value={form.title} onChange={(v) => set("title", v)} required />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Objectif *</label>
            <Input value={form.objective} onChange={(v) => set("objective", v)} required />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Résultats clés (séparés par des virgules)</label>
            <Input value={form.keyResults} onChange={(v) => set("keyResults", v)} placeholder="ex: 20 contrats managés, +5 pts win rate" />
          </div>
          <div>
            <label style={labelStyle}>Pilier / thème</label>
            <Select value={form.themeId} onChange={(v) => set("themeId", v)} ariaLabel="Pilier / thème" placeholder="—"
              options={[{ value: "", label: "—" }, ...themes.map((t) => ({ value: t.id, label: t.title }))]} />
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
          <div>
            <label style={labelStyle}>Statut</label>
            <Select value={form.status} onChange={(v) => set("status", v)} ariaLabel="Statut"
              options={[{ value: "à lancer", label: "À lancer" }, { value: "en cours", label: "En cours" }, { value: "terminée", label: "Terminée" }, { value: "en retard", label: "En retard" }]} />
          </div>
          <div>
            <label style={labelStyle}>Échéance</label>
            <DateField value={form.dueDate} onChange={(v) => set("dueDate", v)} ariaLabel="Échéance" />
          </div>
          <div>
            <label style={labelStyle}>Avancement ({form.progress}%)</label>
            <input type="range" min={0} max={100} step={5} value={form.progress} onChange={(e) => set("progress", Number(e.target.value))} style={{ width: "100%", accentColor: T.gold }} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer l'initiative"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface NewDecisionForm {
  title: string;
  decidedBy: string;
  date: string;
  statut: DecisionStatus;
  chosen: string;
  linkedItems: string;
}

const EMPTY_DECISION_FORM: NewDecisionForm = {
  title: "",
  decidedBy: "",
  date: new Date().toISOString().slice(0, 10),
  statut: "En attente",
  chosen: "",
  linkedItems: "",
};

/** "Nouvelle décision" — exec-gated contribution panel for the decision registry, same layout
 * convention as `NewInitiativePanel` above. */
function NewDecisionPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<NewDecisionForm>(EMPTY_DECISION_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const set = <K extends keyof NewDecisionForm>(k: K, v: NewDecisionForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.decidedBy.trim() || !form.date) {
      setErr("Le titre, l'instance et la date sont requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createDecision({
        title: form.title.trim(),
        options: [],
        chosen: form.chosen.trim(),
        decidedBy: form.decidedBy.trim(),
        date: form.date,
        linkedItems: form.linkedItems.split(",").map((s) => s.trim()).filter(Boolean),
        statut: form.statut,
      });
      setForm(EMPTY_DECISION_FORM);
      toast.success("Décision enregistrée.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle décision">
      <form onSubmit={submit}>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Décision *</label>
            <Input value={form.title} onChange={(v) => set("title", v)} required />
          </div>
          <div>
            <label style={labelStyle}>Instance (CODIR, DG…) *</label>
            <Input value={form.decidedBy} onChange={(v) => set("decidedBy", v)} required />
          </div>
          <div>
            <label style={labelStyle}>Date *</label>
            <DateField value={form.date} onChange={(v) => set("date", v)} ariaLabel="Date" required />
          </div>
          <div>
            <label style={labelStyle}>Statut</label>
            <Select value={form.statut} onChange={(v) => set("statut", v)} ariaLabel="Statut"
              options={[{ value: "En attente", label: "En attente" }, { value: "En cours", label: "En cours" }, { value: "Actée", label: "Actée" }]} />
          </div>
          <div>
            <label style={labelStyle}>Option retenue</label>
            <Input value={form.chosen} onChange={(v) => set("chosen", v)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Signaux liés (séparés par des virgules, optionnel)</label>
            <Input value={form.linkedItems} onChange={(v) => set("linkedItems", v)} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer la décision"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Exécution & Décisions" — Firestore `initiatives`/`decisions`, with exec-gated create forms
 * for both. */
export function Execution() {
  const { initiatives, loading: loadingInit } = useInitiatives();
  const { decisions, loading: loadingDec } = useDecisions();
  const { themes } = useStrategicThemes();
  const isExec = useIsExec();
  const [showForm, setShowForm] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const initPaged = usePaged(initiatives, 8);

  const themeTitle = (id?: string) => themes.find((t) => t.id === id)?.title;

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Eyebrow color={T.emerald}>Initiatives stratégiques & OKR</Eyebrow>
          {isExec && (
            <button className="pill on" onClick={() => setShowForm((v) => !v)}>
              + Nouvelle initiative
            </button>
          )}
        </div>
        {isExec && <NewInitiativePanel open={showForm} onClose={() => setShowForm(false)} />}
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {loadingInit && initiatives.length === 0 && <div style={{ fontSize: 12.5, color: T.faint }}>Chargement des initiatives…</div>}
          {!loadingInit && initiatives.length === 0 && (
            <div style={{ fontSize: 12.5, color: T.faint }}>
              Aucune initiative saisie pour l'instant. {isExec ? "Utilisez « + Nouvelle initiative » pour en créer une." : ""}
            </div>
          )}
          {initPaged.pageItems.map((it) => (
            <div key={it.id}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, flexWrap: "wrap", gap: 6 }}>
                <span style={{ color: T.ink, fontWeight: 600 }}>
                  {it.title} <Badge c={T.plum}>{themeTitle(it.themeId) ?? "—"}</Badge> <Badge c={T.faint}>{it.horizon}</Badge>
                </span>
                <span style={{ color: T.dim, fontSize: 11.5 }}>
                  {it.owner} · {pct(it.progress)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: T.dim, marginBottom: 4 }}>OKR : {it.objective}</div>
              <div style={{ height: 8, background: T.panel2, borderRadius: 4 }}>
                <div style={{ width: `${it.progress * 100}%`, height: "100%", background: it.progress >= 0.5 ? T.emerald : T.gold, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
        <Pager {...initPaged} />
      </Card>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Eyebrow color={T.steel}>Registre de décisions stratégiques</Eyebrow>
          {isExec && (
            <button className="pill on" onClick={() => setShowDecisionForm((v) => !v)}>
              + Nouvelle décision
            </button>
          )}
        </div>
        {isExec && <NewDecisionPanel open={showDecisionForm} onClose={() => setShowDecisionForm(false)} />}
        <div className="tbl-scroll" style={{ marginTop: 12 }}>
          {loadingDec && decisions.length === 0 && <div style={{ fontSize: 12.5, color: T.faint }}>Chargement du registre…</div>}
          {!loadingDec && decisions.length === 0 && <div style={{ fontSize: 12.5, color: T.faint }}>Aucune décision enregistrée pour l'instant.</div>}
          {decisions.length > 0 && (
            <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: T.faint, fontSize: 11, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Décision</th>
                  <th style={{ padding: "6px 8px" }}>Instance</th>
                  <th style={{ padding: "6px 8px" }}>Signaux liés</th>
                  <th style={{ padding: "6px 8px" }}>Date</th>
                  <th style={{ padding: "6px 8px" }}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.id} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td style={{ padding: "7px 8px", color: T.ink }}>{d.title}</td>
                    <td style={{ padding: "7px 8px", color: T.dim }}>{d.decidedBy}</td>
                    <td style={{ padding: "7px 8px", color: T.faint }}>{d.linkedItems.join(", ") || "—"}</td>
                    <td style={{ padding: "7px 8px", color: T.faint }}>{d.date}</td>
                    <td style={{ padding: "7px 8px" }}>
                      <Badge c={d.statut === "Actée" ? T.emerald : d.statut === "En cours" ? T.gold : T.clay}>{d.statut}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
