import { describe, expect, it } from "vitest";
import {
  STAGE_TO_ETAPE,
  mapOrders,
  mapOpportunities,
  mapInvoices,
  mapBcLinesToSupplierRows,
  pickObjectives,
  pickCurrentFy,
  deriveBuBenchmark,
  deriveAccountValue,
  matchSignalsToAccount,
} from "../domain/nt360.js";
import { computeBcg, computeCasSummary, computePipeline, computePorterForces } from "../domain/quanti.js";

const FY = 2026;

describe("mapOrders", () => {
  it("routes cas into cas (N) or casN1 (N-1) by yearPo, other years contribute to neither", () => {
    const rows = mapOrders(
      [
        { bu: "ICT", am: "AM1", cas: 100, mb: 10, yearPo: 2026 },
        { bu: "ICT", am: "AM1", cas: 80, mb: 8, yearPo: 2025 },
        { bu: "ICT", am: "AM1", cas: 999, mb: 99, yearPo: 2019 },
      ],
      FY
    );
    expect(rows[0]).toMatchObject({ bu: "ICT", cas: 100, casN1: 0, mb: 10 });
    expect(rows[1]).toMatchObject({ cas: 0, casN1: 80, mb: 0 }); // mb only counted for current FY
    expect(rows[2]).toMatchObject({ cas: 0, casN1: 0, mb: 0 });
  });

  it("feeds computeBcg/computeCasSummary with correct N/N-1 growth", () => {
    const rows = mapOrders(
      [
        { bu: "ICT", cas: 150, mb: 20, yearPo: 2026 },
        { bu: "ICT", cas: 100, mb: 15, yearPo: 2025 },
      ],
      FY
    );
    const { casTotal, casN1Total } = computeCasSummary({ orders: rows });
    expect(casTotal).toBe(150);
    expect(casN1Total).toBe(100);
    const bcg = computeBcg({ orders: rows });
    expect(bcg).toHaveLength(1);
    expect(bcg[0].croissance).toBeCloseTo(0.5); // (150-100)/100
    expect(bcg[0].marge).toBe(20);
  });

  it("tolerates junk input", () => {
    expect(mapOrders(undefined, FY)).toEqual([]);
    expect(mapOrders([null, "x", {}], FY)).toHaveLength(1); // only the {} survives the object filter
  });
});

describe("mapOpportunities", () => {
  it("maps stage 6/7 exactly to Gagné/Perdu (win rate 6 vs 7) and amount to montant", () => {
    const opps = mapOpportunities([
      { client: "SONAPIE", amount: 100, stage: 6, oppId: "a" },
      { client: "BRVM", amount: 50, stage: 7, oppId: "b" },
      { client: "ORANGE", amount: 200, stage: 2, oppId: "c", closingDate: "2026-09-30", marginPct: 0.2 },
    ]);
    expect(opps[0].etape).toBe("Gagné");
    expect(opps[1].etape).toBe("Perdu");
    expect(opps[2]).toMatchObject({ etape: "Proposition", montant: 200, idc: "c", datePrev: "2026-09-30", mbPct: 0.2 });
    const { winRate } = computePipeline({ opportunities: opps });
    expect(winRate).toBe(0.5); // 1 won / 2 closed
  });

  it("falls back to the stageLabel's leading digit, unknown stages stay undefined", () => {
    const opps = mapOpportunities([
      { client: "X", amount: 10, stageLabel: "3-Négociation" },
      { client: "Y", amount: 10, stage: 42 },
    ]);
    expect(opps[0].etape).toBe(STAGE_TO_ETAPE[3]);
    expect(opps[1].etape).toBeUndefined(); // computePipeline applies its 0.3 default
  });
});

describe("mapInvoices", () => {
  it("keeps dateCommande null (absent from nt360) so the delay KRI stays honestly null", () => {
    const invoices = mapInvoices([{ amountHt: 1000, date: "2021-03-15" }]);
    expect(invoices[0]).toEqual({ dateCommande: null, dateFacturation: "2021-03-15", montant: 1000 });
  });
});

