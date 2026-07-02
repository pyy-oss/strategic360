import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { T, pct } from "../../../design/tokens";
import { Eyebrow, Card, Badge, Tip } from "../../../design/ui";
import { useBattlecards, useWinLoss, winRateByCompetitor } from "../lib/execution";

/**
 * "Concurrence" — ported from `Concurrence` in the maquette; data source swapped to Firestore
 * `battlecards` + `winLoss` (V6). Win rate / deal count are computed client-side from `winLoss`
 * entries (`winRateByCompetitor`, `lib/execution.ts`) rather than stored on the battlecard itself,
 * matching BUILD_KIT.md §6's split between the two collections.
 *
 * Read-only for V6: a battlecard is a richer multi-field document (positioning, strengths[],
 * weaknesses[], ourWinThemes[], theirLikelyMoves[], objectionHandling[], recentMoves[]) than a
 * quick contribution form could reasonably capture without a bespoke multi-field editor; per the
 * task brief this was deprioritized in favor of correct read-wiring across all 6 views. Creating
 * battlecards/winLoss entries currently happens via direct Firestore writes (Console/seed) until
 * a follow-up phase adds the editor.
 */
export function Concurrence() {
  const { battlecards, loading: loadingCards } = useBattlecards();
  const { entries, loading: loadingWl } = useWinLoss();
  const stats = winRateByCompetitor(entries);

  const rows = battlecards.map((c) => ({
    ...c,
    win: stats[c.competitor]?.win ?? 0,
    deals: stats[c.competitor]?.deals ?? 0,
  }));

  const loading = loadingCards || loadingWl;

  if (!loading && rows.length === 0) {
    return (
      <Card>
        <Eyebrow color={T.clay}>Concurrence</Eyebrow>
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
          Aucune battlecard enregistrée pour l'instant. Les battlecards et le win/loss se saisissent via la contribution commerciale (BUILD_KIT.md §7).
        </div>
      </Card>
    );
  }

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={T.clay}>Taux de victoire par concurrent (Win/Loss — relié au Pipeline)</Eyebrow>
        {loading && rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: T.faint, marginTop: 10 }}>Chargement…</div>
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
                {pct(c.win)} · {c.deals} deals
              </Badge>
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>
              <div>
                <b style={{ color: T.gold }}>Force :</b> {c.strengths.join("; ") || "—"}
              </div>
              <div>
                <b style={{ color: T.steel }}>Faiblesse :</b> {c.weaknesses.join("; ") || "—"}
              </div>
              <div style={{ marginTop: 6, padding: "8px 10px", background: T.panel2, borderRadius: 8 }}>
                <b style={{ color: T.emerald }}>Comment gagner :</b> {c.ourWinThemes.join("; ") || "—"}
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
    </div>
  );
}
