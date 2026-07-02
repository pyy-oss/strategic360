"use strict";

/**
 * SheetJS parser for the "Facturation DF" workbook (BUILD_KIT.md §9 / DELTA_01 §3bis.A:
 * "Facturation DF / Odoo account.move → invoices").
 *
 * ASSUMED SHEET SHAPE (no real sample file — see functions/parsers/pnl.js for the same caveat):
 *   - First sheet (or one literally named "Facturation" / "Facturation DF").
 *   - Header row with (at minimum):
 *       Date commande     — order date (date/string) — needed for the "délai commande→
 *                            facturation" KRI (DELTA_01 §3bis.F flags this field as a prerequisite
 *                            that must be reliable, "sinon KRIs en estimation").
 *       Date facturation  — invoice date (date/string)
 *       Montant           — invoiced amount (number)
 *
 * Output: { invoices: [{ dateCommande, dateFacturation, montant }], rowsIn, rowsOk, warnings }
 */

const XLSX = require("xlsx");

const HEADER_ALIASES = {
  dateCommande: ["date commande", "date de commande", "d commande", "order date"],
  dateFacturation: ["date facturation", "date de facturation", "d facturation", "invoice date"],
  montant: ["montant", "montant facture", "montant facturé", "amount"],
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
  const byName = workbook.SheetNames.find((n) => normalizeHeader(n).startsWith("facturation"));
  return workbook.Sheets[byName || workbook.SheetNames[0]];
}

/**
 * @param {Buffer} buffer raw .xlsx bytes
 * @returns {{ invoices: Array<object>, rowsIn: number, rowsOk: number, warnings: string[] }}
 */
function parseFacturationDf(buffer) {
  const warnings = [];
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = pickSheet(workbook);
  if (!sheet) return { invoices: [], rowsIn: 0, rowsOk: 0, warnings: ["no sheet found"] };

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
  if (rows.length === 0) return { invoices: [], rowsIn: 0, rowsOk: 0, warnings: ["empty sheet"] };

  const fieldMap = buildFieldMap(rows[0]);
  const dataRows = rows.slice(1);
  const invoices = [];
  let rowsOk = 0;

  dataRows.forEach((row, i) => {
    try {
      const montantRaw = fieldMap.montant != null ? row[fieldMap.montant] : null;
      const dateFactRaw = fieldMap.dateFacturation != null ? row[fieldMap.dateFacturation] : null;
      if (montantRaw == null && dateFactRaw == null) return; // blank/garbage row — skip silently

      const montant = Number(montantRaw);
      const dateCommandeRaw = fieldMap.dateCommande != null ? row[fieldMap.dateCommande] : null;

      invoices.push({
        dateCommande: dateCommandeRaw != null ? String(dateCommandeRaw).trim() : null,
        dateFacturation: dateFactRaw != null ? String(dateFactRaw).trim() : null,
        montant: Number.isFinite(montant) ? montant : 0,
      });
      rowsOk += 1;
    } catch (err) {
      warnings.push(`row ${i + 2}: ${err.message}`);
    }
  });

  return { invoices, rowsIn: dataRows.length, rowsOk, warnings };
}

module.exports = { parseFacturationDf };