describe("mapBcLinesToSupplierRows", () => {
  it("builds fournisseur/cas pseudo-rows for Porter and drops supplier-less lines", () => {
    const rows = mapBcLinesToSupplierRows([
      { supplier: "WESTCON", amountXof: 1000 },
      { supplier: "", amountXof: 5 },
      { amountXof: 5 },
    ]);
    expect(rows).toEqual([{ fournisseur: "WESTCON", cas: 1000 }]);
    const { pouvoirFournisseurs } = computePorterForces({ orders: rows });
    expect(pouvoirFournisseurs).toBe(100);
  });
});

describe("pickObjectives / pickCurrentFy", () => {
  it("prefers the global objectives doc for the current fiscal year", () => {
    const obj = pickObjectives(
      [
        { fiscalYear: 2025, scope: "global", targetCas: 1 },
        { fiscalYear: 2026, scope: "bu", targetCas: 2 },
        { fiscalYear: 2026, scope: "global", targetCas: 12000000000, targetInvoiced: 10000000000, targetMargin: 2000000000 },
      ],
      2026
    );
    expect(obj).toMatchObject({ fiscalYear: 2026, targetCas: 12000000000 });
  });

  it("returns null when there are no objectives at all", () => {
    expect(pickObjectives([], 2026)).toBeNull();
    expect(pickObjectives(undefined, 2026)).toBeNull();
  });

  it("reads currentFy from whichever config doc carries it, with fallback", () => {
    expect(pickCurrentFy([{ matrix: {} }, { currentFy: 2026 }], 2030)).toBe(2026);
    expect(pickCurrentFy([], 2030)).toBe(2030);
  });
});

describe("computeGranularite (via mapOrders)", () => {
  it("decomposes growth by BU in raw XOF, sorted by delta descending, negatives allowed", async () => {
    const { computeGranularite } = await import("../domain/quanti.js");
    const rows = mapOrders(
      [
        { bu: "ICT", cas: 150, yearPo: 2026 },
        { bu: "ICT", cas: 100, yearPo: 2025 },
        { bu: "FORMATION", cas: 20, yearPo: 2026 },
        { bu: "FORMATION", cas: 60, yearPo: 2025 },
      ],
      2026
    );
    const gran = computeGranularite({ orders: rows });
    expect(gran).toEqual([
      { seg: "ICT", casN: 150, casN1: 100, delta: 50 },
      { seg: "FORMATION", casN: 20, casN1: 60, delta: -40 },
    ]);
    expect(computeGranularite({ orders: [] })).toEqual([]);
  });
});

