"use strict";

/**
 * parsers/workbook.js — lecture de classeurs .xlsx via exceljs (audit intégral 2026-07, M4).
 *
 * Remplace SheetJS `xlsx` 0.18.5 (deux vulnérabilités HIGH sans correctif npm : prototype pollution
 * GHSA-4r6h-8v6p-xvw6 et ReDoS GHSA-5pgg-2g8v-p4x9) sur un paquet qui parse des classeurs d'origine
 * externe. La distribution officielle corrigée n'est pas disponible via le registre npm ; on migre
 * donc vers `exceljs` (déjà dépendance du projet — résout aussi m12 « exceljs inutilisé »).
 *
 * Fournit une PARITÉ avec l'usage historique `XLSX.utils.sheet_to_json(sheet, {header:1,
 * defval:null, blankrows:false})` (tableau de tableaux, cellules vides → null, lignes vides
 * ignorées, largeur de colonnes fixe). Les DATES sont converties en SÉRIAL Excel (nombre), comme le
 * faisait SheetJS en mode brut, pour ne pas changer la sortie des parseurs qui stringifient ces
 * colonnes. ASYNC (exceljs charge le buffer de façon asynchrone).
 */

const ExcelJS = require("exceljs");

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // 1899-12-30 : origine du sérial Excel (bug 1900 inclus)
const DAY_MS = 24 * 60 * 60 * 1000;

/** Convertit une valeur de cellule exceljs en la valeur « brute » qu'aurait renvoyée SheetJS. */
function normalizeCell(v) {
  if (v == null) return null;
  if (v instanceof Date) return (v.getTime() - EXCEL_EPOCH_UTC) / DAY_MS; // sérial Excel (parité xlsx brut)
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    // Formule : { formula, result } → on prend le résultat calculé.
    if ("result" in v) return normalizeCell(v.result);
    if ("error" in v) return null;
    // Texte riche : { richText: [{ text }] } → concaténation.
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text || "").join("");
    // Hyperlien : { text, hyperlink } → texte affiché.
    if ("text" in v) return v.text;
  }
  return null;
}

/**
 * readWorkbook(buffer) -> { SheetNames: [string], sheets: { [name]: rows } } où `rows` est un
 * tableau de tableaux (header:1). Miroir minimal de l'objet SheetJS consommé par les parseurs
 * (SheetNames + accès par nom). ASYNC.
 */
async function readWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const SheetNames = [];
  const sheets = {};
  wb.eachSheet((ws) => {
    SheetNames.push(ws.name);
    const width = ws.actualColumnCount || ws.columnCount || 0;
    const rows = [];
    // includeEmpty:false → les lignes entièrement vides sont ignorées (parité blankrows:false).
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= width; c++) vals.push(normalizeCell(row.getCell(c).value));
      rows.push(vals);
    });
    sheets[ws.name] = rows;
  });
  return { SheetNames, sheets };
}

/** rowsForSheet(workbook, name) — lignes de la feuille `name` (ou []). */
function rowsForSheet(workbook, name) {
  return (workbook && workbook.sheets && workbook.sheets[name]) || [];
}

module.exports = { readWorkbook, rowsForSheet, normalizeCell };
