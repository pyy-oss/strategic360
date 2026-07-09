"use strict";

/**
 * Migration xlsx→exceljs (audit intégral 2026-07, M4) : on génère de VRAIS classeurs .xlsx avec
 * exceljs, on les fait lire par les parseurs, et on vérifie la PARITÉ de sortie (colonnes mappées
 * par en-tête, nombres, chaînes, cellules vides, feuille nommée, dates en sérial Excel).
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readWorkbook, normalizeCell } from "../parsers/workbook.js";
import { parsePnl } from "../parsers/pnl.js";
import { parseLive } from "../parsers/live.js";
import { parseFacturationDf } from "../parsers/facturationDf.js";

async function buildXlsx(sheetName, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("workbook — normalizeCell (parité SheetJS brut)", () => {
  it("nombres, chaînes, booléens, vides, formule, richText", () => {
    expect(normalizeCell(42)).toBe(42);
    expect(normalizeCell("x")).toBe("x");
    expect(normalizeCell(null)).toBe(null);
    expect(normalizeCell(undefined)).toBe(null);
    expect(normalizeCell({ formula: "A1+1", result: 7 })).toBe(7);
    expect(normalizeCell({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(normalizeCell({ text: "lien", hyperlink: "http://x" })).toBe("lien");
  });
  it("dates → sérial Excel (2024-01-01 = 45292)", () => {
    expect(normalizeCell(new Date(Date.UTC(2024, 0, 1)))).toBe(45292);
  });
});

describe("workbook — readWorkbook", () => {
  it("lit la feuille nommée en tableau de tableaux, cellules vides → null", async () => {
    const buf = await buildXlsx("P&L", [["bu", "cas"], ["Réseau", 100], [null, 50]]);
    const wb = await readWorkbook(buf);
    expect(wb.SheetNames).toContain("P&L");
    const rows = wb.sheets["P&L"];
    expect(rows[0]).toEqual(["bu", "cas"]);
    expect(rows[1]).toEqual(["Réseau", 100]);
    expect(rows[2][0]).toBe(null);
  });
});

describe("parsers migrés (async, exceljs)", () => {
  it("parsePnl mappe les colonnes par en-tête", async () => {
    const buf = await buildXlsx("P&L", [
      ["BU", "Fournisseur", "CAS", "CAS N-1", "MB", "AM"],
      ["Réseau", "Cisco", 1000, 800, 300, "A. Koné"],
      ["Cloud", "AWS", 2000, 1500, 700, "B. Diarra"],
    ]);
    const out = await parsePnl(buf);
    expect(out.rowsOk).toBe(2);
    expect(out.orders[0]).toMatchObject({ bu: "Réseau", fournisseur: "Cisco", cas: 1000, casN1: 800, mb: 300, am: "A. Koné" });
    expect(out.orders[1]).toMatchObject({ bu: "Cloud", cas: 2000 });
  });

  it("parseLive lit la feuille et les montants", async () => {
    const buf = await buildXlsx("LIVE", [
      ["Client", "Montant", "Étape", "IDC", "D Prev", "MB%"],
      ["SGBCI", 5000000, "Négociation", "OPP-1", "2026-09-30", 22],
    ]);
    const out = await parseLive(buf);
    expect(out.rowsOk).toBe(1);
    expect(out.opportunities[0]).toMatchObject({ client: "SGBCI", montant: 5000000, etape: "Négociation" });
  });

  it("parseFacturationDf : feuille vide → sortie vide sans planter", async () => {
    const buf = await buildXlsx("Facturation", [["Date commande", "Date facturation", "Montant"]]);
    const out = await parseFacturationDf(buf);
    expect(out.invoices).toEqual([]);
    expect(out.rowsIn).toBe(0);
  });
});