describe("deriveCopiloteAccounts (empreinte comptes pour le Copilote)", () => {
  it("dérive historique (Gagné) / en cours / CAS / pipeline par client, dédupliqué par slug", async () => {
    const { deriveCopiloteAccounts } = await import("../domain/nt360.js");
    const orders = [
      { client: "SGCI", bu: "ICT", cas: 100 },
      { client: "SGCI", bu: "ICT", cas: 50 },
      { client: "Coris Bank", bu: "FORMATION", cas: 30 },
    ];
    const opps = [
      { client: "SGCI", bu: "FORMATION", stage: 6, amount: 200 },   // gagné → historique + win
      { client: "SGCI", bu: "ICT", stage: 2, amount: 400, weighted: 160, oppId: "OPP-1", stageLabel: "2-Montage", closingDate: "2026-09-30", probability: 40 }, // en cours
      { client: "SGCI", bu: "ICT", stage: 7, amount: 999 },          // perdu → ignoré
    ];
    const accts = deriveCopiloteAccounts(orders, opps);
    const sgci = accts.find((a) => a.slug === "sgci");
    expect(sgci.nom).toBe("SGCI");
    expect(sgci.casTotal).toBe(150);
    expect(sgci.pipelinePondere).toBe(160);
    expect(sgci.historique.map((h) => h.offre).sort()).toEqual(["FORMATION", "ICT"]); // ICT via order, FORMATION via opp gagnée
    expect(sgci.enCours).toEqual(["ICT"]);
    expect(accts.find((a) => a.slug === "coris-bank").casTotal).toBe(30);
  });

  it("expose les affaires gagnées (wins) et les opportunités réelles en cours (chiffrées, triées, bornées à 8)", async () => {
    const { deriveCopiloteAccounts } = await import("../domain/nt360.js");
    const opps = [
      { client: "SGCI", bu: "FORMATION", stage: 6, amount: 200 }, // gagné
      { client: "SGCI", bu: "CYBER", stage: 6, amount: 500 },     // gagné
      { client: "SGCI", bu: "ICT", stage: 3, amount: 400, oppId: "OPP-1", fp: "Refonte SI SGCI", stageLabel: "3-Négociation", closingDate: "2026-09-30", probability: 60 },
      { client: "SGCI", bu: "WAN", stage: 2, amount: 900, oppId: "OPP-2", stageLabel: "2-Montage" },
      { client: "SGCI", bu: "ICT", stage: 7, amount: 999 },       // perdu → ignoré
    ];
    const sgci = deriveCopiloteAccounts([], opps).find((a) => a.slug === "sgci");
    expect(sgci.wins).toBe(2);
    expect(sgci.opportunites).toHaveLength(2);
    // Triées par montant décroissant. LIBELLÉ HUMAIN : `fp` (fiche projet) si présent, sinon
    // « Opportunité <offre> » — jamais l'oppId (code technique), conservé en `ref` (traçabilité).
    expect(sgci.opportunites[0]).toMatchObject({ nom: "Opportunité WAN", ref: "OPP-2", montant: 900, etape: "2-Montage", bu: "WAN" });
    expect(sgci.opportunites[1]).toMatchObject({ nom: "Refonte SI SGCI", ref: "OPP-1", montant: 400, etape: "3-Négociation", closingDate: "2026-09-30", probability: 60 });
    // Jamais d'undefined : probability absente → null.
    expect(sgci.opportunites[0].probability).toBeNull();
  });

  it("résout le stade via stageLabel quand `stage` numérique est absent (deal sinon perdu du pipeline)", async () => {
    const { deriveCopiloteAccounts } = await import("../domain/nt360.js");
    const opps = [
      { client: "Orange CI", bu: "WAN", stageLabel: "3-Négociation", amount: 100, weighted: 40 }, // stage absent
      { client: "Orange CI", bu: "CYBER", stageLabel: "6-Gagné" }, // gagné via label
    ];
    const a = deriveCopiloteAccounts([], opps).find((x) => x.slug === "orange-ci");
    expect(a.pipelinePondere).toBe(40);
    expect(a.enCours).toEqual(["WAN"]);
    expect(a.wins).toBe(1);
  });

  it("weighted null/absent → repli amount*0.5 (Number(null)===0 ne doit pas compter un pipeline nul)", async () => {
    const { deriveCopiloteAccounts } = await import("../domain/nt360.js");
    const opps = [
      { client: "Coris", bu: "ICT", stage: 3, amount: 200, weighted: null },
      { client: "Coris", bu: "ICT", stage: 2, amount: 100 }, // weighted absent
    ];
    const a = deriveCopiloteAccounts([], opps).find((x) => x.slug === "coris");
    expect(a.pipelinePondere).toBe(150); // 200*0.5 + 100*0.5
  });

  it("nom purement non-latin → slug de repli déterministe (CAS non perdu), clients distincts non fusionnés", async () => {
    const { deriveCopiloteAccounts } = await import("../domain/nt360.js");
    const accts = deriveCopiloteAccounts(
      [{ client: "株式会社", bu: "ICT", cas: 80 }, { client: "会社银行", bu: "ICT", cas: 20 }],
      []
    );
    expect(accts).toHaveLength(2); // pas fusionnés dans une clé ""
    expect(accts.every((a) => a.slug && a.slug.startsWith("cpt-"))).toBe(true);
    expect(accts.reduce((s, a) => s + a.casTotal, 0)).toBe(100); // aucun CAS perdu
  });

  it("historique enrichi : CAS réalisé + plage d'années par offre, trié par CAS décroissant", async () => {
    const { deriveCopiloteAccounts } = await import("../domain/nt360.js");
    const orders = [
      { client: "SGCI", bu: "ICT", cas: 100, yearPo: 2023 },
      { client: "SGCI", bu: "ICT", cas: 200, yearPo: 2025 },
      { client: "SGCI", bu: "FORMATION", cas: 20, yearPo: 2022 },
    ];
    const sgci = deriveCopiloteAccounts(orders, []).find((a) => a.slug === "sgci");
    expect(sgci.historique[0]).toMatchObject({ offre: "ICT", cas: 300, orders: 2, firstYear: 2023, lastYear: 2025 });
    expect(sgci.historique[1]).toMatchObject({ offre: "FORMATION", cas: 20, firstYear: 2022, lastYear: 2022 });
  });

  it("collecte les account managers (am) et BU réels du compte (rattachement/cloisonnement)", async () => {
    const { deriveCopiloteAccounts } = await import("../domain/nt360.js");
    const a = deriveCopiloteAccounts(
      [{ client: "SGCI", bu: "ICT", cas: 10, am: "K. Diallo" }],
      [{ client: "SGCI", bu: "CYBER", stage: 2, amount: 100, am: "M. Traoré" }]
    ).find((x) => x.slug === "sgci");
    expect(a.ams.sort()).toEqual(["K. Diallo", "M. Traoré"]);
    expect(a.bus.sort()).toEqual(["CYBER", "ICT"]);
  });
});

