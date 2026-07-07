import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePaged, Pager } from "../components/Pager";
import { Select, DateField, Input, Textarea } from "../../../design/fields";
import { Modal, useToast } from "../../../design/overlay";
import { T, AX, IMP, STANCE, PROX } from "../../../design/tokens";
import { Card, Badge } from "../../../design/ui";
import { useCan } from "../../../lib/rbac";
import { BUSINESS_SUBTYPES, DETECTION_SUBTYPE_LABELS, PUBLISHED_STATUSES, createIntelItem, updateIntelItem, useIntelItems, type IntelAxis, type IntelImpact, type IntelStance, type IntelItem, type IntelStatus } from "../lib/intel";
import { createAction } from "../lib/execution";
import { effectiveProx, isPastDue } from "../lib/freshness";
import { useIsExec } from "../../../lib/rbac";

const AXIS_KEYS = Object.keys(AX) as IntelAxis[];

interface NewItemForm {
  title: string;
  summary: string;
  url: string;
  axis: IntelAxis;
  impact: IntelImpact;
  stance: IntelStance;
  ent: string;
  geo: string;
  sourceRating: string;
  date: string;
}

const EMPTY_FORM: NewItemForm = {
  title: "",
  summary: "",
  url: "",
  axis: AXIS_KEYS[0],
  impact: "medium",
  stance: "neutral",
  ent: "",
  geo: "",
  sourceRating: "B2",
  date: new Date().toISOString().slice(0, 10),
};

