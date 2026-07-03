import React, { useState } from "react";
import { T, AX, IMP, STANCE, PROX } from "../../../design/tokens";
import { Card, Badge } from "../../../design/ui";
import { useCan } from "../../../lib/rbac";
import { DETECTION_SUBTYPE_LABELS, createIntelItem, useIntelItems, type IntelAxis, type IntelImpact, type IntelStance } from "../lib/intel";

const AXIS_KEYS = Object.keys(AX) as IntelAxis[];

/** Subtypes à contenu business direct (AO, fins de vie, réglementation, financements) — plan d'audit §5.3. */
const BUSINESS_SUBTYPES = new Set(["tender", "eol", "regulation", "funding"]);

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
function NewItemPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<NewItemForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>Nouvelle fiche de veille</span>
          <button type="button" className="pill" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Titre *</label>
            <input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} required />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Résumé</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>URL / source</label>
            <input style={inputStyle} value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label style={labelStyle}>Cotation source (A1..F5)</label>
            <input style={inputStyle} value={form.sourceRating} onChange={(e) => set("sourceRating", e.target.value)} placeholder="ex: B2" />
          </div>
          <div>
            <label style={labelStyle}>Axe</label>
            <select style={inputStyle} value={form.axis} onChange={(e) => set("axis", e.target.value as IntelAxis)}>
              {AXIS_KEYS.map((k) => (
                <option key={k} value={k}>
                  {AX[k].l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Impact</label>
            <select style={inputStyle} value={form.impact} onChange={(e) => set("impact", e.target.value as IntelImpact)}>
              {Object.keys(IMP).map((k) => (
                <option key={k} value={k}>
                  {IMP[k].l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Posture</label>
            <select style={inputStyle} value={form.stance} onChange={(e) => set("stance", e.target.value as IntelStance)}>
              {Object.keys(STANCE).map((k) => (
                <option key={k} value={k}>
                  {STANCE[k].l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" style={inputStyle} value={form.date} onChange={(e) => set("date", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Entité</label>
            <input style={inputStyle} value={form.ent} onChange={(e) => set("ent", e.target.value)} placeholder="ex: Cisco" />
          </div>
          <div>
            <label style={labelStyle}>Géographie</label>
            <input style={inputStyle} value={form.geo} onChange={(e) => set("geo", e.target.value)} placeholder="ex: Côte d'Ivoire" />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <button type="submit" className="pill on" disabled={submitting}>
          {submitting ? "Enregistrement…" : "Enregistrer la fiche"}
        </button>
      </form>
    </Card>
  );
}

/** "Fil de veille" — ported from `Fil` in the maquette; data source swapped to Firestore `intelItems` (V2). */
export function Fil() {
  const [ax, setAx] = useState("all");
  const [st, setSt] = useState("all");
  const [prx, setPrx] = useState("all");
  const [watchOnly, setWatchOnly] = useState(false);
  const [bizOnly, setBizOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const { items, loading } = useIntelItems();
  const { canWrite } = useCan("veille");

  const rows = items
    .filter(
      (s) =>
        (ax === "all" || s.axis === ax) &&
        (st === "all" || s.stance === st) &&
        (prx === "all" || s.prox === prx) &&
        (!watchOnly || !!s.ent) &&
        (!bizOnly || BUSINESS_SUBTYPES.has(s.subtype ?? ""))
    )
    // Tri stable : score de priorité desc, puis échéance la plus proche (items sans dueDate en
    // dernier), puis date de signal desc.
    .sort(
      (a, b) =>
        (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        (b.date ?? "").localeCompare(a.date ?? "")
    );

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
        </div>
        {canWrite && (
          <button className="pill on" onClick={() => setShowForm((v) => !v)}>
            + Nouvelle fiche
          </button>
        )}
      </div>

      {showForm && canWrite && <NewItemPanel onClose={() => setShowForm(false)} />}

      {loading && items.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>Chargement du fil de veille…</div>
      )}
      {!loading && rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>
          Aucune fiche de veille pour ces filtres. {canWrite ? "Utilisez « + Nouvelle fiche » pour en saisir une." : ""}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((s) => (
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
                  {s.prox === "imminent" ? (
                    <Badge c={T.clay}>🔥 Imminent</Badge>
                  ) : (
                    s.prox && <Badge c={T.faint}>{PROX[s.prox]?.l ?? s.prox}</Badge>
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
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
