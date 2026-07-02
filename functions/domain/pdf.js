"use strict";

/**
 * Domain logic: board-pack PDF rendering for a briefing (BUILD_KIT.md §10 "exportPdf — callable —
 * board pack / one-pager PDF (pdfkit) → Storage (URL signée)").
 *
 * `buildBriefingPdf` is a PURE function in the sense that matters for testing: it takes an
 * ALREADY-CONSTRUCTED `PDFDocument` instance (from `pdfkit`) and a briefing data object, and only
 * writes content to that document — no Storage, no network, no Firestore. This means it CAN be
 * exercised for real in a unit test (functions/test/exportPdf.test.js: construct a real
 * `PDFDocument`, call this function, collect the piped bytes, assert a non-trivial buffer size).
 * The onCall handler in functions/index.js is the only place that touches Cloud Storage / signed
 * URLs (not unit-testable in this sandbox — no GCS credentials/network).
 */

/**
 * @param {import("pdfkit")} doc An already-constructed `PDFDocument` (caller owns `.pipe(...)`/
 *   `.end()` lifecycle — this function only writes content between construction and `.end()`).
 * @param {{
 *   period?: string,
 *   governingThought?: string,
 *   arguments?: Array<{title:string, body:string}>,
 *   content?: { narrative?: string, topOpportunities?: Array<{title:string,score:number}>,
 *               topThreats?: Array<{title:string,score:number}>, recommendations?: string[] },
 *   kpis?: object|null,
 * }} briefingData
 */
function buildBriefingPdf(doc, briefingData) {
  const b = briefingData || {};
  const args = Array.isArray(b.arguments) ? b.arguments : [];
  const content = b.content || {};
  const topOpportunities = Array.isArray(content.topOpportunities) ? content.topOpportunities : [];
  const topThreats = Array.isArray(content.topThreats) ? content.topThreats : [];
  const recommendations = Array.isArray(content.recommendations) ? content.recommendations : [];

  doc.font("Helvetica-Bold").fontSize(18).text("Briefing exécutif — Veille Stratégique", { align: "left" });
  doc.font("Helvetica").fontSize(10).fillColor("#666666").text(b.period || "Période non précisée");
  doc.moveDown(1);
  doc.fillColor("#000000");

  doc.font("Helvetica-Bold").fontSize(11).text("Idée directrice (pyramide de Minto)");
  doc.font("Helvetica").fontSize(11).text(b.governingThought || "—");
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(11).text("Les 3 arguments");
  doc.moveDown(0.3);
  for (const a of args) {
    doc.font("Helvetica-Bold").fontSize(10).text(a.title || "—");
    doc.font("Helvetica").fontSize(10).text(a.body || "—");
    doc.moveDown(0.4);
  }
  doc.moveDown(0.6);

  doc.font("Helvetica-Bold").fontSize(11).text("3 opportunités majeures");
  doc.font("Helvetica").fontSize(10);
  if (topOpportunities.length === 0) {
    doc.text("—");
  } else {
    for (const o of topOpportunities) doc.text(`• ${o.title} (${o.score})`);
  }
  doc.moveDown(0.6);

  doc.font("Helvetica-Bold").fontSize(11).text("3 menaces à traiter");
  doc.font("Helvetica").fontSize(10);
  if (topThreats.length === 0) {
    doc.text("—");
  } else {
    for (const t of topThreats) doc.text(`• ${t.title} (${t.score})`);
  }
  doc.moveDown(0.6);

  if (b.kpis && typeof b.kpis === "object") {
    doc.font("Helvetica-Bold").fontSize(11).text("KPIs du board");
    doc.font("Helvetica").fontSize(10);
    for (const [k, v] of Object.entries(b.kpis)) {
      if (v !== null && typeof v === "object") continue; // skip nested objects — one-pager stays terse
      doc.text(`${k}: ${v}`);
    }
    doc.moveDown(0.6);
  }

  doc.font("Helvetica-Bold").fontSize(11).text("Recommandations au comité");
  doc.font("Helvetica").fontSize(10);
  if (recommendations.length === 0) {
    doc.text("—");
  } else {
    recommendations.forEach((r, i) => doc.text(`${i + 1}. ${r}`));
  }
}

module.exports = { buildBriefingPdf };
