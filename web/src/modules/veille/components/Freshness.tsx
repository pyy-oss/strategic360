import React from "react";
import { T } from "../../../design/tokens";
import { relativeTimeFr, timestampAgeDays } from "../lib/freshness";

/**
 * Freshness — pastille « as-of » (audit valeur CXO 2026-07). Date à l'écran un chiffre issu de
 * nt360/summaries pour que la crédibilité soit visible : un DAF ne signe pas un chiffre sans savoir
 * de quand il date. Vire au rouge au-delà de `staleDays` (donnée possiblement obsolète). N'affiche
 * RIEN si l'instant est inexploitable (jamais de « — » trompeur), sauf `showWhenUnknown`.
 *
 * `at` accepte un Firestore Timestamp (a `.toMillis()`), un Date, un nombre (epoch ms) ou null.
 */
type TimestampLike = { toMillis?: () => number } | Date | number | null | undefined;

function toMillis(at: TimestampLike): number | null {
  if (at == null) return null;
  if (typeof at === "number") return Number.isFinite(at) ? at : null;
  if (at instanceof Date) return at.getTime();
  if (typeof at === "object" && typeof at.toMillis === "function") {
    const ms = at.toMillis();
    return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function Freshness({
  at,
  label = "Synchronisé",
  staleDays = 7,
  showWhenUnknown = false,
}: {
  at: TimestampLike;
  label?: string;
  staleDays?: number;
  showWhenUnknown?: boolean;
}) {
  const ms = toMillis(at);
  const rel = relativeTimeFr(ms);
  if (!rel) {
    return showWhenUnknown ? (
      <span style={{ fontSize: 10.5, color: T.faint }}>Fraîcheur inconnue</span>
    ) : null;
  }
  const age = timestampAgeDays(ms);
  const stale = age != null && age > staleDays;
  const color = stale ? T.clay : T.faint;
  return (
    <span
      title={stale ? `Donnée possiblement obsolète (plus de ${staleDays} j)` : "Fraîcheur de la donnée"}
      style={{ fontSize: 10.5, color, fontWeight: stale ? 700 : 500, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: stale ? T.clay : T.emerald, display: "inline-block" }} />
      {label} {rel}
    </span>
  );
}