describe("deriveBuAffinity + recommendNextOffers (next best offer data-driven)", () => {
  it("classe le whitespace par affinité de cross-sell (les comptes qui ont X ont souvent Y)", async () => {
    const { deriveBuAffinity, recommendNextOffers } = await import("../domain/nt360.js");
    // Portefeuille : ICT co-occurre fortement avec CYBER (2 comptes sur 2), moins avec FORMATION.
    const accounts = [
      { bus: ["ICT", "CYBER"] },
      { bus: ["ICT", "CYBER"] },
      { bus: ["ICT", "FORMATION"] },
    ];
    const aff = deriveBuAffinity(accounts);
    // Compte qui n'a que ICT ; whitespace = CYBER, FORMATION.
    const ranked = recommendNextOffers(["ICT"], ["FORMATION", "CYBER"], aff);
    expect(ranked[0].offre).toBe("CYBER"); // P(CYBER|ICT)=2/3 > P(FORMATION|ICT)=1/3
    expect(ranked[0].csPct).toBeGreaterThan(ranked[1].csPct);
  });
  it("périmètre vide / affinité absente → scores nuls, pas d'exception", async () => {
    const { recommendNextOffers } = await import("../domain/nt360.js");
    const ranked = recommendNextOffers([], ["X", "Y"], {});
    expect(ranked.every((r) => r.csPct === 0)).toBe(true);
  });
});

