import { describe, it, expect } from "vitest";

describe("PR E — rôle système copilote paramétrable (non-régression)", () => {
  it("sans systemRole == défaut Neurones ; un systemRole custom remplace le rôle dans le prompt", async () => {
    const { buildCvpPrompt, NT_ROLE } = await import("../domain/copilote.js");
    // Défaut (aucun systemRole) → NT_ROLE présent.
    const def = buildCvpPrompt({ compte: "SGCI" });
    expect(def).toContain(NT_ROLE);
    // systemRole custom → il remplace, NT_ROLE ne fuit plus.
    const custom = buildCvpPrompt({ compte: "Cabinet X", systemRole: "Tu es le copilote commercial de Cabinet X (avocats d'affaires, Paris)." });
    expect(custom).toContain("Cabinet X (avocats d'affaires, Paris)");
    expect(custom).not.toContain(NT_ROLE);
  });

  it("buildSystemRole génère un rôle depuis le profil (nom, secteur, géo, homonymes)", async () => {
    const { buildSystemRole } = await import("../domain/copilote.js");
    const r = buildSystemRole({ legalName: "ACME SAS", sector: "cabinet conseil", geographies: ["fr", "be"], homonyms: ["ACME Inc. USA"] });
    expect(r).toContain("ACME SAS");
    expect(r).toContain("cabinet conseil");
    expect(r).toContain("zone fr/be");
    expect(r).toContain("ACME Inc. USA");
    expect(r).toContain("JSON valide"); // consigne de format conservée
  });
});

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
    // Sans matière compte (aucun historique/deal/CAS) → repli « dire ce qui manque ».
    const p = buildRedactionPrompt({ kind: "relance", canal: "whatsapp", ton: "Chaleureux", contexte: "" });
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
  it("parsePlanCompteResponse (stratégie) : diagnostic/thèse/mouvements/risquesCachés coercés, null si vide", async () => {
    const { parsePlanCompteResponse } = await import("../domain/copilote.js");
    const r = parsePlanCompteResponse({
      diagnostic: "78% du CA sur ICT, CLOUD dormant",
      these: "Convertir la captation ICT en compte multi-offres",
      mouvements: [{ titre: "Ouvrir CLOUD", pourquoi: "dormance", impact: "≈ 45M", horizon: "Toujours" }],
      risquesCaches: [{ r: "mono-contact DSI", m: "multi-threader", niv: "Critique" }],
    });
    expect(r.diagnostic).toContain("78%");
    expect(r.mouvements[0].horizon).toBe("Continu"); // enum coercé
    expect(r.mouvements[0].impact).toBe("≈ 45M");
    expect(r.risquesCaches[0].niv).toBe("Moyen"); // enum coercé
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

  it("factBase rend la matière temporelle (date/so-what/offre déclenchée) des déclencheurs enrichis", async () => {
    const { buildCvpPrompt } = await import("../domain/copilote.js");
    const p = buildCvpPrompt({
      compte: "SGBCI",
      signauxCompte: [
        { titre: "Faille Fortinet exposée à la SGBCI", date: "2026-06-30", prox: "imminent", soWhat: "fenêtre pour un audit de vulnérabilité", offreLiee: "SOC managé" },
      ],
    });
    expect(p).toContain("Faille Fortinet exposée à la SGBCI");
    expect(p).toContain("2026-06-30"); // date surfacée → l'IA peut fonder le timing
    expect(p).toContain("so-what : fenêtre pour un audit de vulnérabilité");
    expect(p).toContain("offre à activer : SOC managé"); // boucle veille→vente explicitée
  });
});

