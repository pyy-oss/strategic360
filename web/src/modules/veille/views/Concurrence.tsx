import React, { useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge, Tip } from "../../../design/ui";
import { useCan, useIsExec } from "../../../lib/rbac";
import { createWinLossEntry, upsertBattlecard, useBattlecards, useWinLoss, winRateByCompetitor, type WinLossResult } from "../lib/execution";

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

const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** "Nouvelle battlecard" — contribution commerciale (server-side gate: canWrite('veille')). */
function NewBattlecardPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ competitor: "", positioning: "", strengths: "", weaknesses: "", ourWinThemes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
      await upsertBattlecard({
        competitor: form.competitor.trim(),
        positioning: form.positioning.trim() || undefined,
        strengths: splitLines(form.strengths),
        weaknesses: splitLines(form.weaknesses),
        ourWinThemes: splitLines(form.ourWinThemes),
        theirLikelyMoves: [],
        objectionHandling: [],
        recentMoves: [],
      });
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card style={{ marginBottom: 14, borderColor: T.gold }}>
      <form onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>Nouvelle battlecard</span>
          <button type="button" className="pill" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Concurrent *</label>
            <input style={inputStyle} value={form.competitor} onChange={(e) => set("competitor", e.target.value)} required />
          </div>
          <div>
            <label style={labelStyle}>Positionnement</label>
            <input style={inputStyle} value={form.positioning} onChange={(e) => set("positioning", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Forces (une par ligne)</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.strengths} onChange={(e) => set("strengths", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Faiblesses (une par ligne)</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.weaknesses} onChange={(e) => set("weaknesses", e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Comment gagner (un thème par ligne)</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.ourWinThemes} onChange={(e) => set("ourWinThemes", e.target.value)} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <button type="submit" className="pill on" disabled={submitting}>
          {submitting ? "Enregistrement…" : "Enregistrer la battlecard"}
        </button>
      </form>
    </Card>
  );
}

/** "Enregistrer un win/loss" — exec-gated (server-side: exec()); alimente le taux de victoire. */
function NewWinLossPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ competitor: "", result: "win" as WinLossResult, reason: "", amount: "", lesson: "", date: new Date().toISOString().slice(0, 10) });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
      // Montant chiffré (M FCFA) + leçon capitalisée (M14 audit) : sans eux, aucun CA gagné/perdu
      // ni retour d'expérience — la boucle de feedback restait vide.
      const amountNum = form.amount.trim() ? Number(form.amount.replace(",", ".")) : NaN;
      await createWinLossEntry({
        competitor: form.competitor.trim(),
        result: form.result,
        reason: form.reason.trim() || undefined,
        amount: Number.isFinite(amountNum) ? amountNum : undefined,
        lesson: form.lesson.trim() || undefined,
        date: form.date,
      });
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Échec de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card style={{ marginBottom: 14, borderColor: T.gold }}>
      <form onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>Enregistrer un win/loss</span>
          <button type="button" className="pill" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "1fr 110px 1fr 150px", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Concurrent *</label>
            <input style={inputStyle} value={form.competitor} onChange={(e) => set("competitor", e.target.value)} required />
          </div>
          <div>
            <label style={labelStyle}>Résultat</label>
            <select style={inputStyle} value={form.result} onChange={(e) => set("result", e.target.value as WinLossResult)}>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Raison</label>
            <input style={inputStyle} value={form.reason} onChange={(e) => set("reason", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Date *</label>
            <input type="date" style={inputStyle} value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </div>
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Montant (M FCFA)</label>
            <input style={inputStyle} inputMode="decimal" placeholder="ex : 45" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Leçon capitalisée</label>
            <input style={inputStyle} placeholder="Pourquoi gagné/perdu — à réutiliser" value={form.lesson} onChange={(e) => set("lesson", e.target.value)} />
          </div>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <button type="submit" className="pill on" disabled={submitting}>
          {submitting ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>
    </Card>
  );
}

/**
 * "Concurrence" — Firestore `battlecards` + `winLoss`. Win rate / deal count are computed
 * client-side from `winLoss` entries (`winRateByCompetitor`). Contribution forms: battlecards
 * are open to any veille contributor (canWrite('veille')); win/loss entries are exec-gated,
 * mirroring the Security Rules.
 */
export function Concurrence() {
  const { battlecards, loading: loadingCards } = useBattlecards();
  const { entries, loading: loadingWl } = useWinLoss();
  const { canWrite } = useCan("veille");
  const isExec = useIsExec();
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
          <Card><div style={{ fontSize: 11, color: T.faint }}>CA gagné (M FCFA)</div><div style={{ fontSize: 22, fontWeight: 700, color: T.emerald }}>{Math.round(wlSummary.won)}</div></Card>
          <Card><div style={{ fontSize: 11, color: T.faint }}>CA perdu (M FCFA)</div><div style={{ fontSize: 22, fontWeight: 700, color: T.clay }}>{Math.round(wlSummary.lost)}</div></Card>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {canWrite && (
          <button className="pill on" onClick={() => setShowCardForm((v) => !v)}>
            + Nouvelle battlecard
          </button>
        )}
        {isExec && (
          <button className="pill on" onClick={() => setShowWlForm((v) => !v)}>
            + Enregistrer un win/loss
          </button>
        )}
      </div>
      {showCardForm && canWrite && <NewBattlecardPanel onClose={() => setShowCardForm(false)} />}
      {showWlForm && isExec && <NewWinLossPanel onClose={() => setShowWlForm(false)} />}
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
                    <Bar dataKey="win" name="Taux victoire" fill={T.clay} radius={[4, 4, 0, 0]} barSize={46} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {rows.map((c) => (
              <Card key={c.id} style={{ borderTop: `3px solid ${T.clay}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Eyebrow color={T.clay}>{c.competitor}</Eyebrow>
                  <Badge c={c.win >= 0.5 ? T.emerald : T.clay}>
                    {c.deals > 0 ? `${pct(c.win)} · ${c.deals} deals` : "pas de win/loss"}
                  </Badge>
                </div>
                <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>
                  <div>
                    <b style={{ color: T.gold }}>Force :</b> {(c.strengths ?? []).join("; ") || "—"}
                  </div>
                  <div>
                    <b style={{ color: T.steel }}>Faiblesse :</b> {(c.weaknesses ?? []).join("; ") || "—"}
                  </div>
                  <div style={{ marginTop: 6, padding: "8px 10px", background: T.panel2, borderRadius: 8 }}>
                    <b style={{ color: T.emerald }}>Comment gagner :</b> {(c.ourWinThemes ?? []).join("; ") || "—"}
                  </div>
                  {c.recentMoves?.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: T.faint }}>
                      <b style={{ color: T.faint }}>Mouvements récents :</b> {c.recentMoves.join("; ")}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