/** "Nouvelle fiche de veille" — contribution panel (BUILD_KIT.md §11 "Fil de veille" → create/update items). */
function NewItemPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<NewItemForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const set = <K extends keyof NewItemForm>(k: K, v: NewItemForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setErr("Le titre est requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createIntelItem({
        title: form.title.trim(),
        summary: form.summary.trim(),
        url: form.url.trim() || undefined,
        axis: form.axis,
        impact: form.impact,
        stance: form.stance,
        ent: form.ent.trim() || undefined,
        geo: form.geo.trim() || undefined,
        sourceRating: form.sourceRating.trim() || "C3",
        date: form.date,
      });
      setForm(EMPTY_FORM);
      toast.success("Fiche de veille enregistrée.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle fiche de veille">
      <form onSubmit={submit}>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Titre *</label>
            <Input value={form.title} onChange={(v) => set("title", v)} required />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Résumé</label>
            <Textarea value={form.summary} onChange={(v) => set("summary", v)} />
          </div>
          <div>
            <label style={labelStyle}>URL / source</label>
            <Input value={form.url} onChange={(v) => set("url", v)} placeholder="https://…" />
          </div>
          <div>
            <label style={labelStyle}>Cotation source (A1..F5)</label>
            <Input value={form.sourceRating} onChange={(v) => set("sourceRating", v)} placeholder="ex: B2" />
          </div>
          <div>
            <label style={labelStyle}>Axe</label>
            <Select value={form.axis} onChange={(v) => set("axis", v as IntelAxis)} ariaLabel="Axe" options={AXIS_KEYS.map((k) => ({ value: k, label: AX[k].l }))} />
          </div>
          <div>
            <label style={labelStyle}>Impact</label>
            <Select value={form.impact} onChange={(v) => set("impact", v as IntelImpact)} ariaLabel="Impact" options={Object.keys(IMP).map((k) => ({ value: k, label: IMP[k].l }))} />
          </div>
          <div>
            <label style={labelStyle}>Posture</label>
            <Select value={form.stance} onChange={(v) => set("stance", v as IntelStance)} ariaLabel="Posture" options={Object.keys(STANCE).map((k) => ({ value: k, label: STANCE[k].l }))} />
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <DateField value={form.date} onChange={(v) => set("date", v)} ariaLabel="Date" />
          </div>
          <div>
            <label style={labelStyle}>Entité</label>
            <Input value={form.ent} onChange={(v) => set("ent", v)} placeholder="ex: Cisco" />
          </div>
          <div>
            <label style={labelStyle}>Géographie</label>
            <Input value={form.geo} onChange={(v) => set("geo", v)} placeholder="ex: Côte d'Ivoire" />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer la fiche"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Fil de veille" — ported from `Fil` in the maquette; data source swapped to Firestore `intelItems` (V2). */
export function Fil() {
  // Maillage inter-vues (Vague C + interactivité 2026-07) : un CTA d'une autre vue (Détection, matrice
  // du radar, graphiques Concurrence…) ouvre le Fil pré-filtré via ?ent= / ?ax= / ?st= / ?imp=.
  const [sp, setSp] = useSearchParams();
  const entFilter = sp.get("ent") || "";
  // Filtres initialisés depuis l'URL (deep-link) puis pilotés localement par les pills.
  const [ax, setAx] = useState(() => (sp.get("ax") && AX[sp.get("ax") as string] ? (sp.get("ax") as string) : "all"));
  const [st, setSt] = useState(() => (["opportunity", "threat", "neutral"].includes(sp.get("st") || "") ? (sp.get("st") as string) : "all"));
  const [imp, setImp] = useState(() => (["high", "medium", "low"].includes(sp.get("imp") || "") ? (sp.get("imp") as string) : "all"));
  const [prx, setPrx] = useState("all");
  const [watchOnly, setWatchOnly] = useState(false);
  const [bizOnly, setBizOnly] = useState(false);
  // Vue par statut : « publiés » par défaut (porte de qualité) ; les exec peuvent inspecter les signaux
  // « en attente » d'évaluation, ceux « rejetés » (corbeille restaurable) et les « archivés ».
  const [statusView, setStatusView] = useState<"published" | "pending" | "rejected" | "archived">("published");
  const [showForm, setShowForm] = useState(false);
  const clearEnt = () => { const n = new URLSearchParams(sp); n.delete("ent"); setSp(n, { replace: true }); };
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const { items, loading } = useIntelItems();
  const { canWrite } = useCan("veille");
  const isExec = useIsExec();

  const rows = items
    .filter(
      (s) =>
        (ax === "all" || s.axis === ax) &&
        (st === "all" || s.stance === st) &&
        (imp === "all" || s.impact === imp) &&
        (prx === "all" || effectiveProx(s) === prx) &&
        (!watchOnly || !!s.ent) &&
        (!entFilter || (s.ent ? norm(s.ent).includes(norm(entFilter)) || norm(entFilter).includes(norm(s.ent)) : false)) &&
        (!bizOnly || BUSINESS_SUBTYPES.has(s.subtype ?? "")) &&
        // Porte de qualité : par défaut on ne montre que les signaux PUBLIÉS. Les vues attente/rejetés/
        // archivés (exec) isolent respectivement pending / rejected / archived.
        (statusView === "published" ? PUBLISHED_STATUSES.has(s.status) : s.status === statusView)
    )
    // Tri stable : score de priorité desc, puis échéance la plus proche (items sans dueDate en
    // dernier), puis date de signal desc.
    .sort(
      (a, b) =>
        (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        (b.date ?? "").localeCompare(a.date ?? "")
    );

  // Pagination : le fil peut atteindre des centaines de signaux (retour à la page 1 si un filtre change).
  const paged = usePaged(rows, 25, `${ax}|${st}|${imp}|${prx}|${watchOnly}|${bizOnly}|${statusView}|${entFilter}`);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: T.faint }}>Axe :</span>
          <button className={`pill ${ax === "all" ? "on" : ""}`} onClick={() => setAx("all")}>
            Tous
          </button>
          {Object.keys(AX).map((k) => (
            <button key={k} className={`pill ${ax === k ? "on" : ""}`} onClick={() => setAx(k)}>
              {AX[k].l}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 10 }}>Posture :</span>
          {["all", "opportunity", "threat", "neutral"].map((k) => (
            <button key={k} className={`pill ${st === k ? "on" : ""}`} onClick={() => setSt(k)}>
              {k === "all" ? "Toutes" : STANCE[k].l}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 10 }}>Impact :</span>
          {["all", "high", "medium", "low"].map((k) => (
            <button key={k} className={`pill ${imp === k ? "on" : ""}`} onClick={() => setImp((v) => (v === k ? "all" : k))}>
              {k === "all" ? "Tous" : IMP[k]?.l ?? k}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 10 }}>Imminence :</span>
          {["all", "imminent", "court"].map((k) => (
            <button key={k} className={`pill ${prx === k ? "on" : ""}`} onClick={() => setPrx((v) => (v === k ? "all" : k))}>
              {k === "all" ? "Toutes" : PROX[k]?.l ?? k}
            </button>
          ))}
          <button className={`pill ${watchOnly ? "on" : ""}`} onClick={() => setWatchOnly((v) => !v)} style={{ marginLeft: 10 }}>
            Watchlist
          </button>
          <button className={`pill ${bizOnly ? "on" : ""}`} onClick={() => setBizOnly((v) => !v)}>
            💼 Business
          </button>
          {isExec && (
            <>
              <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 10 }}>Vue :</span>
              {([
                ["published", "Publiés"],
                ["pending", "En attente"],
                ["rejected", "Rejetés"],
                ["archived", "Archivés"],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  className={`pill ${statusView === k ? "on" : ""}`}
                  onClick={() => setStatusView(k)}
                  title={
                    k === "pending"
                      ? "Signaux en attente d'évaluation par l'agent de pertinence"
                      : k === "rejected"
                        ? "Signaux écartés par l'agent (corbeille restaurable)"
                        : k === "archived"
                          ? "Signaux archivés (doublons, traités)"
                          : "Signaux publiés dans le fil"
                  }
                >
                  {l}
                </button>
              ))}
            </>
          )}
          {entFilter && (
            <button className="pill on" onClick={clearEnt} title="Retirer le filtre entité" style={{ marginLeft: 10 }}>
              Entité : {entFilter} ✕
            </button>
          )}
        </div>
        {canWrite && (
          <button className="pill on" onClick={() => setShowForm((v) => !v)}>
            + Nouvelle fiche
          </button>
        )}
      </div>

      {canWrite && <NewItemPanel open={showForm} onClose={() => setShowForm(false)} />}

      {loading && items.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>Chargement du fil de veille…</div>
      )}
      {!loading && rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>
          Aucune fiche de veille pour ces filtres. {canWrite ? "Utilisez « + Nouvelle fiche » pour en saisir une." : ""}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {paged.pageItems.map((s) => (
          <Card key={s.id} style={{ borderLeft: `3px solid ${STANCE[s.stance].c}` }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ textAlign: "center", minWidth: 44 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, color: STANCE[s.stance].c, lineHeight: 1 }}>
                  {s.priorityScore ?? "—"}
                </div>
                <div style={{ fontSize: 9.5, color: T.faint, marginTop: 2 }}>priorité</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>{s.title}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {/* Anti-obsolescence : un item périmé n'affiche jamais « 🔥 Imminent » ; il porte
                      un badge « Échéance passée » et son imminence effective retombe à horizon. */}
                  {isPastDue(s) ? (
                    <Badge c={T.faint}>Échéance passée</Badge>
                  ) : effectiveProx(s) === "imminent" ? (
                    <Badge c={T.clay}>🔥 Imminent</Badge>
                  ) : (
                    effectiveProx(s) && <Badge c={T.faint}>{PROX[effectiveProx(s) as string]?.l ?? s.prox}</Badge>
                  )}
                  <Badge c={AX[s.axis]?.c}>{AX[s.axis]?.l ?? s.axis}</Badge>
                  {s.subtype && <Badge c={T.plum}>{DETECTION_SUBTYPE_LABELS[s.subtype] ?? s.subtype}</Badge>}
                  <Badge c={IMP[s.impact]?.c}>Impact {IMP[s.impact]?.l ?? s.impact}</Badge>
                  <Badge c={STANCE[s.stance]?.c}>{STANCE[s.stance]?.l ?? s.stance}</Badge>
                  {s.neuf && <Badge c={T.steel}>Signal faible</Badge>}
                  <Badge c={T.faint}>
                    {s.ent || "—"} · {s.geo || "—"}
                  </Badge>
                  <Badge c={T.steel}>Source {s.sourceRating}</Badge>
                  <Badge c={T.faint}>{s.date}</Badge>
                </div>
                {s.soWhat && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim }}>
                    <b style={{ color: T.plum }}>So-what :</b> {s.soWhat}
                  </div>
                )}
                {s.recommendedAction && (
                  <div style={{ marginTop: 4, fontSize: 12.5, color: T.dim }}>
                    <b style={{ color: T.gold }}>Action :</b> {s.recommendedAction}
                  </div>
                )}
                {s.summary && !s.soWhat && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim }}>{s.summary}</div>
                )}
                {/* Verdict de l'agent de pertinence — surtout utile en vue « en attente » / « rejetés ». */}
                {(s.status === "pending" || s.status === "rejected" || s.evalReason) && s.evalReason && (
                  <div style={{ marginTop: 6, fontSize: 12, color: s.status === "rejected" ? T.clay : T.faint }}>
                    <b>Évaluation{typeof s.evalScore === "number" ? ` (${s.evalScore}/100)` : ""} :</b> {s.evalReason}
                  </div>
                )}
                <SignalLifecycle s={s} />
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Pager {...paged} />
    </div>
  );
}

