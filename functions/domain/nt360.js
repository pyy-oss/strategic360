"use strict";

/**
 * Domain logic: mapping the SIBLING APP nt360's Firestore rows onto the row shapes that
 * functions/domain/quanti.js expects ("données internes disponibles dans une autre application"
 * decision, 2026-07-02 — the internal P&L/LIVE/Facturation/fiche data is no longer expected as
 * Excel uploads to Storage: nt360, another app in the same shared Firebase project, already
 * ingests those workbooks into its own named Firestore database "nt360").
 *
 * nt360 row shapes (inventoried read-only via inspect-internal-data.yml, 2026-07-02):
 *   orders        { _id, am, bu, cas, client, fp, mb, raf, suppliers: string[], yearPo, source:"pnl" }
 *   opportunities { _id, am, amount, bu, client, closingDate, fp, marginPct, oppId, probability,
 *                   stage: number, stageLabel: "2-Montage", weighted, source:"salesData" }
 *   invoices      { _id, amountHt, bu, client, date, fp, linked, numero, paymentStatus, prePo,
 *                   source:"facturationDf" }
 *   bcLines       { _id, amountXof, bcNumber, currency, description, expenseType, fp, lineIndex,
 *                   status, supplier, source:"fiche" }
 *   objectives    { fiscalYear, scope, scopeValue, targetCas, targetInvoiced, targetMargin }
 *   config        (one doc carries { currentFy: number, available: number[] })
 *
 * quanti.js expected shapes (see its header):
 *   orders:        { bu, fournisseur, cas, casN1, mb, am }
 *   opportunities: { client, montant, etape, idc, datePrev, mbPct }
 *   invoices:      { dateCommande, dateFacturation, montant }
 *
 * Pure functions only (no Firestore access) — unit-tested in functions/test/nt360.domain.test.js.
 * The only caller that touches Firestore is `runInternalQuantiSync` in functions/index.js, which
 * reads the nt360 database STRICTLY READ-ONLY and writes the resulting `summaries/quanti` into
 * strategic360's own database.
 */

/**
 * nt360 pipeline stages → quanti.js's ETAPE_PROBABILITY vocabulary. nt360 numbers its stages
 * 1..7 with French labels ("2-Montage"); DELTA_01 §3bis.E documents "win rate (6 vs 7)" — stage 6
 * is Gagné, stage 7 is Perdu (those two mappings are exact and drive the win-rate). The open
 * stages 1-5 are approximations onto the conventional 5-stage vocabulary (probabilities 0.2→0.8);
 * nt360 does carry its own per-opportunity `probability`, but quanti.js's computePipeline
 * deliberately derives probability from `etape` so the whole app shares one calibratable map —
 * recalibrate ETAPE_PROBABILITY there if nt360's own probabilities prove more accurate.
 */
