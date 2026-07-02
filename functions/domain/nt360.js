"use strict";

/**
 * Domain logic: mapping the SIBLING APP nt360's Firestore rows onto the row shapes that
 * functions/domain/quanti.js expects ("données internes disponibles dans une autre application"
 * decision, 2026-07-02 — the internal P&L/LIVE/Facturation/fiche data is no longer expected as
 * Excel uploads to Storage: nt360, another app in the same shared Firebase project, already
 * ingests those workbooks into its own named Firestore database "nt360").
 *
 * nt360 row shapes (inventoried read-only via inspect-internal-data.yml, 2026-07-02):
 *   orders        { _id, am, bu, cas, client, fp, mb, raf, suppliers: string[], yearPo, source:"pnl" }
 *   opportunities { _id, am, amount, bu, client, closingDate, fp, marginPct, oppId, probability,
 *                   stage: number, stageLabel: "2-Montage", weighted, source:"salesData" }
 *   invoices      { _id, amountHt, bu, client, date, fp, linked, numero, paymentStatus, prePo,
 *                   source:"facturationDf" }
 *   bcLines       { _id, amountXof, bcNumber, currency, description, expenseType, fp, lineIndex,
 *                   status, supplier, source:"fiche" }
 *   objectives    { fiscalYear, scope, scopeValue, targetCas, targetInvoiced, targetMargin }
 *   config        (one doc carries { currentFy: number, available: number[] })
 *
 * quanti.js expected shapes (see its header):
 *   orders:        { bu, fournisseur, cas, casN1, mb, am }
 *   opportunities: { client, montant, etape, idc, datePrev, mbPct }
 *   invoices:      { dateCommande, dateFacturation, montant }
 *
 * Pure functions only (no Firestore access) — unit-tested in functions/test/nt360.domain.test.js.
 * The only caller that touches Firestore is `runInternalQuantiSync` in functions/index.js, which
 * reads the nt360 database STRICTLY READ-ONLY and writes the resulting `summaries/quanti` into
 * strategic360's own database.
 */

/**
 * nt360 pipeline stages → quanti.js's ETAPE_PROBABILITY vocabulary. nt360 numbers its stages
 * 1..7 with French labels ("2-Montage"); DELTA_01 §3bis.E documents "win rate (6 vs 7)" — stage 6
 * is Gagné, stage 7 is Perdu (those two mappings are exact and drive the win-rate). The open
 * stages 1-5 are approximations onto the conventional 5-stage vocabulary (probabilities 0.2→0.8);
 * nt360 does carry its own per-opportunity `probability`, but quanti.js's computePipeline
 * deliberately derives probability from `etape` so the whole app shares one calibratable map —
 * recalibrate ETAPE_PROBABILITY there if nt360's own probabilities prove more accurate.
 */
