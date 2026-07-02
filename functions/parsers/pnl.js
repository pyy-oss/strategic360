"use strict";

/**
 * SheetJS parser for the "P&L" workbook (BUILD_KIT.md §9 / DELTA_01 §3bis.A).
 *
 * ASSUMED SHEET SHAPE (no real PIPELINE_NT_CI_Inventory.xlsx sample exists in this sandbox — see
 * task context; this schema is a best-effort reading of DELTA_01 §3bis.A's column list
 * "orders (CAS, RAF, MB, BU, AM, Frns1-10)" and WILL likely need adjustment once a real file is
 * available):
 *   - First sheet of the workbook (or a sheet literally named "P&L" if present — checked first).
 *   - Header row with (at minimum) these column names, one row per order/line:
 *       BU            — business unit (string)
 *       Fournisseur   — supplier name for this order line (string) — one of the "Frns1-10" slots
 *                        in DELTA_01's column list is read as a single `fournisseur` field per
 *                        row (the real sheet likely has 10 supplier columns per order — Frns1..
 *                        Frns10 — for a MULTI-supplier order; simplified here to "one supplier per
 *                        row" since the exact fan-out convention isn't known without the file;
 *                        calibrate once real headers are seen).
 *       CAS           — chiffre d'affaires signé, current fiscal year (number)
 *       CAS N-1       — chiffre d'affaires signé, prior fiscal year (number, for BCG growth)
 *       MB            — marge brute (number)
 *       AM            — account manager (string, not currently consumed downstream but kept)
 *   - Column name matching is case-insensitive and tolerant of accents/spaces (see HEADER_ALIASES).
 *
 * Output: { orders: [{ bu, fournisseur, cas, casN1, mb, am }], rowsIn, rowsOk, warnings }
 * Rows missing BOTH `bu` and `fournisseur` (i.e. clearly blank/garbage rows) are skipped; a
 * per-row try/catch means one malformed row never aborts the whole import — it's just counted as
 * skipped and logged via the returned `warnings` array (functions/index.js decides what to do
 * with those, e.g. persisting them into the `imports/{id}` audit doc's `report` field).
 */

const XLSX = require("xlsx");

const HEADER_ALIASES = {
  bu: ["bu", "business unit", "unité", "unite"],
  fournisseur: ["fournisseur", "frns1", "frns", "supplier", "fournisseur 1"],
  cas: ["cas", "cas n", "ca signé", "ca signe"],
  casN1: ["cas n-1", "cas n1", "casn1", "ca n-1"],
  mb: ["mb", "marge brute", "marge"],
  am: ["am", "account manager", "commercial"],
};

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function buildFieldMap(headerRow) {
  const map = {};
  const normalized = headerRow.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function pickSheet(workbook) {
  const byName = workbook.SheetNames.find((n) => normalizeHeader(n) === "p&l" || normalizeHeader(n) === "pnl");
  return workbook.Sheets[byName || workbook.SheetNames[0]];
}

/**
 * @param {Buffer} buffer raw .xlsx bytes (from Storage `file.download()`)
 * @returns {{ orders: Array<object>, rowsIn: number, rowsOk: number, warnings: string[] }}
 */
function parsePnl(buffer) {
  const warnings = [];
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = pickSheet(workbook);
  if (!sheet) return { orders: [], rowsIn: 0, rowsOk: 0, warnings: ["no sheet found"] };

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
  if (rows.length === 0) return { orders: [], rowsIn: 0, rowsOk: 0, warnings: ["empty sheet"] };

  const fieldMap = buildFieldMap(rows[0]);
  const dataRows = rows.slice(1);
  const orders = [];
  let rowsOk = 0;

  dataRows.forEach((row, i) => {
    try {
      const bu = fieldMap.bu != null ? row[fieldMap.bu] : null;
      const fournisseur = fieldMap.fournisseur != null ? row[fieldMap.fournisseur] : null;
      if (!bu && !fournisseur) return; // blank/garbage row — skip silently

      const cas = fieldMap.cas != null ? Number(row[fieldMap.cas]) : NaN;
      const casN1 = fieldMap.casN1 != null ? Number(row[fieldMap.casN1]) : NaN;
      const mb = fieldMap.mb != null ? Number(row[fieldMap.mb]) : NaN;
      const am = fieldMap.am != null ? row[fieldMap.am] : null;

      orders.push({
        bu: bu != null ? String(bu).trim() : null,
        fournisseur: fournisseur != null ? String(fournisseur).trim() : null,
        cas: Number.isFinite(cas) ? cas : 0,
        casN1: Number.isFinite(casN1) ? casN1 : 0,
        mb: Number.isFinite(mb) ? mb : 0,
        am: am != null ? String(am).trim() : null,
      });
      rowsOk += 1;
    } catch (err) {
      warnings.push(`row ${i + 2}: ${err.message}`);
    }
  });

  return { orders, rowsIn: dataRows.length, rowsOk, warnings };
}

module.exports = { parsePnl };
