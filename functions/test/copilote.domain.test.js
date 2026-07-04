import { describe, it, expect } from "vitest";

describe("Copilote — prompt builders (reuse contexte veille)", () => {
  it("buildCvpPrompt ancre sur les faits du compte (anti-générique) et garde le PESTEL en simple angle", async () => {
    const { buildCvpPrompt } = await import("../domain/copilote.js");
    const p = buildCvpPrompt({ compte: "SGCI", secteur: "Banque", enjeux: ["conformité PASSI"], whitespace: ["SOC managé"], deals: [{ titre: "OPP-1 — 50 000 000 XOF (Négociation)" }], casTotal: 120000000, pestel: [{ axe: "Légal", texte: "décret 2021-917 audits triennaux" }], preuves: ["BCEAO"] });
    expect(p).toContain("SGCI");
    expect(p).toContain("SOC managé"); // whitespace réel injecté
    expect(p).toContain("OPP-1 — 50 000 000 XOF"); // deal réel nommé
    expect(p).toContain("INTERDIT"); // directive anti-générique
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

describe("Copilote — chiffrage & déclencheurs de veille dans factBase (via prompts)", () => {
  it("buildCvpPrompt chiffre la next best offer (montant d'ancrage) et surface les signaux du compte", async () => {
    const { buildCvpPrompt } = await import("../domain/copilote.js");
    const p = buildCvpPrompt({
      compte: "BRVM", whitespace: ["SOC managé"],
      recommendation: { offre: "SOC managé", csPct: 62, montantEstime: 45000000 },
      signauxCompte: [{ titre: "AO refonte SI à la BRVM" }],
      historique: [{ offre: "ICT", cas: 120000000, firstYear: 2021, lastYear: 2024 }],
    });
    expect(p).toContain("SOC managé");
    expect(p).toContain("62%"); // affinité cross-sell
    expect(p).toMatch(/45\D000\D000\D?XOF/); // montant d'ancrage chiffré (séparateur Intl fr-FR)
    expect(p).toContain("montant d'ancrage à viser");
    expect(p).toContain("AO refonte SI à la BRVM"); // déclencheur de veille rattaché
    expect(p).toMatch(/120\D000\D000\D?XOF réalisés/); // historique chiffré exploité
  });
});

describe("Copilote — agent planAction (plan d'action daté 90 j)", () => {
  it("buildPlanActionPrompt impose une séquence datée ancrée sur les faits", async () => {
    const { buildPlanActionPrompt } = await import("../domain/copilote.js");
    const p = buildPlanActionPrompt({ compte: "SGCI", recommendation: { offre: "SOC managé", csPct: 50, montantEstime: 30000000 } });
    expect(p).toContain("90 prochains jours");
    expect(p).toContain('"plan"');
    expect(p).toContain("0–30 jours");
    expect(p).toContain("INTERDIT"); // directive anti-générique
    expect(p).toMatch(/30\D000\D000\D?XOF/); // chiffrage next best offer injecté
  });
  it("parsePlanActionResponse : quand coercé, actions sans libellé écartées, bornées à 6, null si vide", async () => {
    const { parsePlanActionResponse } = await import("../domain/copilote.js");
    const r = parsePlanActionResponse({
      plan: [
        { quand: "0–30 jours", action: "RDV cadrage SOC", objet: "SOC managé", preuve: "62% d'affinité" },
        { quand: "n'importe", action: "Chiffrer l'offre", objet: "SOC managé", preuve: "" }, // quand invalide → Continu
        { action: "" }, // sans action → écarté
        ...Array.from({ length: 8 }, (_, i) => ({ quand: "Continu", action: `A${i}`, objet: "x", preuve: "y" })),
      ],
    });
    expect(r.plan.length).toBe(6); // borné
    expect(r.plan[0]).toMatchObject({ quand: "0–30 jours", action: "RDV cadrage SOC", objet: "SOC managé" });
    expect(r.plan[1].quand).toBe("Continu"); // coercition enum
    expect(parsePlanActionResponse({ plan: [] })).toBeNull();
    expect(parsePlanActionResponse(null)).toBeNull();
  });
});
