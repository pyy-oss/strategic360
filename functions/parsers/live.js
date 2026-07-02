"use strict";

/**
 * SheetJS parser for the "LIVE" workbook (opportunities / pipeline, BUILD_KIT.md §9 /
 * DELTA_01 §3bis.A: "opportunities (montant, étape, IdC, D Prev, MB%)").
 *
 * ASSUMED SHEET SHAPE (no real sample file — see functions/parsers/pnl.js header comment for the
 * same caveat, applies here too):
 *   - First sheet (or one literally named "LIVE").
 *   - Header row with (at minimum):
 *       Client / Compte  — client name (string)
 *       Montant          — deal amount (number)
 *       Étape            — pipeline stage label (string) — DELTA_01 mentions "6 vs 7" numbered
 *                           steps for win/loss but doesn't give the full label list; this parser
 *                           assumes TEXT stage labels matching functions/domain/quanti.js's
 *                           ETAPE_PROBABILITY map (Qualification/Proposition/Négociation/
 *                           Verbal/Gagné/Perdu) rather than the numeric 1-7 codes DELTA_01
 *                           hints at — calibrate once real LIVE headers/values are known (if LIVE
 *                           actually uses numeric codes, map them to these labels here before
 *                           handing rows to computePipeline).
 *       IdC              — deal/opportunity identifier (string)
 *       D Prev           — expected close date (date/string)
 *       MB%              — expected gross margin percent (number, 0-100 or 0-1 — normalized to
 *                           0-1 here if a value >1 is seen, on the assumption it was entered as a
 *                           percentage like "25" meaning 25%)
 *
 * Output: { opportunities: [{ client, montant, etape, idc, datePrev, mbPct }], rowsIn, rowsOk, warnings }
 */

const XLSX = require("xlsx");

const HEADER_ALIASES = {
  client: ["client", "compte", "client/compte"],
  montant: ["montant", "montant (m fcfa)", "valeur"],
  etape: ["etape", "étape", "stage", "statut"],
  idc: ["idc", "id", "id client", "identifiant"],
  datePrev: ["d prev", "date prev", "date prévue", "date prevue", "d. prev"],
  mbPct: ["mb%", "mb %", "marge %", "mb pct"],
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
  const byName = workbook.SheetNames.find((n) => normalizeHeader(n) === "live");
  return workbook.Sheets[byName || workbook.SheetNames[0]];
}

/**
 * @param {Buffer} buffer raw .xlsx bytes
 * @returns {{ opportunities: Array<object>, rowsIn: number, rowsOk: number, warnings: string[] }}
 */
function parseLive(buffer) {
  const warnings = [];
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = pickSheet(workbook);
  if (!sheet) return { opportunities: [], rowsIn: 0, rowsOk: 0, warnings: ["no sheet found"] };

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
  if (rows.length === 0) return { opportunities: [], rowsIn: 0, rowsOk: 0, warnings: ["empty sheet"] };

  const fieldMap = buildFieldMap(rows[0]);
  const dataRows = rows.slice(1);
  const opportunities = [];
  let rowsOk = 0;

  dataRows.forEach((row, i) => {
    try {
      const client = fieldMap.client != null ? row[fieldMap.client] : null;
      const idc = fieldMap.idc != null ? row[fieldMap.idc] : null;
      if (!client && !idc) return; // blank/garbage row — skip silently

      const montant = fieldMap.montant != null ? Number(row[fieldMap.montant]) : NaN;
      const etape = fieldMap.etape != null ? row[fieldMap.etape] : null;
      const datePrevRaw = fieldMap.datePrev != null ? row[fieldMap.datePrev] : null;
      let mbPct = fieldMap.mbPct != null ? Number(row[fieldMap.mbPct]) : NaN;
      if (Number.isFinite(mbPct) && mbPct > 1) mbPct = mbPct / 100;

      opportunities.push({
        client: client != null ? String(client).trim() : null,
        montant: Number.isFinite(montant) ? montant : 0,
        etape: etape != null ? String(etape).trim() : null,
        idc: idc != null ? String(idc).trim() : null,
        datePrev: datePrevRaw != null ? String(datePrevRaw).trim() : null,
        mbPct: Number.isFinite(mbPct) ? mbPct : null,
      });
      rowsOk += 1;
    } catch (err) {
      warnings.push(`row ${i + 2}: ${err.message}`);
    }
  });

  return { opportunities, rowsIn: dataRows.length, rowsOk, warnings };
}

module.exports = { parseLive };
