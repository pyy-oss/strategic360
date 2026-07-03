import { describe, it, expect } from "vitest";

describe("Copilote — prompt builders (reuse contexte veille)", () => {
  it("buildCvpPrompt injecte le PESTEL fourni sans le régénérer", async () => {
    const { buildCvpPrompt } = await import("../domain/copilote.js");
    const p = buildCvpPrompt({ compte: "SGCI", secteur: "Banque", enjeux: ["conformité PASSI"], whitespace: ["SOC managé"], pestel: [{ axe: "Légal", texte: "décret 2021-917 audits triennaux" }], preuves: ["BCEAO"] });
    expect(p).toContain("SGCI");
    expect(p).toContain("décret 2021-917");
    expect(p).toContain("à EXPLOITER, pas à réécrire");
    expect(p).toContain('"differenciateurs"');
  });
  it("buildRedactionPrompt applique canal/ton et interdit l'invention", async () => {
    const { buildRedactionPrompt } = await import("../domain/copilote.js");
    const p = buildRedactionPrompt({ kind: "relance", canal: "whatsapp", ton: "Chaleureux", compte: "Orange CI", contexte: "" });
    expect(p).toContain("WhatsApp");
    expect(p).toContain("chaleureux");
    expect(p).toContain("indique clairement ce qu'il manque");
  });
});

describe("Copilote — parsers (coercition, jamais d'undefined)", () => {
  it("parseProspectionResponse : chaleur coercée, cibles sans nom écartées, null si vide", async () => {
    const { parseProspectionResponse } = await import("../domain/copilote.js");
    const r = parseProspectionResponse({ cibles: [
      { nom: "NSIA Banque", angle: "refonte SI", accroche: "-30% incidents", chaleur: "Brûlant" },
      { angle: "orpheline" },
    ] });
    expect(r.cibles).toHaveLength(1);
    expect(r.cibles[0].chaleur).toBe("Froid"); // valeur invalide → défaut
    expect(parseProspectionResponse({ cibles: [] })).toBeNull();
    expect(parseProspectionResponse(null)).toBeNull();
  });
  it("parseTriennalResponse : an coercé, roadmap filtrée", async () => {
    const { parseTriennalResponse } = await import("../domain/copilote.js");
    const r = parseTriennalResponse({ roadmap: [
      { an: "An 5", titre: "Consolider", offres: ["support", 3], jalon: "SLA signé" },
      { an: "An 2", offres: [] },
    ] });
    expect(r.roadmap[0].an).toBe("An 1"); // invalide → défaut
    expect(r.roadmap[0].offres).toEqual(["support"]);
  });
  it("parsePlanCompteResponse : horizon/niveau coercés, null si vide", async () => {
    const { parsePlanCompteResponse } = await import("../domain/copilote.js");
    const r = parsePlanCompteResponse({
      actions: [{ libelle: "COPIL trimestriel", horizon: "Toujours" }],
      risques: [{ r: "sponsor unique", m: "multiplier les contacts", niv: "Critique" }],
    });
    expect(r.actions[0].horizon).toBe("Continu");
    expect(r.risques[0].niv).toBe("Moyen");
    expect(parsePlanCompteResponse({})).toBeNull();
  });
  it("parseChatResponse / parseRedactionResponse : null si inexploitable", async () => {
    const { parseChatResponse, parseRedactionResponse } = await import("../domain/copilote.js");
    expect(parseChatResponse({ reply: " ok " }).reply).toBe("ok");
    expect(parseChatResponse({})).toBeNull();
    expect(parseRedactionResponse({ variantes: [{ label: "douce", objet: "", corps: "Bonjour…" }] }).variantes).toHaveLength(1);
    expect(parseRedactionResponse({ variantes: [{ corps: "" }] })).toBeNull();
  });

  it("parseProspectionResponse : cible sans source → chaleur forcée à Froid, source exposée, borné à 4", async () => {
    const { parseProspectionResponse } = await import("../domain/copilote.js");
    const r = parseProspectionResponse({ cibles: [
      { nom: "Profil banque UEMOA", angle: "a", accroche: "b", chaleur: "Chaud" }, // pas de source → Froid
      { nom: "Orange CI", source: "Signal WAN Orange", angle: "a", accroche: "b", chaleur: "Chaud" },
      { nom: "C3", source: "s", chaleur: "Tiède" }, { nom: "C4", source: "s" }, { nom: "C5", source: "s" },
    ]});
    expect(r.cibles).toHaveLength(4); // borné à 4
    expect(r.cibles[0].chaleur).toBe("Froid"); // non sourcée
    expect(r.cibles[0].source).toBe("");
    expect(r.cibles[1].chaleur).toBe("Chaud"); // sourcée → conservée
    expect(r.cibles[1].source).toBe("Signal WAN Orange");
  });

  it("parseRedactionResponse : objet vidé hors e-mail, borné à 2 variantes", async () => {
    const { parseRedactionResponse } = await import("../domain/copilote.js");
    const three = { variantes: [
      { label: "A", objet: "Sujet", corps: "1" }, { label: "B", objet: "Sujet2", corps: "2" }, { label: "C", objet: "S3", corps: "3" },
    ]};
    const wa = parseRedactionResponse(three, { canal: "whatsapp" });
    expect(wa.variantes).toHaveLength(2); // borné à 2
    expect(wa.variantes.every((v) => v.objet === "")).toBe(true); // pas d'objet hors e-mail
    const mail = parseRedactionResponse(three, { canal: "email" });
    expect(mail.variantes[0].objet).toBe("Sujet"); // objet conservé en e-mail
  });
});
