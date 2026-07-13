"use strict";

/**
 * domain/kpiBackfill.js — RECONSTRUCTION HONNÊTE de l'historique des KPIs exécutifs (levier
 * « waouh » n°1 : tendances). Au lancement, `summaries/kpiHistory` est vide → aucune flèche ↑/↓
 * ne peut apparaître avant que le cron quotidien (`snapshotVeilleKpis`) n'ait accumulé ≥ 2 jours.
 *
 * Ce module reconstruit les seules métriques HONNÊTEMENT reconstituables à partir d'une donnée
 * IMMUABLE : `intelItems.createdAt`. Pour chaque jour D passé, on compte les signaux ACTUELLEMENT
 * publiés dont la date de création est ≤ fin de D — soit le CUMUL de menaces / opportunités tel
 * qu'il se présentait ce jour-là.
 *
 * Ce qu'on NE reconstruit PAS (et qui reste `null` sur les points reconstruits) : tout ce qui
 * dépend d'un ÉTAT MUTABLE non horodaté (menaces traitées, high non traitées → statut courant ;
 * taux de victoire, avancement OKR, pipeline en XOF → données dérivées non historisées). Les
 * inventer serait de la donnée fictive. Chaque point reconstruit porte `backfilled: true` pour
 * que rien ne soit présenté comme un vrai instantané figé le jour même.
 *
 * PUR : aucune I/O. Testé unitairement (test/kpiBackfill.domain.test.js). L'orchestration Firestore
 * (lecture intelItems, transaction sur summaries/kpiHistory) vit dans index.js.
 */

/** Nombre de jours par défaut à reconstruire (fenêtre glissante, aligné sur KPI_HISTORY_CAP côté cron). */
const DEFAULT_BACKFILL_DAYS = 30;

/**
 * dayRangeUTC(endDateStr, n) → tableau ASCENDANT de n chaînes « YYYY-MM-DD » (UTC) se terminant à
 * `endDateStr` inclus. Ex. dayRangeUTC("2026-07-13", 3) → ["2026-07-11","2026-07-12","2026-07-13"].
 */
function dayRangeUTC(endDateStr, n) {
  const end = new Date(`${endDateStr}T00:00:00Z`);
  if (Number.isNaN(end.getTime()) || !Number.isFinite(n) || n <= 0) return [];
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Fin de journée UTC (ms epoch) pour un jour « YYYY-MM-DD » — borne de cumul « ≤ ce jour ». */
function endOfDayMs(dayStr) {
  return new Date(`${dayStr}T23:59:59.999Z`).getTime();
}

/**
 * computeKpiBackfillPoints({ items, days }) → points d'historique reconstruits (backfilled:true).
 *
 * @param items  [{ createdMs:number|null, stance:'threat'|'opportunity'|string, published:boolean }]
 *               `createdMs` : date de création en ms epoch (les items sans date sont ignorés — on
 *               ne peut pas les dater honnêtement). `published` : appartient-il à l'ensemble
 *               actuellement publié (les brouillons/rejetés/archivés sont exclus, comme dans
 *               computeVeilleExecSummary).
 * @param days   tableau de jours « YYYY-MM-DD » à calculer.
 * @returns [{ date, menacesTotal, opportunites, menacesTraitees:null, winRateGlobal:null,
 *             okrProgress:null, threatsHighUnactioned:null, backfilled:true }]
 */
function computeKpiBackfillPoints({ items, days }) {
  const dated = (Array.isArray(items) ? items : []).filter(
    (it) => it && it.published && Number.isFinite(it.createdMs)
  );
  return (Array.isArray(days) ? days : []).map((date) => {
    const cutoff = endOfDayMs(date);
    let menacesTotal = 0;
    let opportunites = 0;
    for (const it of dated) {
      if (it.createdMs > cutoff) continue;
      if (it.stance === "threat") menacesTotal += 1;
      else if (it.stance === "opportunity") opportunites += 1;
    }
    return {
      date,
      menacesTotal,
      opportunites,
      // Non reconstituables honnêtement (état mutable / dérivé non historisé) : explicitement null.
      menacesTraitees: null,
      winRateGlobal: null,
      okrProgress: null,
      threatsHighUnactioned: null,
      backfilled: true,
    };
  });
}

/**
 * mergeHistoryPoints(existing, backfill, cap) → tableau fusionné, trié, plafonné.
 *
 * Règle de préséance : un VRAI instantané (backfilled falsy) ne doit JAMAIS être écrasé par un
 * point reconstruit. Un point reconstruit peut remplacer un précédent point reconstruit (refresh).
 * Pour une même date, on garde donc l'existant s'il est authentique ; sinon le point de backfill.
 */
function mergeHistoryPoints(existing, backfill, cap = 90) {
  const byDate = new Map();
  for (const p of Array.isArray(existing) ? existing : []) {
    if (p && p.date) byDate.set(p.date, p);
  }
  for (const p of Array.isArray(backfill) ? backfill : []) {
    if (!p || !p.date) continue;
    const cur = byDate.get(p.date);
    // On n'écrase un existant que s'il est lui-même reconstruit (jamais un vrai snapshot).
    if (!cur || cur.backfilled) byDate.set(p.date, p);
  }
  const merged = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );
  return typeof cap === "number" && cap > 0 ? merged.slice(-cap) : merged;
}

module.exports = {
  DEFAULT_BACKFILL_DAYS,
  dayRangeUTC,
  endOfDayMs,
  computeKpiBackfillPoints,
  mergeHistoryPoints,
};