const STAGE_TO_ETAPE = {
  1: "Qualification",
  2: "Proposition",
  3: "Négociation",
  4: "Verbal",
  5: "Verbal",
  6: "Gagné",
  7: "Perdu",
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * mapOrders(nt360Orders, currentFy) -> quanti `orders` rows.
 * nt360's P&L keeps one row per order tagged with its PO year (`yearPo`) instead of carrying
 * cas/casN1 column pairs — so "CAS N" = cas of rows with yearPo === currentFy and "CAS N-1" = cas
 * of rows with yearPo === currentFy-1. Each mapped row contributes to exactly one of cas/casN1
 * (older years contribute to neither — they exist for history, not for the N/N-1 comparison).
 * `mb` (marge brute) follows the same rule so computeBcg's per-BU `marge` is the CURRENT year's
 * margin, matching the maquette's semantics. `fournisseur` is deliberately null — nt360 orders
 * carry a `suppliers` array that is empty in practice; supplier concentration comes from bcLines
 * instead (see mapBcLinesToSupplierRows).
 */
function mapOrders(nt360Orders, currentFy) {
  if (!Array.isArray(nt360Orders)) return [];
  const fy = Number(currentFy);
  return nt360Orders
    .filter((o) => o && typeof o === "object")
    .map((o) => {
      const year = Number(o.yearPo);
      const isN = year === fy;
      const isN1 = year === fy - 1;
      return {
        bu: o.bu || null,
        am: o.am || null,
        fournisseur: null,
        cas: isN ? num(o.cas) : 0,
        casN1: isN1 ? num(o.cas) : 0,
        mb: isN ? num(o.mb) : 0,
      };
    });
}

/**
 * mapOpportunities(nt360Opps) -> quanti `opportunities` rows.
 * etape: via STAGE_TO_ETAPE (numeric `stage` preferred; falls back to parsing the leading digit
 * of `stageLabel` like "2-Montage"; unknown → undefined so computePipeline applies its documented
 * conservative 0.3 default).
 */
function mapOpportunities(nt360Opps) {
  if (!Array.isArray(nt360Opps)) return [];
  return nt360Opps
    .filter((o) => o && typeof o === "object")
    .map((o) => {
      let stage = Number(o.stage);
      if (!Number.isFinite(stage) && typeof o.stageLabel === "string") {
        stage = Number.parseInt(o.stageLabel, 10);
      }
      return {
        client: o.client || null,
        montant: num(o.amount),
        etape: STAGE_TO_ETAPE[stage],
        idc: o.oppId || o._id || null,
        datePrev: o.closingDate || null,
        mbPct: Number.isFinite(Number(o.marginPct)) ? Number(o.marginPct) : null,
      };
    });
}

/**
 * mapInvoices(nt360Invoices) -> quanti `invoices` rows.
 * nt360 invoices only carry the invoicing `date` — there is no order date on the invoice row, so
 * `dateCommande` is null and the "Délai commande→facturation" KRI stays honestly null (computeKris
 * already handles unparsable dates by skipping the row) instead of being fabricated.
 */
function mapInvoices(nt360Invoices) {
  if (!Array.isArray(nt360Invoices)) return [];
  return nt360Invoices
    .filter((i) => i && typeof i === "object")
    .map((i) => ({
      dateCommande: null,
      dateFacturation: i.date || null,
      montant: num(i.amountHt),
    }));
}

/**
 * mapBcLinesToSupplierRows(nt360BcLines) -> quanti `orders`-shaped rows carrying ONLY
 * {fournisseur, cas} for computePorterForces's Top-3 supplier concentration (nt360's fiche-affaire
 * purchase lines are the supplier ledger: one line per supplier purchase with amountXof).
 * These pseudo-rows must NOT be fed to computeBcg/computeCasSummary (they have no bu — computeBcg
 * skips them anyway — and their amounts are purchases, not revenue).
 */
const XOF_CURRENCIES = new Set(["XOF", "FCFA", "CFA", "F CFA", ""]);
function mapBcLinesToSupplierRows(nt360BcLines) {
  if (!Array.isArray(nt360BcLines)) return [];
  return nt360BcLines
    .filter((l) => l && typeof l === "object" && l.supplier)
    // Garde devise (m5 audit 2026-07) : amountXof est censé être en XOF. Si une ligne porte une
    // devise ÉTRANGÈRE sans montant XOF pré-converti, on l'écarte plutôt que de sommer des EUR/USD
    // comme des francs CFA (fausserait la concentration fournisseurs de Porter).
    .filter((l) => {
      const cur = typeof l.currency === "string" ? l.currency.trim().toUpperCase() : "";
      return XOF_CURRENCIES.has(cur) || Number.isFinite(l.amountXof);
    })
    .map((l) => ({ fournisseur: l.supplier, cas: num(l.amountXof) }));
}

/**
 * pickObjectives(nt360Objectives, currentFy) -> {fiscalYear, targetCas, targetInvoiced,
 * targetMargin} | null — the global objectives doc for the current fiscal year (prefers
 * scope==="global", falls back to the first doc matching the year). Passed through into
 * `summaries/quanti.objectives` so future UI (Indicateurs/Diagnostic) can compare realized vs
 * target without re-reading nt360.
 */
function pickObjectives(nt360Objectives, currentFy) {
  if (!Array.isArray(nt360Objectives) || nt360Objectives.length === 0) return null;
  const fy = Number(currentFy);
  const forYear = nt360Objectives.filter((o) => o && Number(o.fiscalYear) === fy);
  const candidates = forYear.length ? forYear : nt360Objectives;
  const chosen = candidates.find((o) => o && o.scope === "global") || candidates[0];
  if (!chosen) return null;
  return {
    fiscalYear: Number(chosen.fiscalYear) || null,
    targetCas: Number.isFinite(Number(chosen.targetCas)) ? Number(chosen.targetCas) : null,
    targetInvoiced: Number.isFinite(Number(chosen.targetInvoiced)) ? Number(chosen.targetInvoiced) : null,
    targetMargin: Number.isFinite(Number(chosen.targetMargin)) ? Number(chosen.targetMargin) : null,
  };
}

/**
 * pickCurrentFy(configDocs, fallbackYear) -> number — nt360's `config` collection carries the
 * active fiscal year on one of its docs ({currentFy: 2026, available: [...]}). Falls back to the
 * caller-supplied year (typically the current calendar year) when absent.
 */
function pickCurrentFy(configDocs, fallbackYear) {
  if (Array.isArray(configDocs)) {
    for (const doc of configDocs) {
      const fy = Number(doc && doc.currentFy);
      if (Number.isFinite(fy) && fy > 2000) return fy;
    }
  }
  return fallbackYear;
}

/**
 * deriveCopiloteAccounts(nt360Orders, nt360Opps) -> [{ slug, nom, historique, enCours,
 *   casTotal, pipelinePondere }] — empreinte commerciale par compte, dérivée du pipeline nt360.
 *
 * PUR (aucun accès Firestore). Réutilisé par le Copilote Commercial pour pré-remplir
 * l'historique/les travaux en cours d'un compte À PARTIR DU RÉEL, en complément (jamais en
 * remplacement) du qualitatif saisi par le commercial. La « BU » nt360 sert d'intitulé d'offre
 * (proxy le plus fiable disponible). Gagné = stage 6 ; en cours = stages 1-5 ; perdu (7) ignoré.
 *
 * @param {Array<{client?:string, bu?:string, cas?:number}>} nt360Orders
 * @param {Array<{client?:string, bu?:string, stage?:number, amount?:number, weighted?:number}>} nt360Opps
 */
function slugifyClient(name) {
  return String(name || "")
    .trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
// Repli déterministe (djb2 → base36) quand slugifyClient est vide (nom purement non-latin/symboles) :
// on ne veut PAS perdre le CAS de ce client ni fusionner tous ces clients dans une seule clé "".
function hashName(name) {
  let h = 5381;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function deriveCopiloteAccounts(nt360Orders, nt360Opps) {
  const byClient = new Map();
  const get = (client) => {
    const nom = String(client).trim();
    const slug = slugifyClient(nom) || `cpt-${hashName(nom)}`;
    if (!byClient.has(slug)) {
      byClient.set(slug, { slug, nom, wonBu: new Set(), openBu: new Set(), casTotal: 0, pipelinePondere: 0, wins: 0, opps: [], ams: new Set(), bus: new Set(), buStats: new Map() });
    }
    return byClient.get(slug);
  };
  // Résout le stade comme mapOpportunities : `stage` numérique prioritaire, sinon 1er chiffre de
  // `stageLabel` ("3-Négociation" → 3). Sans ce repli, un deal sans `stage` numérique disparaissait
  // entièrement du pipeline (audit profond 2026-07).
  const resolveStage = (o) => {
    let s = Number(o.stage);
    if (!Number.isFinite(s) && typeof o.stageLabel === "string") s = Number.parseInt(o.stageLabel, 10);
    return s;
  };
  // Empreinte de rattachement (cloisonnement par commercial) : on collecte les account managers (am)
  // et les BU réels du compte pour pouvoir, plus tard, filtrer le portefeuille par périmètre.
  const tagOwner = (a, o) => { if (o.am) a.ams.add(String(o.am).trim()); if (o.bu) a.bus.add(String(o.bu).trim()); };
  for (const o of Array.isArray(nt360Orders) ? nt360Orders : []) {
    if (!o || !o.client) continue;
    const a = get(o.client);
    a.casTotal += num(o.cas);
    if (o.bu) {
      const bu = String(o.bu).trim();
      a.wonBu.add(bu); // un CAS réalisé = offre déjà vendue
      // Historique EXPLOITABLE : CAS réalisé par offre + amplitude d'années (récence/cadence).
      if (!a.buStats.has(bu)) a.buStats.set(bu, { cas: 0, years: new Set(), orders: 0 });
      const st = a.buStats.get(bu);
      st.cas += num(o.cas);
      st.orders += 1;
      const yr = Number(o.yearPo);
      if (Number.isFinite(yr) && yr > 2000) st.years.add(yr);
    }
    tagOwner(a, o);
  }
  for (const o of Array.isArray(nt360Opps) ? nt360Opps : []) {
    if (!o || !o.client) continue;
    const stage = resolveStage(o);
    const a = get(o.client);
    tagOwner(a, o);
    if (stage === 6) { a.wins += 1; if (o.bu) a.wonBu.add(String(o.bu)); }
    else if (stage >= 1 && stage <= 5) {
      if (o.bu) a.openBu.add(String(o.bu));
      // `weighted` non renseigné (null/undefined/NaN) → repli amount*0.5. Number(null)===0 est fini,
      // d'où le garde explicite `!= null` pour ne pas comptabiliser un pipeline nul par erreur.
      const hasWeighted = o.weighted != null && Number.isFinite(Number(o.weighted));
      a.pipelinePondere += hasWeighted ? num(o.weighted) : num(o.amount) * 0.5;
      // Opportunité RÉELLE en cours (deal en pipeline) — détail chiffré pour l'effet « portefeuille vivant ».
      a.opps.push({
        nom: String(o.oppId || o.fp || o.bu || "Opportunité").trim(),
        montant: num(o.amount),
        etape: String(o.stageLabel || `Stade ${stage}`).trim(),
        bu: o.bu ? String(o.bu) : "",
        closingDate: typeof o.closingDate === "string" ? o.closingDate : "",
        probability: Number.isFinite(Number(o.probability)) ? Number(o.probability) : null,
      });
    }
  }
  return [...byClient.values()]
    .filter((a) => a.slug)
    .map((a) => ({
      slug: a.slug,
      nom: a.nom,
      // Historique enrichi : chaque offre déjà vendue porte son CAS réalisé cumulé + la plage
      // d'années (récence/cadence), trié par CAS décroissant → l'IA peut citer les plus grosses
      // lignes, la récence, et raisonner renouvellement/cross-sell. Les BU issues d'opps gagnées
      // sans commande chiffrée (buStats absent) restent listées avec statut Gagné.
      historique: [...a.wonBu]
        .map((bu) => {
          const st = a.buStats.get(bu);
          const years = st ? [...st.years].sort() : [];
          return {
            offre: bu,
            statut: "Gagné",
            cas: st ? Math.round(st.cas) : 0,
            orders: st ? st.orders : 0,
            firstYear: years.length ? years[0] : null,
            lastYear: years.length ? years[years.length - 1] : null,
          };
        })
        .sort((x, y) => y.cas - x.cas),
      enCours: [...a.openBu],
      casTotal: Math.round(a.casTotal),
      pipelinePondere: Math.round(a.pipelinePondere),
      wins: a.wins,
      // Top opportunités en cours par montant (borné pour rester léger côté doc Firestore).
      opportunites: a.opps.sort((x, y) => y.montant - x.montant).slice(0, 8).map((o) => ({ ...o, montant: Math.round(o.montant) })),
      // Rattachement réel (cloisonnement) : account managers + BU du compte.
      ams: [...a.ams],
      bus: [...a.bus],
    }));
}

/**
 * deriveBuAffinity(accounts) -> { cooc, buCount } — matrice de co-occurrence des offres (BU) sur
 * l'ensemble du portefeuille : combien de comptes achètent l'offre A ET l'offre B. Base d'un vrai
 * moteur de cross-sell « les comptes qui achètent X achètent aussi Y » (market basket). PUR.
 */
function deriveBuAffinity(accounts) {
  const cooc = {};
  const buCount = {};
  for (const acc of Array.isArray(accounts) ? accounts : []) {
    const bus = [...new Set((Array.isArray(acc.bus) ? acc.bus : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))];
    for (const a of bus) {
      buCount[a] = (buCount[a] || 0) + 1;
      for (const b of bus) {
        if (a === b) continue;
        cooc[a] = cooc[a] || {};
        cooc[a][b] = (cooc[a][b] || 0) + 1;
      }
    }
  }
  return { cooc, buCount };
}

/**
 * recommendNextOffers(ownedBus, whitespace, affinity) -> [{ offre, score, csPct }] trié — pour un
 * compte, classe les offres du whitespace par affinité moyenne P(offre | offres déjà détenues)
 * sur le portefeuille. Donne la « next best offer » DATA-DRIVEN (pas une intuition). PUR.
 */
function recommendNextOffers(ownedBus, whitespace, affinity) {
  const cooc = (affinity && affinity.cooc) || {};
  const buCount = (affinity && affinity.buCount) || {};
  const owned = (Array.isArray(ownedBus) ? ownedBus : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  const scored = (Array.isArray(whitespace) ? whitespace : [])
    .filter((x) => typeof x === "string" && x.trim())
    .map((cand) => {
      let sum = 0, n = 0;
      for (const o of owned) {
        const denom = buCount[o] || 0;
        if (denom > 0) { sum += ((cooc[o] && cooc[o][cand.trim()]) || 0) / denom; n++; }
      }
      const score = n ? sum / n : 0;
      return { offre: cand.trim(), score, csPct: Math.round(score * 100) };
    })
    .sort((x, y) => y.score - x.score);
  return scored;
}

/**
 * copiloteAccountMatchesScope(account, scope) -> bool — un compte est visible par un commercial si
 * l'UNE des trois sources de rattachement correspond (« mix des 3 ») :
 *   1. override manuel : son e-mail figure dans account.owners ;
 *   2. account manager : l'un de ses am (scope.ams) figure dans account.nt360.ams ;
 *   3. BU/équipe       : l'une de ses BU (scope.bus) figure dans account.nt360.bus.
 * PUR — comparaison insensible à la casse/aux espaces. `scope = { email, ams:[], bus:[] }`.
 */
function copiloteAccountMatchesScope(account, scope) {
  const a = account || {};
  const s = scope || {};
  // Le créateur d'un compte le voit toujours (sinon un commercial créant un compte manuel le perdrait
  // aussitôt, faute de rattachement am/BU/owner).
  if (s.uid && a.createdBy && a.createdBy === s.uid) return true;
  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const owners = (Array.isArray(a.owners) ? a.owners : []).map(norm);
  const email = norm(s.email);
  if (email && owners.includes(email)) return true;
  const nt = a.nt360 && typeof a.nt360 === "object" ? a.nt360 : {};
  const intersects = (accList, scopeList) => {
    const set = new Set((Array.isArray(accList) ? accList : []).map(norm));
    return (Array.isArray(scopeList) ? scopeList : []).some((x) => set.has(norm(x)));
  };
  return intersects(nt.ams, s.ams) || intersects(nt.bus, s.bus);
}

module.exports = {
  STAGE_TO_ETAPE,
  mapOrders,
  mapOpportunities,
  mapInvoices,
  mapBcLinesToSupplierRows,
  pickObjectives,
  pickCurrentFy,
  deriveCopiloteAccounts,
  deriveBuAffinity,
  recommendNextOffers,
  copiloteAccountMatchesScope,
  slugifyClient,
};