describe("deriveAccountValue — réserve de valeur chiffrée et persistée (audit doubler-CA)", () => {
  const meta = {
    buCatalog: ["ICT", "CYBER", "FORMATION", "AUTRE"],
    affinity: { cooc: { ICT: { CYBER: 5, FORMATION: 2 } }, buCount: { ICT: 5 } },
    buBenchmark: {
      ICT: { count: 6, avgCas: 40, medianCas: 40 },       // fiable (≥3)
      CYBER: { count: 5, avgCas: 50, medianCas: 50 },      // fiable
      FORMATION: { count: 2, avgCas: 30, medianCas: 30 },  // n<3 → garde-fou : NON chiffré
    },
  };

  it("chiffre le cross-sell des offres non détenues au panier FIABLE et applique le garde-fou n<3", () => {
    const acc = { bus: ["ICT"], historique: [{ offre: "ICT", cas: 10, firstYear: 2020, lastYear: 2024 }], enCours: [], opportunites: [], casTotal: 10 };
    const v = deriveAccountValue(acc, meta, "2026-07-07");
    // CYBER non détenu, benchmark fiable → chiffré à 50 ; FORMATION n<3 → écarté ; AUTRE fourre-tout → écarté.
    expect(v.whitespaceValue).toEqual([{ offre: "CYBER", montant: 50 }]);
    expect(v.whitespacePotential).toBe(50);
  });

  it("upsell headroom = panier de référence − CAS détenu (offre déjà éprouvée, compte sous-pénétré)", () => {
    const acc = { bus: ["ICT"], historique: [{ offre: "ICT", cas: 10, firstYear: 2024, lastYear: 2024 }], enCours: [], opportunites: [], casTotal: 10 };
    const v = deriveAccountValue(acc, meta, "2026-07-07");
    // médiane ICT 40 − 10 réalisé = 30 de headroom.
    expect(v.upsellHeadroom).toBe(30);
    expect(v.upsellByOffre[0]).toEqual({ offre: "ICT", montant: 30 });
  });

  it("recommande la bascule managé/OPEX quand le compte n'achète que du projet ponctuel", async () => {
    const { isManagedOffer } = await import("../domain/nt360.js");
    expect(isManagedOffer("SOC managé")).toBe(true);
    expect(isManagedOffer("Infogérance")).toBe(true);
    expect(isManagedOffer("Vente de matériel")).toBe(false);
    // Compte 100% projet (ICT) ; le whitespace inclut une offre managée fiable → reco de passage récurrent.
    const metaManaged = {
      buCatalog: ["ICT", "SOC managé"],
      affinity: { cooc: { ICT: { "SOC managé": 4 } }, buCount: { ICT: 4 } },
      buBenchmark: { ICT: { count: 6, medianCas: 40 }, "SOC managé": { count: 4, medianCas: 60 } },
    };
    const acc = { bus: ["ICT"], historique: [{ offre: "ICT", cas: 10, firstYear: 2024, lastYear: 2024 }], enCours: [], opportunites: [], casTotal: 10 };
    const v = deriveAccountValue(acc, metaManaged, "2026-07-07");
    expect(v.managedReco).toEqual({ offre: "SOC managé", arr: 60 });
    // Un compte détenant déjà une offre managée → pas de reco (déjà récurrent).
    const acc2 = { bus: ["SOC managé"], historique: [{ offre: "SOC managé", cas: 50, firstYear: 2023, lastYear: 2025 }], enCours: [], opportunites: [], casTotal: 50 };
    expect(deriveAccountValue(acc2, metaManaged, "2026-07-07").managedReco).toBeNull();
  });

  it("signale dormance matérielle, deal fantôme et deal au point mort ; part récurrente sur ≥2 ans", () => {
    const acc = {
      bus: ["ICT"], enCours: [], casTotal: 1000,
      historique: [
        { offre: "ICT", cas: 900, firstYear: 2020, lastYear: 2025 },   // récurrent (multi-années), récent
        { offre: "CYBER", cas: 100, firstYear: 2022, lastYear: 2022 }, // dormante ≥2 ans, 10% du CA → matérielle
      ],
      opportunites: [
        { nom: "Refonte", montant: 500, closingDate: "2026-01-01", probability: 60 }, // clôture dépassée → fantôme
        { nom: "WAN", montant: 200, probability: 10 },                                  // point mort <20%
      ],
    };
    const v = deriveAccountValue(acc, meta, "2026-07-07");
    const types = v.signals.map((s) => s.type).sort();
    expect(types).toEqual(["dormante", "fantome", "pointmort"]);
    // Part récurrente : ICT (2020→2025, multi-années) = 900 sur 1000 = 90 %.
    expect(v.recurrentCas).toBe(900);
  });
});

describe("deriveAccountVeille — boucle veille → action (direction intégrée)", () => {
  it("rattache les signaux de veille frais qui nomment le compte, écarte périmés/impact faible, marque hot", async () => {
    const { deriveAccountVeille } = await import("../domain/nt360.js");
    const items = [
      { id: "1", title: "Refonte SI à la SGCI", summary: "grand projet", axis: "clients_prospects", impact: "high", prox: "imminent", priorityScore: 90, soWhat: "fenêtre de deal", date: "2026-07-01" },
      { id: "2", title: "Nouvelle réglementation bancaire", summary: "concerne SGCI", impact: "medium", prox: "court", priorityScore: 60, date: "2026-06-15" },
      { id: "3", title: "AO périmé SGCI", summary: "clos", impact: "high", prox: "imminent", priorityScore: 80, stale: true, date: "2026-01-01" }, // périmé → écarté
      { id: "4", title: "Signal faible SGCI", summary: "bruit", impact: "low", priorityScore: 10, date: "2026-07-02" }, // impact low → écarté
      { id: "5", title: "Orange CI lance un site", summary: "autre compte", impact: "high", priorityScore: 70, date: "2026-07-03" }, // ne nomme pas SGCI
    ];
    const v = deriveAccountVeille("SGCI/Société Générale CI", items, "2026-07-07");
    expect(v.count).toBe(2);                    // items 1 et 2 (3=périmé, 4=low, 5=autre compte)
    expect(v.hot).toBe(true);                   // item 1 = high + imminent
    expect(v.top[0].title).toBe("Refonte SI à la SGCI"); // trié par priorityScore desc
    expect(v.top.map((t) => t.title)).not.toContain("Orange CI lance un site");
  });

  it("aucun signal rattaché → count 0, hot false, top vide (pas d'exception)", async () => {
    const { deriveAccountVeille } = await import("../domain/nt360.js");
    const v = deriveAccountVeille("SGCI", [], "2026-07-07");
    expect(v).toEqual({ count: 0, hot: false, top: [] });
  });
});

