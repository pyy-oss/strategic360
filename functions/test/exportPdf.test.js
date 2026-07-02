"use strict";

/**
 * Test for functions/domain/pdf.js (BUILD_KIT.md §10 "exportPdf — board pack / one-pager PDF
 * (pdfkit)"). Unlike the Vertex AI-backed domain modules, THIS one can be verified for real: it
 * constructs an actual `PDFDocument` (pdfkit), calls `buildBriefingPdf` against it, collects the
 * piped bytes into a Buffer, and asserts the result is a valid, non-trivial PDF — no Cloud
 * Storage / network access required.
 *
 * Run: npx vitest run test/exportPdf.test.js
 */

import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { buildBriefingPdf } from "../domain/pdf.js";

function renderToBuffer(briefingData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    buildBriefingPdf(doc, briefingData);
    doc.end();
  });
}

const SAMPLE_BRIEFING = {
  period: "semaine du 30/06/2026",
  governingThought:
    "Neurones doit basculer son mix vers le récurrent (cyber & managed) et la souveraineté, en capturant la vague de financements réglementaires.",
  arguments: [
    { title: "1. La demande est là", body: "Réglementation (ARTCI/BCEAO), financements (BAD 200 M$)." },
    { title: "2. Nous pouvons gagner", body: "Expertise cyber, certifications, références bancaires." },
    { title: "3. Il faut agir vite", body: "Pressions fournisseurs (EOL, rebates) : fenêtre limitée." },
  ],
  content: {
    narrative: "Le trimestre est porté par une fenêtre d'opportunités réglementaires et de financement.",
    topOpportunities: [
      { title: "Programme digitalisation BAD", score: 91 },
      { title: "RFP SD-WAN Orange CI", score: 76 },
      { title: "Conformité cyber BCEAO", score: 72 },
    ],
    topThreats: [
      { title: "EOL Cisco", score: 78 },
      { title: "Tarifs Fortinet +8%", score: 65 },
      { title: "Nouvel entrant low-cost", score: 58 },
    ],
    recommendations: [
      "Constituer un consortium pour capter le programme BAD (200 M$).",
      "Accélérer l'industrialisation du SOC managé.",
      "Sécuriser le sourcing avant l'EOL Cisco.",
    ],
  },
  kpis: { menacesTotal: 4, menacesTraitees: 1, opportunites: 6, tti: null },
};

describe("buildBriefingPdf", () => {
  it("renders a non-trivial PDF buffer from a complete briefing without throwing", async () => {
    const buffer = await renderToBuffer(SAMPLE_BRIEFING);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // A one-pager with this much text easily clears a few KB; guards against a near-empty/broken render.
    expect(buffer.length).toBeGreaterThan(1500);
    // PDF files start with the "%PDF-" magic header.
    expect(buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders without throwing when given a minimal/empty briefing (missing lists/kpis)", async () => {
    const buffer = await renderToBuffer({ period: "x", governingThought: "y" });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders without throwing for a totally empty briefing object", async () => {
    const buffer = await renderToBuffer({});
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(200);
  });
});