const STAGE_TO_ETAPE = {
  1: "Qualification",
  2: "Proposition",
  3: "Négociation",
  4: "Verbal",
  5: "Verbal",
  6: "Gagné",
  7: "Perdu",
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * mapOrders(nt360Orders, currentFy) -> quanti `orders` rows.
 * nt360's P&L keeps one row per order tagged with its PO year (`yearPo`) instead of carrying
 * cas/casN1 column pairs — so "CAS N" = cas of rows with yearPo === currentFy and "CAS N-1" = cas
 * of rows with yearPo === currentFy-1. Each mapped row contributes to exactly one of cas/casN1
 * (older years contribute to neither — they exist for history, not for the N/N-1 comparison).
 * `mb` (marge brute) follows the same rule so computeBcg's per-BU `marge` is the CURRENT year's
 * margin, matching the maquette's semantics. `fournisseur` is deliberately null — nt360 orders
 * carry a `suppliers` array that is empty in practice; supplier concentration comes from bcLines
 * instead (see mapBcLinesToSupplierRows).
 */
function mapOrders(nt360Orders, currentFy) {
  if (!Array.isArray(nt360Orders)) return [];
  const fy = Number(currentFy);
  return nt360Orders
    .filter((o) => o && typeof o === "object")
    .map((o) => {
      const year = Number(o.yearPo);
      const isN = year === fy;
      const isN1 = year === fy - 1;
      return {
        bu: o.bu || null,
        am: o.am || null,
        fournisseur: null,
        cas: isN ? num(o.cas) : 0,
        casN1: isN1 ? num(o.cas) : 0,
        mb: isN ? num(o.mb) : 0,
      };
    });
}

/**
 * mapOpportunities(nt360Opps) -> quanti `opportunities` rows.
 * etape: via STAGE_TO_ETAPE (numeric `stage` preferred; falls back to parsing the leading digit
 * of `stageLabel` like "2-Montage"; unknown → undefined so computePipeline applies its documented
 * conservative 0.3 default).
 */
function mapOpportunities(nt360Opps) {
  if (!Array.isArray(nt360Opps)) return [];
  return nt360Opps
    .filter((o) => o && typeof o === "object")
    .map((o) => {
      let stage = Number(o.stage);
      if (!Number.isFinite(stage) && typeof o.stageLabel === "string") {
        stage = Number.parseInt(o.stageLabel, 10);
      }
      return {
        client: o.client || null,
        montant: num(o.amount),
        etape: STAGE_TO_ETAPE[stage],
        idc: o.oppId || o._id || null,
        datePrev: o.closingDate || null,
        mbPct: Number.isFinite(Number(o.marginPct)) ? Number(o.marginPct) : null,
      };
    });
}

/**
 * mapInvoices(nt360Invoices) -> quanti `invoices` rows.
 * nt360 invoices only carry the invoicing `date` — there is no order date on the invoice row, so
 * `dateCommande` is null and the "Délai commande→facturation" KRI stays honestly null (computeKris
 * already handles unparsable dates by skipping the row) instead of being fabricated.
 */
function mapInvoices(nt360Invoices) {
  if (!Array.isArray(nt360Invoices)) return [];
  return nt360Invoices
    .filter((i) => i && typeof i === "object")
    .map((i) => ({
      dateCommande: null,
      dateFacturation: i.date || null,
      montant: num(i.amountHt),
    }));
}

/**
 * mapBcLinesToSupplierRows(nt360BcLines) -> quanti `orders`-shaped rows carrying ONLY
 * {fournisseur, cas} for computePorterForces's Top-3 supplier concentration (nt360's fiche-affaire
 * purchase lines are the supplier ledger: one line per supplier purchase with amountXof).
 * These pseudo-rows must NOT be fed to computeBcg/computeCasSummary (they have no bu — computeBcg
 * skips them anyway — and their amounts are purchases, not revenue).
 */
function mapBcLinesToSupplierRows(nt360BcLines) {
  if (!Array.isArray(nt360BcLines)) return [];
  return nt360BcLines
    .filter((l) => l && typeof l === "object" && l.supplier)
    .map((l) => ({ fournisseur: l.supplier, cas: num(l.amountXof) }));
}

/**
 * pickObjectives(nt360Objectives, currentFy) -> {fiscalYear, targetCas, targetInvoiced,
 * targetMargin} | null — the global objectives doc for the current fiscal year (prefers
 * scope==="global", falls back to the first doc matching the year). Passed through into
 * `summaries/quanti.objectives` so future UI (Indicateurs/Diagnostic) can compare realized vs
 * target without re-reading nt360.
 */
function pickObjectives(nt360Objectives, currentFy) {
  if (!Array.isArray(nt360Objectives) || nt360Objectives.length === 0) return null;
  const fy = Number(currentFy);
  const forYear = nt360Objectives.filter((o) => o && Number(o.fiscalYear) === fy);
  const candidates = forYear.length ? forYear : nt360Objectives;
  const chosen = candidates.find((o) => o && o.scope === "global") || candidates[0];
  if (!chosen) return null;
  return {
    fiscalYear: Number(chosen.fiscalYear) || null,
    targetCas: Number.isFinite(Number(chosen.targetCas)) ? Number(chosen.targetCas) : null,
    targetInvoiced: Number.isFinite(Number(chosen.targetInvoiced)) ? Number(chosen.targetInvoiced) : null,
    targetMargin: Number.isFinite(Number(chosen.targetMargin)) ? Number(chosen.targetMargin) : null,
  };
}

/**
 * pickCurrentFy(configDocs, fallbackYear) -> number — nt360's `config` collection carries the
 * active fiscal year on one of its docs ({currentFy: 2026, available: [...]}). Falls back to the
 * caller-supplied year (typically the current calendar year) when absent.
 */
function pickCurrentFy(configDocs, fallbackYear) {
  if (Array.isArray(configDocs)) {
    for (const doc of configDocs) {
      const fy = Number(doc && doc.currentFy);
      if (Number.isFinite(fy) && fy > 2000) return fy;
    }
  }
  return fallbackYear;
}

module.exports = {
  STAGE_TO_ETAPE,
  mapOrders,
  mapOpportunities,
  mapInvoices,
  mapBcLinesToSupplierRows,
  pickObjectives,
  pickCurrentFy,
};