describe("matchOffersToEvents — la veille déclenche le cross-sell (offre opportune maintenant)", () => {
  it("croise un signal de veille avec l'offre pertinente de la réserve du compte", async () => {
    const { matchOffersToEvents } = await import("../domain/nt360.js");
    const veilleTop = [
      { title: "Faille critique Fortinet chez SGCI", subtype: "vulnerability", impact: "high" },
      { title: "Nouvelle implantation à Abidjan", subtype: "implantation", impact: "medium" },
    ];
    const offers = [
      { offre: "SOC managé", montant: 60, kind: "cross-sell" },   // matche vulnerability (soc/secur)
      { offre: "Réseau WAN", montant: 40, kind: "cross-sell" },   // matche implantation (reseau/wan)
      { offre: "Formation", montant: 10, kind: "upsell" },        // ne matche aucun événement
    ];
    const out = matchOffersToEvents(veilleTop, offers);
    const offres = out.map((o) => o.offre);
    expect(offres).toContain("SOC managé");
    expect(offres).toContain("Réseau WAN");
    expect(offres).not.toContain("Formation");
    expect(out.find((o) => o.offre === "SOC managé").event).toBe("Faille critique Fortinet chez SGCI");
  });

  it("subtype sans affinité d'offre ou réserve vide → aucun déclenchement (pas d'exception)", async () => {
    const { matchOffersToEvents } = await import("../domain/nt360.js");
    expect(matchOffersToEvents([{ title: "X", subtype: "macro" }], [{ offre: "Cyber", montant: 5, kind: "cross-sell" }])).toEqual([]);
    expect(matchOffersToEvents([{ title: "X", subtype: "vulnerability" }], [])).toEqual([]);
  });

  it("rapprochement par MOT, pas sous-chaîne : « soc » (SOC) ne matche pas « Société », « ia » ne matche pas « fiabilité »", async () => {
    const { matchOffersToEvents, isManagedOffer } = await import("../domain/nt360.js");
    // Faux positifs corrigés : une offre au libellé contenant « soc »/« ia » par hasard n'est PAS déclenchée.
    expect(matchOffersToEvents([{ title: "faille", subtype: "vulnerability" }], [{ offre: "Société de conseil", montant: 9, kind: "cross-sell" }])).toEqual([]);
    expect(matchOffersToEvents([{ title: "levée", subtype: "funding" }], [{ offre: "Fiabilité réseau", montant: 9, kind: "cross-sell" }])).toEqual([]);
    // Vrais positifs conservés : acronyme mot entier (SOC, WAN) + racine (managé).
    expect(matchOffersToEvents([{ title: "faille", subtype: "vulnerability" }], [{ offre: "SOC managé", montant: 9, kind: "cross-sell" }]).map((x) => x.offre)).toEqual(["SOC managé"]);
    expect(matchOffersToEvents([{ title: "impl.", subtype: "implantation" }], [{ offre: "Réseau WAN", montant: 9, kind: "cross-sell" }]).map((x) => x.offre)).toEqual(["Réseau WAN"]);
    // isManagedOffer : idem, plus de faux positif « soc » ⊂ « société ».
    expect(isManagedOffer("Société de conseil")).toBe(false);
    expect(isManagedOffer("SOC managé")).toBe(true);
    expect(isManagedOffer("Infogérance")).toBe(true);
  });
});

