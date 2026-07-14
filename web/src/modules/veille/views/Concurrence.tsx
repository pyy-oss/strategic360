import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge, Tip } from "../../../design/ui";
import { Select, DateField, Input, Textarea } from "../../../design/fields";
import { Modal, useToast } from "../../../design/overlay";
import { useCan } from "../../../lib/rbac";
import { createWinLossEntry, upsertBattlecard, useBattlecards, useWinLoss, winRateByCompetitor, type WinLossResult } from "../lib/execution";

const labelStyle: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };

const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** "Nouvelle battlecard" — contribution commerciale (server-side gate: canWrite('veille')). */
function NewBattlecardPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ competitor: "", positioning: "", strengths: "", weaknesses: "", ourWinThemes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.competitor.trim()) {
      setErr("Le nom du concurrent est requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      // On N'ÉCRASE PLUS theirLikelyMoves / objectionHandling / recentMoves (souvent générés par l'IA
      // et clés en RFP) : on les omet → merge:true préserve les valeurs existantes (audit 2026-07).
      await upsertBattlecard({
        competitor: form.competitor.trim(),
        positioning: form.positioning.trim() || undefined,
        strengths: splitLines(form.strengths),
        weaknesses: splitLines(form.weaknesses),
        ourWinThemes: splitLines(form.ourWinThemes),
      });
      toast.success("Battlecard enregistrée.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle battlecard">
      <form onSubmit={submit}>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Concurrent *</label>
            <Input value={form.competitor} onChange={(v) => set("competitor", v)} required />
          </div>
          <div>
            <label style={labelStyle}>Positionnement</label>
            <Input value={form.positioning} onChange={(v) => set("positioning", v)} />
          </div>
          <div>
            <label style={labelStyle}>Forces (une par ligne)</label>
            <Textarea value={form.strengths} onChange={(v) => set("strengths", v)} />
          </div>
          <div>
            <label style={labelStyle}>Faiblesses (une par ligne)</label>
            <Textarea value={form.weaknesses} onChange={(v) => set("weaknesses", v)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Comment gagner (un thème par ligne)</label>
            <Textarea value={form.ourWinThemes} onChange={(v) => set("ourWinThemes", v)} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer la battlecard"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Enregistrer un win/loss" — exec-gated (server-side: exec()); alimente le taux de victoire. */
function NewWinLossPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ competitor: "", result: "win" as WinLossResult, reason: "", amount: "", lesson: "", date: new Date().toISOString().slice(0, 10) });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.competitor.trim() || !form.date) {
      setErr("Le concurrent et la date sont requis.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      // Montant chiffré + leçon capitalisée (M14 audit). UNITÉ CANONIQUE = XOF (fix audit 2026-07) :
      // ce formulaire saisit des MILLIONS de FCFA (UX), mais winLoss.amount est stocké en XOF pour rester
      // cohérent avec l'autre point de saisie (fin d'action, PlanAction.tsx, en XOF bruts) — sinon
      // l'agrégat « CA gagné/perdu » mélangeait 45 (M FCFA) et 45 000 000 (XOF), faux d'un facteur 1e6.
      const amountM = form.amount.trim() ? Number(form.amount.replace(",", ".")) : NaN;
      const amountXof = Number.isFinite(amountM) ? Math.round(amountM * 1e6) : undefined;
      await createWinLossEntry({
        competitor: form.competitor.trim(),
        result: form.result,
        reason: form.reason.trim() || undefined,
        amount: amountXof,
        lesson: form.lesson.trim() || undefined,
        date: form.date,
      });
      toast.success("Win/Loss enregistré.");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Enregistrer un win/loss" width={640}>
      <form onSubmit={submit}>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "1fr 110px 1fr 150px", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Concurrent *</label>
            <Input value={form.competitor} onChange={(v) => set("competitor", v)} required />
          </div>
          <div>
            <label style={labelStyle}>Résultat</label>
            <Select value={form.result} onChange={(v) => set("result", v as WinLossResult)} ariaLabel="Résultat"
              options={[{ value: "win", label: "Win" }, { value: "loss", label: "Loss" }]} />
          </div>
          <div>
            <label style={labelStyle}>Raison</label>
            <Input value={form.reason} onChange={(v) => set("reason", v)} />
          </div>
          <div>
            <label style={labelStyle}>Date *</label>
            <DateField value={form.date} onChange={(v) => set("date", v)} ariaLabel="Date" required />
          </div>
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Montant (M FCFA)</label>
            <Input inputMode="decimal" placeholder="ex : 45" value={form.amount} onChange={(v) => set("amount", v)} />
          </div>
          <div>
            <label style={labelStyle}>Leçon capitalisée</label>
            <Input placeholder="Pourquoi gagné/perdu — à réutiliser" value={form.lesson} onChange={(v) => set("lesson", v)} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="pill" onClick={onClose}>Annuler</button>
          <button type="submit" className="pill on" disabled={submitting}>
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * "Concurrence" — Firestore `battlecards` + `winLoss`. Win rate / deal count are computed
 * client-side from `winLoss` entries (`winRateByCompetitor`). Contribution forms: battlecards
 * are open to any veille contributor (canWrite('veille')); win/loss entries are exec-gated,
 * mirroring the Security Rules.
 */
export function Concurrence() {
  const navigate = useNavigate();
  const { battlecards, loading: loadingCards } = useBattlecards();
  const { entries, loading: loadingWl } = useWinLoss();
  const { canWrite } = useCan("veille");
  const [showCardForm, setShowCardForm] = useState(false);
  const [showWlForm, setShowWlForm] = useState(false);
  const stats = winRateByCompetitor(entries);

  const rows = battlecards.map((c) => ({
    ...c,
    win: stats[c.competitor]?.win ?? 0,
    deals: stats[c.competitor]?.deals ?? 0,
  }));

  // Boucle de preuve (M14 audit) : CA gagné/perdu et taux de victoire global depuis winLoss chiffré.
  const wlSummary = entries.reduce(
    (acc, e) => {
      acc.total += 1;
      if (e.result === "win") { acc.wins += 1; if (Number.isFinite(e.amount)) acc.won += Number(e.amount); }
      else if (Number.isFinite(e.amount)) acc.lost += Number(e.amount);
      return acc;
    },
    { total: 0, wins: 0, won: 0, lost: 0 }
  );
  const winRateGlobal = wlSummary.total ? Math.round((wlSummary.wins / wlSummary.total) * 100) : null;

  const loading = loadingCards || loadingWl;

  return (
    <div>
      {wlSummary.total > 0 && (
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
          <Card><div style={{ fontSize: 11, color: T.faint }}>Taux de victoire</div><div style={{ fontSize: 22, fontWeight: 700, color: T.gold }}>{winRateGlobal}%</div></Card>
          <Card><div style={{ fontSize: 11, color: T.faint }}>Deals suivis</div><div style={{ fontSize: 22, fontWeight: 700, color: T.steel }}>{wlSummary.total}</div></Card>
          {/* winLoss.amount est en XOF (unité canonique) → affiché en M FCFA (÷ 1e6) pour la lisibilité. */}
          <Card><div style={{ fontSize: 11, color: T.faint }}>CA gagné (M FCFA)</div><div style={{ fontSize: 22, fontWeight: 700, color: T.emerald }}>{Math.round(wlSummary.won / 1e6)}</div></Card>
          <Card><div style={{ fontSize: 11, color: T.faint }}>CA perdu (M FCFA)</div><div style={{ fontSize: 22, fontWeight: 700, color: T.clay }}>{Math.round(wlSummary.lost / 1e6)}</div></Card>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {canWrite && (
          <button className="pill on" onClick={() => setShowCardForm((v) => !v)}>
            + Nouvelle battlecard
          </button>
        )}
        {canWrite && (
          <button className="pill on" onClick={() => setShowWlForm((v) => !v)}>
            + Enregistrer un win/loss
          </button>
        )}
      </div>
      {canWrite && <NewBattlecardPanel open={showCardForm} onClose={() => setShowCardForm(false)} />}
      {canWrite && <NewWinLossPanel open={showWlForm} onClose={() => setShowWlForm(false)} />}
      {!loading && rows.length === 0 && (
        <Card>
          <Eyebrow color={T.clay}>Concurrence</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
            Aucune battlecard enregistrée pour l'instant. Utilisez « + Nouvelle battlecard » (contribution commerciale) pour en créer une.
          </div>
        </Card>
      )}
      {rows.length > 0 && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <Eyebrow color={T.clay}>Taux de victoire par concurrent (Win/Loss — relié au Pipeline)</Eyebrow>
            {entries.length === 0 ? (
              <div style={{ fontSize: 12.5, color: T.faint, marginTop: 10 }}>
                Aucune entrée win/loss pour l'instant — le taux de victoire se calcule à partir des saisies « + Enregistrer un win/loss ».
              </div>
            ) : (
              <div style={{ height: 200, marginTop: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows.map((c) => ({ n: c.competitor, win: Math.round(c.win * 100), deals: c.deals }))} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid stroke={T.line} vertical={false} />
                    <XAxis dataKey="n" tick={{ fill: T.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => v + "%"} tick={{ fill: T.faint, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: T.panel2 }} content={<Tip />} />
                    <Bar dataKey="win" name="Taux victoire" fill={T.clay} radius={[4, 4, 0, 0]} barSize={46} cursor="pointer"
                      onClick={(d: { n?: string }) => d?.n && navigate(`/veille/fil?ent=${encodeURIComponent(d.n)}`)} />

                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {rows.map((c) => (
              <Card key={c.id} style={{ borderTop: `3px solid ${T.clay}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                  <Eyebrow color={T.clay}>{c.competitor}</Eyebrow>
                  <Badge c={c.win >= 0.5 ? T.emerald : T.clay}>
                    {c.deals > 0 ? `${pct(c.win)} · ${c.deals} deals` : "pas de win/loss"}
                  </Badge>
                </div>
                {c.generatedBy === "ai" && (
                  <div style={{ marginTop: 4 }}>
                    <Badge c={T.gold}>Suggéré par l'IA · à valider</Badge>
                  </div>
                )}
                <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>
                  {c.positioning && (
                    <div style={{ marginBottom: 6, color: T.ink }}>{c.positioning}</div>
                  )}
                  <div>
                    <b style={{ color: T.gold }}>Forces :</b> {(c.strengths ?? []).join("; ") || "—"}
                  </div>
                  <div>
                    <b style={{ color: T.steel }}>Faiblesses :</b> {(c.weaknesses ?? []).join("; ") || "—"}
                  </div>
                  <div style={{ marginTop: 6, padding: "8px 10px", background: T.panel2, borderRadius: 8 }}>
                    <b style={{ color: T.emerald }}>Comment gagner :</b> {(c.ourWinThemes ?? []).join("; ") || "—"}
                  </div>
                  {(c.theirLikelyMoves ?? []).length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <b style={{ color: T.clay }}>Ses coups probables :</b> {(c.theirLikelyMoves ?? []).join("; ")}
                    </div>
                  )}
                  {(c.objectionHandling ?? []).length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <b style={{ color: T.plum }}>Objections / réponses :</b> {(c.objectionHandling ?? []).join("; ")}
                    </div>
                  )}
                  {c.recentMoves?.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: T.faint }}>
                      <b style={{ color: T.faint }}>Mouvements récents :</b> {c.recentMoves.join("; ")}
                    </div>
                  )}
                </div>
                {/* Maillage inter-vues (Vague C) : la carte concurrent relie au fil filtré sur lui. */}
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="pill" onClick={() => navigate(`/veille/fil?ent=${encodeURIComponent(c.competitor)}`)}>
                    🔎 Signaux « {c.competitor} »
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
