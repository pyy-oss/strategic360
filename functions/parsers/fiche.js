"use strict";

/**
 * SheetJS parser for a "fiche affaire" workbook (BUILD_KIT.md §9 / DELTA_01 §3bis.A:
 * "Fiche affaire → projectSheets, bcLines: coûts par fournisseur/type, exposition").
 *
 * ASSUMED SHEET SHAPE (no real sample file — see functions/parsers/pnl.js for the same caveat):
 *   - First sheet (a "fiche affaire" is typically a single-project workbook, so no name-matching
 *     heuristic beyond "first sheet" is attempted here).
 *   - Header row with (at minimum):
 *       Fournisseur  — supplier for this cost line (string)
 *       Type         — cost line type, e.g. "Matériel" / "Licence" / "Service" (string)
 *       Montant      — cost line amount (number)
 *
 * Output: { bcLines: [{ fournisseur, type, montant }], rowsIn, rowsOk, warnings }
 *
 * NOTE: `bcLines` is parsed here for completeness (BUILD_KIT.md §9 lists it as a source) but is
 * NOT currently consumed by any function in functions/domain/quanti.js — none of Porter/BCG/
 * pipeline/KRIs/value-at-stake as implemented in V4 read `bcLines`. It's reserved for a future
 * "coûts par fournisseur/type" breakdown view, out of this phase's scope (documented in
 * functions/index.js at the call site too).
 */

const XLSX = require("xlsx");

const HEADER_ALIASES = {
  fournisseur: ["fournisseur", "supplier"],
  type: ["type", "type de coût", "type de cout", "catégorie", "categorie"],
  montant: ["montant", "amount", "cout", "coût"],
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

/**
 * @param {Buffer} buffer raw .xlsx bytes
 * @returns {{ bcLines: Array<object>, rowsIn: number, rowsOk: number, warnings: string[] }}
 */
function parseFiche(buffer) {
  const warnings = [];
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { bcLines: [], rowsIn: 0, rowsOk: 0, warnings: ["no sheet found"] };

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
  if (rows.length === 0) return { bcLines: [], rowsIn: 0, rowsOk: 0, warnings: ["empty sheet"] };

  const fieldMap = buildFieldMap(rows[0]);
  const dataRows = rows.slice(1);
  const bcLines = [];
  let rowsOk = 0;

  dataRows.forEach((row, i) => {
    try {
      const fournisseur = fieldMap.fournisseur != null ? row[fieldMap.fournisseur] : null;
      const montantRaw = fieldMap.montant != null ? row[fieldMap.montant] : null;
      if (!fournisseur && montantRaw == null) return; // blank/garbage row — skip silently

      const type = fieldMap.type != null ? row[fieldMap.type] : null;
      const montant = Number(montantRaw);

      bcLines.push({
        fournisseur: fournisseur != null ? String(fournisseur).trim() : null,
        type: type != null ? String(type).trim() : null,
        montant: Number.isFinite(montant) ? montant : 0,
      });
      rowsOk += 1;
    } catch (err) {
      warnings.push(`row ${i + 2}: ${err.message}`);
    }
  });

  return { bcLines, rowsIn: dataRows.length, rowsOk, warnings };
}

module.exports = { parseFiche };