describe("armDormantSignals — relance churn armée par la veille (levier RÉCURRENCE)", () => {
  it("arme une dormante quand l'événement cible l'offre, ou à défaut quand un signal chaud existe", async () => {
    const { armDormantSignals } = await import("../domain/nt360.js");
    const signals = [
      { type: "dormante", offre: "SOC managé", montant: 30, label: "Offre dormante : SOC managé" },
      { type: "dormante", offre: "Formation", montant: 10, label: "Offre dormante : Formation" },
      { type: "fantome", montant: 50, label: "Deal fantôme" },
    ];
    // (a) événement ciblant précisément SOC managé → armée avec cet événement.
    const eventOffers = [{ offre: "SOC managé", montant: 30, kind: "cross-sell", event: "Faille Fortinet" }];
    const out = armDormantSignals(signals, { hot: false, top: [] }, eventOffers);
    const soc = out.find((s) => s.offre === "SOC managé");
    expect(soc.armed).toBe(true);
    expect(soc.triggerEvent).toBe("Faille Fortinet");
    // Formation n'a ni événement ni signal chaud → non armée.
    expect(out.find((s) => s.offre === "Formation").armed).toBeUndefined();
    // Les signaux non-dormants ne sont pas touchés.
    expect(out.find((s) => s.type === "fantome").armed).toBeUndefined();
  });

  it("(b) fenêtre rouverte par un signal chaud générique → arme toutes les dormantes", async () => {
    const { armDormantSignals } = await import("../domain/nt360.js");
    const signals = [{ type: "dormante", offre: "Réseau", montant: 20, label: "dormante" }];
    const out = armDormantSignals(signals, { hot: true, top: [{ title: "Nouvelle DSI à la SGCI" }] }, []);
    expect(out[0].armed).toBe(true);
    expect(out[0].triggerEvent).toBe("Nouvelle DSI à la SGCI");
  });

  it("aucun signal de veille → aucune dormante armée (pas d'exception)", async () => {
    const { armDormantSignals } = await import("../domain/nt360.js");
    const signals = [{ type: "dormante", offre: "X", montant: 20, label: "d" }];
    expect(armDormantSignals(signals, { hot: false, top: [] }, [])[0].armed).toBeUndefined();
  });
});

describe("deriveClientValueIndex / resolveAccountValue — la valeur compte priorise la veille", () => {
  it("classe les clients par tier quantile de CAS et résout une entité de veille", async () => {
    const { deriveClientValueIndex, resolveAccountValue } = await import("../domain/nt360.js");
    const accounts = [
      { nom: "Petit Client", casTotal: 10 },
      { nom: "Client Médian", casTotal: 100 },
      { nom: "Orange Côte d'Ivoire", casTotal: 1000 },
      { nom: "Sans CAS", casTotal: 0 }, // écarté (pas de valeur)
    ];
    const idx = deriveClientValueIndex(accounts);
    // Le plus gros → tier 1.0, le plus petit → 0.0.
    expect(idx["orange cote d ivoire"]).toBe(1);
    expect(idx["petit client"]).toBe(0);
    expect(idx["sans cas"]).toBeUndefined();
    // Résolution par inclusion bornée : « Orange CI » retrouve « Orange Côte d'Ivoire ».
    expect(resolveAccountValue("Orange CI", idx)).toBe(1);
    // Entité inconnue → 0 (neutre).
    expect(resolveAccountValue("Inconnu SARL", idx)).toBe(0);
    expect(resolveAccountValue("", idx)).toBe(0);
  });
});