describe("Copilote — battlecards confirmées vs marché (competitorBlock via prompts)", () => {
  it("sépare les concurrents confirmés sur le compte du complément marché, et interdit de présumer ce dernier présent", async () => {
    const { buildDealAnalysisPrompt } = await import("../domain/copilote.js");
    const p = buildDealAnalysisPrompt({
      compte: "NSIA", deals: [{ nom: "OPP-SOC", montant: 40000000, etape: "Négociation" }],
      battlecards: [{ competitor: "Talentys", positioning: "intégrateur local", weaknesses: ["prix"] }],
      battlecardsMarket: [{ competitor: "Atos", positioning: "gros intégrateur", weaknesses: ["proximité"] }],
    });
    expect(p).toContain("CONCURRENTS CONFIRMÉS SUR CE COMPTE");
    expect(p).toContain("Talentys");
    expect(p).toContain("CONCURRENTS FRÉQUENTS DU MARCHÉ");
    expect(p).toContain("Atos");
    expect(p).toMatch(/ne PAS les présenter comme le concurrent en place/i);
  });

  it("n'affiche que le complément marché quand aucun concurrent n'est confirmé sur le compte", async () => {
    const { buildDealAnalysisPrompt } = await import("../domain/copilote.js");
    const p = buildDealAnalysisPrompt({
      compte: "X", deals: [{ nom: "OPP", montant: 1, etape: "x" }],
      battlecards: [],
      battlecardsMarket: [{ competitor: "Atos", positioning: "gros intégrateur" }],
    });
    expect(p).not.toContain("CONCURRENTS CONFIRMÉS SUR CE COMPTE");
    expect(p).toContain("CONCURRENTS FRÉQUENTS DU MARCHÉ");
    expect(p).toContain("Atos");
  });
});

