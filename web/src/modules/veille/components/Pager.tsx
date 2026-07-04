import React, { useEffect, useState } from "react";
import { T } from "../../../design/tokens";

/**
 * Pagination réutilisable des longues listes (2026-07). `usePaged` tranche une liste et gère la
 * page courante ; `Pager` rend les contrôles. Pur côté client (les données sont déjà chargées) —
 * l'objectif est la LISIBILITÉ / le rendu (ne pas peindre 800 lignes d'un coup), pas la requête.
 * `resetKey` : quand la signature des filtres change, on revient page 1.
 */
export function usePaged<T>(items: T[], pageSize = 20, resetKey = "") {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey, pageSize]);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { page: safePage, setPage, pageCount, pageItems, total, start, end: start + pageItems.length, pageSize };
}

export function Pager({
  page, setPage, pageCount, total, start, end,
}: {
  page: number; setPage: (n: number) => void; pageCount: number; total: number; start: number; end: number;
}) {
  if (pageCount <= 1) return null;
  const btn: React.CSSProperties = { minHeight: 36 };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11.5, color: T.faint, fontVariantNumeric: "tabular-nums" }}>
        {start + 1}–{end} sur {total}
      </span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button className="pill" style={btn} disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Page précédente">← Préc.</button>
        <span style={{ fontSize: 12, color: T.dim, fontVariantNumeric: "tabular-nums", minWidth: 64, textAlign: "center" }}>Page {page}/{pageCount}</span>
        <button className="pill" style={btn} disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Page suivante">Suiv. →</button>
      </div>
    </div>
  );
}