describe("copiloteAccountMatchesScope (cloisonnement « mix des 3 »)", () => {
  it("matche par owner (e-mail), par am, ou par BU — insensible casse/espaces ; sinon false", async () => {
    const { copiloteAccountMatchesScope } = await import("../domain/nt360.js");
    const acc = { owners: ["Jean.Vendeur@nt.ci"], nt360: { ams: ["K. Diallo"], bus: ["ICT"] } };
    // 1) override e-mail
    expect(copiloteAccountMatchesScope(acc, { email: "jean.vendeur@nt.ci", ams: [], bus: [] })).toBe(true);
    // 2) account manager
    expect(copiloteAccountMatchesScope(acc, { email: "x@y.z", ams: ["k. diallo"], bus: [] })).toBe(true);
    // 3) BU
    expect(copiloteAccountMatchesScope(acc, { email: "x@y.z", ams: [], bus: ["ict"] })).toBe(true);
    // aucune correspondance
    expect(copiloteAccountMatchesScope(acc, { email: "autre@nt.ci", ams: ["M. Autre"], bus: ["CYBER"] })).toBe(false);
    // compte sans rattachement + périmètre vide → non visible
    expect(copiloteAccountMatchesScope({ nt360: {} }, { email: "", ams: [], bus: [] })).toBe(false);
  });
});

describe("deriveBuBenchmark — panier de référence par offre (chiffrage next best offer)", () => {
  it("médiane + moyenne du CAS cumulé par compte, par offre ; ignore cas ≤ 0 / non chiffrés", () => {
    const accounts = [
      { historique: [{ offre: "ICT", cas: 100 }, { offre: "FORMATION", cas: 10 }] },
      { historique: [{ offre: "ICT", cas: 300 }, { offre: "FORMATION", cas: 0 }] },
      { historique: [{ offre: "ICT", cas: 200 }, { offre: null, cas: 999 }] },
    ];
    const b = deriveBuBenchmark(accounts);
    expect(b.ICT).toMatchObject({ count: 3, medianCas: 200, avgCas: 200 }); // [100,200,300]
    expect(b.FORMATION).toMatchObject({ count: 1, medianCas: 10 }); // le cas:0 est écarté
    expect(b.null).toBeUndefined();
  });
  it("médiane paire = moyenne des deux centraux ; entrée vide → {}", () => {
    const b = deriveBuBenchmark([{ historique: [{ offre: "X", cas: 100 }] }, { historique: [{ offre: "X", cas: 400 }] }]);
    expect(b.X.medianCas).toBe(250);
    expect(deriveBuBenchmark([])).toEqual({});
    expect(deriveBuBenchmark(null)).toEqual({});
  });
});

describe("matchSignalsToAccount — déclencheurs de veille rattachés au compte", () => {
  it("rattache un signal qui nomme le compte, ignore les mots génériques", () => {
    const signals = [
      { name: "AO refonte SI à la BRVM — 2 Mds FCFA" },
      { name: "Nouvelle réglementation bancaire UEMOA" }, // « banque/UEMOA » génériques → pas de faux positif
      { name: "Ecobank lance un plan cloud" },
    ];
    const m = matchSignalsToAccount("BRVM", signals).map((s) => s.name);
    expect(m).toEqual(["AO refonte SI à la BRVM — 2 Mds FCFA"]);
    // Un compte générique « Banque » ne rattache rien (jeton trop générique filtré).
    expect(matchSignalsToAccount("Banque", signals)).toEqual([]);
  });
  it("match multi-mots insensible casse/accents ; chaînes acceptées ; vide si pas de jeton", () => {
    const sigs = ["Société Générale CI signe avec un concurrent", "signal neutre"];
    expect(matchSignalsToAccount("SGCI/Société Générale CI", sigs)).toHaveLength(1);
    expect(matchSignalsToAccount("", sigs)).toEqual([]);
    expect(matchSignalsToAccount("BRVM", null)).toEqual([]);
  });
});

describe("nt360 — isMeaningfulBu (offres fourre-tout exclues du cross-sell)", () => {
  it("écarte les libellés fourre-tout, garde les vraies offres", async () => {
    const { isMeaningfulBu } = await import("../domain/nt360.js");
    expect(isMeaningfulBu("ICT")).toBe(true);
    expect(isMeaningfulBu("CLOUD")).toBe(true);
    expect(isMeaningfulBu("AUTRE")).toBe(false);
    expect(isMeaningfulBu(" divers ")).toBe(false);
    expect(isMeaningfulBu("N/A")).toBe(false);
    expect(isMeaningfulBu("")).toBe(false);
    expect(isMeaningfulBu(null)).toBe(false);
  });
});