describe("Copilote — plan d'action réellement daté & NO_GENERIC déterministe (audit 2026-07)", () => {
  it("parsePlanActionResponse : normalise S+n / J+n en date ISO depuis today, non normalisable → \"\"", async () => {
    const { parsePlanActionResponse } = await import("../domain/copilote.js");
    const ctx = { today: "2026-07-07" };
    const out = parsePlanActionResponse({
      plan: [
        { quand: "0–30 jours", echeance: "S+2", action: "Relancer le DSI" },       // +14 j → 2026-07-21
        { quand: "0–30 jours", echeance: "J+10", action: "Envoyer la proposition" }, // +10 j → 2026-07-17
        { quand: "30–60 jours", echeance: "2026-08-15", action: "RDV cadrage" },     // ISO conservée
        { quand: "Continu", echeance: "la semaine prochaine", action: "Veille compte" }, // non normalisable → ""
      ],
    }, ctx);
    expect(out.plan[0].echeance).toBe("2026-07-21");
    expect(out.plan[1].echeance).toBe("2026-07-17");
    expect(out.plan[2].echeance).toBe("2026-08-15");
    expect(out.plan[3].echeance).toBe("");
    // Le bucket « quand » découle de l'échéance datée.
    expect(out.plan[2].quand).toBe("30–60 jours");
  });

  it("parseCvpResponse : annote « (chiffre à vérifier) » les montants XOF hors valueModel", async () => {
    const { parseCvpResponse } = await import("../domain/copilote.js");
    const ctx = { valueModel: { casTotal: 120000000, nextOffer: { montant: 45000000 }, whitespaceValue: [] } };
    const out = parseCvpResponse(
      { message: "Nous visons 45 000 000 XOF sur le SOC, et un potentiel de 900 000 000 XOF au global.", differenciateurs: [] },
      ctx
    );
    // 45 M appartient au valueModel → intact ; 900 M inventé → annoté.
    expect(out.message).toContain("45 000 000 XOF");
    expect(out.message).toMatch(/900 000 000 XOF \(chiffre à vérifier\)/);
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

describe("Copilote — corrections audit (rédaction ancrée + next best offer honnête)", () => {
  it("buildRedactionPrompt s'ancre sur les faits du compte + anti-générique quand il y a de la matière", async () => {
    const { buildRedactionPrompt } = await import("../domain/copilote.js");
    const p = buildRedactionPrompt({ compte: "BRVM", canal: "email", ton: "Direct", kind: "relance",
      historique: [{ offre: "ICT", cas: 120000000, firstYear: 2021, lastYear: 2024 }], casTotal: 120000000 });
    expect(p).toContain("INTERDIT"); // NO_GENERIC injecté
    expect(p).toContain("Faits réels du compte");
    expect(p).toContain("citer AU MOINS un fait réel du compte");
    // sans matière compte → pas d'ancrage forcé, garde le repli « indique ce qui manque »
    const g = buildRedactionPrompt({ canal: "whatsapp", ton: "Direct", kind: "prise de contact" });
    expect(g).toContain("indique clairement ce qu'il manque");
    expect(g).not.toContain("Faits réels du compte");
  });

  it("factBase : next best offer sans affinité (csPct=0) devient PISTE DE QUALIFICATION, pas « à prioriser »", async () => {
    const { buildCvpPrompt } = await import("../domain/copilote.js");
    const cold = buildCvpPrompt({ compte: "X", recommendation: { offre: "SOC managé", csPct: 0, montantEstime: 0 } });
    expect(cold).toContain("PISTE DE QUALIFICATION");
    expect(cold).not.toContain("À prioriser dans la recommandation");
    const warm = buildCvpPrompt({ compte: "X", recommendation: { offre: "SOC managé", csPct: 62, montantEstime: 0 } });
    expect(warm).toContain("NEXT BEST OFFER");
    expect(warm).toContain("À prioriser dans la recommandation");
  });
});

describe("Copilote — CVP : différenciateurs source unique + angle métier (audit 2026-07)", () => {
  it("buildCvpPrompt mobilise NT_DIFFERENCIATEURS (dont Neurones Academy) et l'angle innovation", async () => {
    const { buildCvpPrompt } = await import("../domain/copilote.js");
    const p = buildCvpPrompt({ compte: "NSIA", secteur: "Assurance", whitespace: ["Data/IA"] });
    expect(p).toContain("Neurones Academy"); // Academy n'est plus oubliée de l'argumentaire
    expect(p).toContain("WALLIX Premier"); // source unique des différenciateurs
    expect(p).toContain("ANGLE MÉTIER"); // lentille innovation (pas que cloud/cyber)
  });
});

describe("Copilote — profondeur : données réelles branchées + nouveaux agents (audit 2026-07)", () => {
  const richCtx = {
    compte: "SGCI", secteur: "Banque", tier: "Stratégique",
    casTotal: 200000000, pipelinePondere: 80000000, wins: 3,
    historique: [{ offre: "ICT", cas: 150000000, firstYear: 2021, lastYear: 2024 }],
    whitespace: ["SOC managé", "Data/IA"],
    deals: [{ nom: "OPP-9", montant: 60000000, etape: "Négociation", probability: 0.6, closingDate: "2026-09-30" }],
    recommendation: { offre: "SOC managé", csPct: 55, montantEstime: 45000000 },
    battlecards: [{ competitor: "Atos", positioning: "gros intégrateur", strengths: ["notoriété"], weaknesses: ["prix", "proximité locale"], ourWinThemes: ["présence Abidjan"], objectionHandling: ["délais tenus"] }],
    winStats: { global: 58, dealsTotal: 12, byCompetitor: [{ competitor: "Atos", winPct: 40, deals: 5 }], lessons: [{ result: "win", competitor: "Atos", lesson: "proximité décisive" }] },
    valueModel: { casTotal: 200000000, pipelinePondere: 80000000, nextOffer: { offre: "SOC managé", montant: 45000000, csPct: 55 }, whitespaceValue: [{ offre: "SOC managé", montant: 45000000 }, { offre: "Data/IA", montant: 30000000 }], whitespacePotential: 75000000 },
    contacts: [{ nom: "M. Kone", role: "DSI", posture: "Favorable" }],
    today: "2026-07-05",
  };

  it("factBase enrichit les deals (montant/étape/proba/closing) via un prompt qui les cite", async () => {
    const { buildMeddicPrompt } = await import("../domain/copilote.js");
    const p = buildMeddicPrompt(richCtx);
    expect(p).toContain("OPP-9");
    expect(p).toMatch(/60\D000\D000\D?XOF/);
    expect(p).toContain("stade Négociation");
    expect(p).toContain("closing 2026-09-30");
  });

  it("les blocs concurrentiel / win-stats / valeur s'injectent dans les agents concernés", async () => {
    const { buildDealAnalysisPrompt, buildBusinessCasePrompt } = await import("../domain/copilote.js");
    const deal = buildDealAnalysisPrompt(richCtx);
    expect(deal).toContain("INTELLIGENCE CONCURRENTIELLE");
    expect(deal).toContain("Atos");
    expect(deal).toContain("HISTORIQUE DE VICTOIRE");
    expect(deal).toContain("58%");
    const bc = buildBusinessCasePrompt(richCtx);
    expect(bc).toContain("MODÈLE DE VALEUR CHIFFRÉ");
    expect(bc).toMatch(/45\D000\D000\D?XOF/);
    expect(bc).toContain("À CITER TELS QUELS");
  });

  it("parseMeddicResponse : coercitions, trous/actions bornés, défauts « à qualifier »", async () => {
    const { parseMeddicResponse } = await import("../domain/copilote.js");
    const r = parseMeddicResponse({ metrics: "-20% incidents", identifiedPain: "conformité", score: 150, trous: ["budget", 3], prochainesActions: ["identifier le sponsor"] });
    expect(r.score).toBe(100); // borné 0-100
    expect(r.economicBuyer).toBe("à identifier"); // défaut honnête
    expect(r.trous).toEqual(["budget"]);
    expect(parseMeddicResponse(null)).toBeNull();
  });

  it("parseDealAnalysisResponse : probabilité coercée, objections/plan structurés", async () => {
    const { parseDealAnalysisResponse } = await import("../domain/copilote.js");
    const r = parseDealAnalysisResponse({ deal: "OPP-9 60M", concurrent: "Atos", probabilite: "Certaine", winThemes: ["proximité"], objections: [{ objection: "prix", reponse: "TCO" }], planClosing: [{ quand: "S+1", action: "démo" }] });
    expect(r.probabilite).toBe("Moyenne"); // invalide → défaut
    expect(r.objections[0].reponse).toBe("TCO");
    expect(r.planClosing).toHaveLength(1);
    expect(parseDealAnalysisResponse({})).toBeNull();
  });

  it("parseBusinessCaseResponse / parseSequenceResponse / parseStakeholdersResponse : structures et bornes", async () => {
    const { parseBusinessCaseResponse, parseSequenceResponse, parseStakeholdersResponse } = await import("../domain/copilote.js");
    const bc = parseBusinessCaseResponse({ synthese: "75M adressables", gains: [{ levier: "SOC managé", montant: "45M", base: "panier" }], potentielTotal: "75M" });
    expect(bc.gains).toHaveLength(1);
    const seq = parseSequenceResponse({ touches: [{ jour: "J0", canal: "Fax", objectif: "accroche", message: "Bonjour…" }] });
    expect(seq.touches[0].canal).toBe("E-mail"); // canal invalide → défaut
    const stk = parseStakeholdersResponse({ parties: [{ role: "DSI", pouvoir: "Total", posture: "Ami", strategie: "cultiver" }], champion: "M. Kone" });
    expect(stk.parties[0].pouvoir).toBe("Moyen"); // coercé
    expect(stk.parties[0].posture).toBe("Inconnu"); // coercé
    expect(parseStakeholdersResponse({ parties: [] })).toBeNull();
  });

  it("brief & séquence sont datés/ancrés (today) et sans invention", async () => {
    const { buildBriefPrompt, buildSequencePrompt } = await import("../domain/copilote.js");
    expect(buildBriefPrompt(richCtx)).toContain("NOTE DE BRIEF");
    const seq = buildSequencePrompt(richCtx);
    expect(seq).toContain("2026-07-05"); // ancrage temporel
    expect(seq).toContain("MULTI-TOUCH");
  });
});

describe("Copilote — stratège de vente : moteur d'analyse + persona (audit 2026-07)", () => {
  const stratCtx = {
    compte: "SGCI", casTotal: 300000000, today: "2026-07-05",
    historique: [
      { offre: "ICT", cas: 250000000, firstYear: 2020, lastYear: 2024 },
      { offre: "CLOUD", cas: 50000000, firstYear: 2021, lastYear: 2022 },
    ],
    deals: [{ nom: "Refonte SI", montant: 60000000, probability: 0.1, closingDate: "2025-01-01", etape: "1-Qualification" }],
    valueModel: { whitespacePotential: 75000000 },
  };

  it("le DIAGNOSTIC pré-calculé détecte concentration, dormance et deal fantôme (données interprétées)", async () => {
    const { buildPlanComptePrompt } = await import("../domain/copilote.js");
    const p = buildPlanComptePrompt(stratCtx);
    expect(p).toContain("DIAGNOSTIC PRÉ-CALCULÉ");
    expect(p).toContain("83% du CA sur « ICT »"); // 250M/300M
    expect(p).toMatch(/CLOUD \(dernier achat 2022/); // dormante (≥2 ans avant 2026), annotée de sa part de CA
    expect(p).toMatch(/Refonte SI.*(DÉPASSÉE|point mort)/); // deal probability 10% + closing passée
    expect(p).toMatch(/75\D000\D000\D?XOF/); // réserve de valeur
  });

  it("la persona STRATÈGE + anti-verbiage sont injectées et exigent l'analyse (pas la restitution)", async () => {
    const { buildPlanComptePrompt, buildCvpPrompt, buildDealAnalysisPrompt } = await import("../domain/copilote.js");
    for (const p of [buildPlanComptePrompt(stratCtx), buildCvpPrompt(stratCtx), buildDealAnalysisPrompt(stratCtx)]) {
      expect(p).toContain("STRATÈGE DE VENTE");
      expect(p).toContain("NE LES LUI RÉCITE PAS");
      expect(p).toContain("INTERDIT ABSOLU");
    }
  });

  it("la stratégie de compte demande diagnostic/thèse/mouvements tranchés (pas une to-do list)", async () => {
    const { buildPlanComptePrompt } = await import("../domain/copilote.js");
    const p = buildPlanComptePrompt(stratCtx);
    expect(p).toContain('"diagnostic"');
    expect(p).toContain('"these"');
    expect(p).toContain('"mouvements"');
    expect(p).toContain("LE coup à jouer maintenant");
  });

  it("garde-fous anti-2/10 : interdiction des références inventées + sens des proportions (exposition %)", async () => {
    const { buildCvpPrompt, buildMeddicPrompt } = await import("../domain/copilote.js");
    const p = buildCvpPrompt(stratCtx);
    // Fix 2 : anti-invention des références (BCEAO/régulateurs…).
    expect(p).toContain("RÉFÉRENCES INTERDITES SANS PREUVE");
    expect(p).toContain("NE REVENDIQUE AUCUNE référence");
    // Fix 3 : sens des proportions + anti-dramatisation.
    expect(p).toContain("SENS DES PROPORTIONS");
    expect(p).toContain("cheval de Troie"); // cliché explicitement banni
    // exposition du pipeline exprimée en % du CA (60M sur 300M = 20%). La CVP est désormais tournée
    // CLIENT (plus de diagnostic interne) : l'exposition est portée par les agents à socle diagnostique.
    expect(buildMeddicPrompt(stratCtx)).toContain("20% du CA réalisé");
  });

  it("DEAL CIBLE : dealAnalysis & MEDDIC ciblent explicitement le plus gros deal (Phase 1 VICTOIRE)", async () => {
    const { buildDealAnalysisPrompt, buildMeddicPrompt } = await import("../domain/copilote.js");
    const ctx = {
      compte: "SGCI",
      deals: [
        { nom: "Petit lot support", montant: 12000000, etape: "Qualification" },
        { nom: "Refonte SI SGCI", montant: 480000000, etape: "Négociation", closingDate: "2026-11-30" },
      ],
    };
    for (const p of [buildDealAnalysisPrompt(ctx), buildMeddicPrompt(ctx)]) {
      expect(p).toContain("DEAL CIBLE");
      expect(p).toContain("Refonte SI SGCI"); // le plus gros, pas le petit lot
    }
  });

  it("garde-fous GÉNÉRALISÉS à tous les agents ancrés (offre bidon + refs + proportions)", async () => {
    const mod = await import("../domain/copilote.js");
    const agents = [mod.buildTriennalPrompt, mod.buildPlanActionPrompt, mod.buildDealAnalysisPrompt, mod.buildBusinessCasePrompt, mod.buildMeddicPrompt, mod.buildBriefPrompt, mod.buildStakeholdersPrompt];
    for (const build of agents) {
      const p = build(stratCtx);
      expect(p).toContain("OFFRES RÉELLES UNIQUEMENT"); // anti offre fourre-tout
      expect(p).toContain("RÉFÉRENCES INTERDITES SANS PREUVE"); // anti-invention refs
      expect(p).toContain("SENS DES PROPORTIONS"); // calibrage
    }
    // MEDDIC et Brief reçoivent maintenant le diagnostic pré-calculé (exposition %).
    expect(mod.buildMeddicPrompt(stratCtx)).toContain("20% du CA réalisé");
    expect(mod.buildBriefPrompt(stratCtx)).toContain("20% du CA réalisé");
  });

  it("CVP recentrée CLIENT (pas un mémo interne) + mots dramatiques bannis + matérialité", async () => {
    const { buildCvpPrompt, buildMeddicPrompt } = await import("../domain/copilote.js");
    const marginalCtx = {
      compte: "SGCI", casTotal: 300000000, today: "2026-07-05",
      historique: [
        { offre: "ICT", cas: 288000000, firstYear: 2020, lastYear: 2024 },
        { offre: "FORMATION", cas: 1900000, firstYear: 2022, lastYear: 2023 }, // 0,6% → marginale
      ],
      valueModel: { whitespacePotential: 75000000 },
    };
    const p = buildCvpPrompt(marginalCtx);
    // Recentrage client (le vrai bug : c'était un mémo interne « solder nos dossiers fantômes »).
    expect(p).toContain("PRÉSENTÉ AU CLIENT");
    expect(p).toContain("POINT DE VUE CLIENT");
    expect(p).toContain("INTERDIT dans le message");
    // Liste noire de mots dramatiques.
    expect(p).toContain("MOTS BANNIS");
    expect(p).toContain("tarissement");
    // Matérialité : FORMATION dormante taguée « marginale, accessoire » — dans le socle diagnostique
    // (agents internes), plus dans la CVP client-facing.
    expect(buildMeddicPrompt(marginalCtx)).toContain("FORMATION (dernier achat 2023 — marginale, accessoire)");
    expect(p).toContain("MATÉRIALITÉ");
  });

  it("le Chat porte les mêmes garde-fous (refs, proportions, offre réelle)", async () => {
    const { buildChatSystem } = await import("../domain/copilote.js");
    const sys = buildChatSystem({ ecran: "Copilote", compte: { nom: "SGCI", casTotal: 300000000, deals: stratCtx.deals, historique: stratCtx.historique, today: "2026-07-05", valueModel: stratCtx.valueModel } });
    expect(sys).toContain("GARDE-FOUS");
    expect(sys).toContain("n'invente AUCUNE référence");
    expect(sys).toContain("offre fourre-tout");
  });
});

describe("Copilote — désambiguïsation de marque dans les contenus sortants (audit 2026-07)", () => {
  it("NT_ROLE nomme la raison sociale complète et écarte les homonymes ; l'e-mail signe identifiant", async () => {
    const { NT_ROLE, buildRedactionPrompt } = await import("../domain/copilote.js");
    expect(NT_ROLE).toContain("Neurones Technologies S.A.");
    expect(NT_ROLE).toContain("NEURONES"); // homonyme français explicitement écarté
    const mail = buildRedactionPrompt({ compte: "BCEAO", canal: "email", ton: "Direct", kind: "prise de contact", casTotal: 1 });
    expect(mail).toContain("raison sociale complète");
    expect(mail).toContain("Abidjan");
  });
});

describe("Levier waouh n°2 — agent Contenu marketing", () => {
  it("buildContenuPrompt injecte les signaux réels + différenciateurs, pas d'invention", async () => {
    const { buildContenuPrompt } = await import("../domain/copilote.js");
    const p = buildContenuPrompt({
      secteur: "Banque",
      signauxCompte: [{ titre: "La BCEAO durcit les exigences cyber", soWhat: "obligation PASSI" }],
      signaux: [{ titre: "Nouvelle vague de ransomware en UEMOA" }],
    });
    expect(p).toContain("BCEAO durcit les exigences cyber");
    expect(p).toContain("ransomware");
    expect(p).toContain("n'invente aucune actualité");
    expect(p).toMatch(/LinkedIn|Tribune/);
  });

  it("buildContenuPrompt sans signaux → consigne prudente, jamais de fausse actu", async () => {
    const { buildContenuPrompt } = await import("../domain/copilote.js");
    const p = buildContenuPrompt({ secteur: "Assurance" });
    expect(p).toContain("aucun signal de veille exploitable");
  });

  it("parseContenuResponse borne à 3 angles, format normalisé, hashtags coercés", async () => {
    const { parseContenuResponse } = await import("../domain/copilote.js");
    const out = parseContenuResponse({
      angles: [
        { format: "LinkedIn", titre: "Cyber-souveraineté", accroche: "Et si…", corps: "un vrai propos ici", differenciateur: "PASSI/ANSSI-CI", signalSource: "BCEAO", cta: "Échangeons", hashtags: ["cyber", "#uemoa", 42] },
        { format: "Tribune", titre: "Transfo", accroche: "x", corps: "propos 2", hashtags: [] },
        { format: "n'importe", titre: "t3", accroche: "y", corps: "propos 3" },
        { format: "LinkedIn", titre: "t4", accroche: "z", corps: "propos 4 en trop" },
      ],
    });
    expect(out.angles).toHaveLength(3); // borné
    expect(out.angles[0].hashtags).toEqual(["cyber", "#uemoa"]); // le 42 (non-string) écarté
    expect(out.angles[2].format).toBe("LinkedIn"); // format inconnu → défaut LinkedIn
  });

  it("parseContenuResponse : sans corps exploitable → null", async () => {
    const { parseContenuResponse } = await import("../domain/copilote.js");
    expect(parseContenuResponse({ angles: [{ titre: "vide" }] })).toBeNull();
    expect(parseContenuResponse({})).toBeNull();
  });
});