const STATUS_META: Record<IntelStatus, { l: string; c: string }> = {
  pending: { l: "En attente", c: T.steel },
  new: { l: "Nouveau", c: T.gold },
  reviewed: { l: "Revu", c: T.steel },
  actioned: { l: "Traité", c: T.emerald },
  archived: { l: "Archivé", c: T.faint },
  rejected: { l: "Rejeté", c: T.clay },
};
const STATUS_FLOW: IntelStatus[] = ["new", "reviewed", "actioned", "archived"];

/**
 * Cycle de vie d'un signal (M13 audit) : la veille n'était que contemplative — un signal restait
 * « new » à vie et `menacesTraitees` restait donc à 0. Ici l'exécutif fait avancer le statut,
 * affecte un porteur et crée une ACTION LIÉE (linkedItemId = id du signal) directement depuis le fil.
 */
function SignalLifecycle({ s }: { s: IntelItem }) {
  const isExec = useIsExec();
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(s.owner ?? "");
  const [open, setOpen] = useState(false);
  if (!isExec) {
    return (
      <div style={{ marginTop: 8 }}>
        <Badge c={STATUS_META[s.status]?.c ?? T.faint}>{STATUS_META[s.status]?.l ?? s.status}</Badge>
        {s.owner && <Badge c={T.emerald}>Porteur : {s.owner}</Badge>}
      </div>
    );
  }
  const setStatus = async (status: IntelStatus) => {
    setBusy(true);
    try { await updateIntelItem(s.id, { status }); } finally { setBusy(false); }
  };
  const createLinkedAction = async () => {
    setBusy(true);
    try {
      await createAction({
        title: s.recommendedAction?.trim() || s.title,
        impact: s.impact === "high" ? 5 : s.impact === "medium" ? 4 : 3,
        urgence: isPastDue(s) ? 2 : effectiveProx(s) === "imminent" ? 5 : effectiveProx(s) === "court" ? 4 : 3,
        effort: 3,
        ev: 0,
        owner: owner.trim() || "—",
        echeance: s.dueDate || "",
        statut: "À planifier",
        source: `Signal : ${s.title}`,
        linkedItemId: s.id,
      });
      await updateIntelItem(s.id, { status: "actioned", owner: owner.trim() || s.owner });
      setOpen(false);
    } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${T.line}`, paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: T.faint }}>Statut :</span>
      {STATUS_FLOW.map((st) => (
        <button key={st} className={`pill ${s.status === st ? "on" : ""}`} disabled={busy} onClick={() => setStatus(st)} style={{ fontSize: 11, padding: "3px 8px" }}>
          {STATUS_META[st].l}
        </button>
      ))}
      {s.owner && <Badge c={T.emerald}>Porteur : {s.owner}</Badge>}
      <button className="pill" disabled={busy} onClick={() => setOpen((v) => !v)} style={{ fontSize: 11, padding: "3px 8px", marginLeft: 6 }}>
        {open ? "Annuler" : "→ Créer une action"}
      </button>
      {open && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input className="inp" placeholder="Porteur" value={owner} onChange={(e) => setOwner(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", width: 130 }} />
          <button className="pill on" disabled={busy} onClick={createLinkedAction} style={{ fontSize: 11, padding: "3px 8px" }}>
            Créer &amp; marquer traité
          </button>
        </span>
      )}
    </div>
  );
}
