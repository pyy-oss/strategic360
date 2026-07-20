"use strict";

/**
 * Domain logic: "Quanti interne" (BUILD_KIT.md §8.3, §9 / DELTA_01 §3bis, §5.3, §5.4).
 *
 * Pure functions only (no Firestore/Storage access here) so they can be unit-tested directly
 * with plain JS fixtures — see functions/test/quanti.domain.test.js. Called by `ingestInternal`
 * in functions/index.js, which is the only place that touches Firestore/Storage.
 *
 * IMPORTANT — this is explicitly a "wire the formulas correctly, calibrate coefficients later on
 * real data" implementation (per BUILD_KIT.md §8.3: "Tous calibrés sur les données réelles, pas
 * sur les constantes d'exemple"). Every simplification/assumption is documented inline. No real
 * P&L/LIVE/Facturation/fiche affaire files exist in this sandbox, so none of the specific
 * coefficients below (étape→probabilité map, KRI thresholds, etc.) have been validated against
 * real business data — they are reasonable placeholders, not calibrated figures.
 *
 * Expected row shapes (produced by functions/parsers/*.js — see those files for the assumed
 * source-workbook column headers):
 *   orders:        { bu, fournisseur, cas, casN1, mb, am }
 *   opportunities: { client, montant, etape, idc, datePrev, mbPct }
 *   invoices:      { dateCommande, dateFacturation, montant }
 *   bcLines:       { fournisseur, type, montant }               (fiche affaire — not yet consumed
 *                                                                  by any of the functions below;
 *                                                                  reserved for a future costing
 *                                                                  breakdown, out of V4's scope)
 */

/* ------------------------------------------------------------------------------------------- *
 * Porter — pouvoir fournisseurs / pouvoir clients (BUILD_KIT.md §8.3)
 * ------------------------------------------------------------------------------------------- */

/**
 * pouvoirFournisseurs = concentration Top-3 fournisseurs (% du CAS total porté par les 3 plus
 * gros fournisseurs) — sourced from `orders` (P&L, DELTA_01 §3bis.A: "orders (CAS, RAF, MB, BU,
 * AM, Frns1-10)" is supplier-centric, one row per order/fournisseur line).
 *
 * pouvoirClients = concentration Top-5 clients (% du CAS total porté par les 5 plus gros clients)
 * — DELTA_01 §3bis.A actually lists P&L/`orders` as feeding "Porter pouvoir clients" too, but the
 * P&L schema we've defined (functions/parsers/pnl.js) carries `fournisseur`, not `client` — the
 * sheet is a supplier ledger, not a client ledger. Rather than invent a client field that isn't in
 * the assumed P&L layout, we derive pouvoirClients from `opportunities` (LIVE, which does carry a
 * `client` field) instead. This is documented here and at the call site (ingestInternal) — it's a
 * deliberate deviation from the letter of DELTA_01's table, in favor of a field that actually
 * exists in the source we can parse.
 *
 * Both concentrations are computed the same way: sum each entity's amount, sort descending,
 * take the top N, divide by the grand total, ×100, rounded to the nearest integer, clamped [0,100].
 * Returns null (not 0) when the input is empty/missing — "no data yet" is different from
 * "0% concentration" and must not silently render as a real number.
 */
function topNConcentration(rows, keyField, amountField, topN) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const totals = new Map();
  let grandTotal = 0;
  for (const r of rows) {
    const key = r && r[keyField];
    const amount = Number(r && r[amountField]);
    if (!key || !Number.isFinite(amount)) continue;
    totals.set(key, (totals.get(key) || 0) + amount);
    grandTotal += amount;
  }
  if (totals.size === 0 || grandTotal <= 0) return null;
  const sorted = [...totals.values()].sort((a, b) => b - a);
  const topSum = sorted.slice(0, topN).reduce((s, v) => s + v, 0);
  const pct = (topSum / grandTotal) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

/**
 * computePorterForces({orders, opportunities}) -> { pouvoirFournisseurs, pouvoirClients }
 * pouvoirFournisseurs: Top-3 `fournisseur` CAS concentration from `orders`.
 * pouvoirClients: Top-5 `client` montant concentration from `opportunities` (see note above).
 * Either field is null if its source input is absent/empty (graceful-null pattern, same as V3's
 * aggregateVeilleExec).
 */
function computePorterForces({ orders, opportunities } = {}) {
  return {
    pouvoirFournisseurs: topNConcentration(orders || [], "fournisseur", "cas", 3),
    pouvoirClients: topNConcentration(opportunities || [], "client", "montant", 5),
  };
}

/* ------------------------------------------------------------------------------------------- *
 * BCG — portefeuille par BU (BUILD_KIT.md §8.3 / §5.4, DELTA_01)
 * ------------------------------------------------------------------------------------------- */

/**
 * Quadrant thresholds mirror `QCOL`'s labels in web/src/design/tokens.ts and the maquette sample
 * data in web/src/modules/veille/data.ts's `BCG` constant (part>=0.5 & croissance>=0.5 → Vedette,
 * part>=0.5 & croissance<0.5 → Vache à lait, part<0.5 & croissance>=0.5 → Dilemme, else Poids
 * mort) — chosen for consistency with the already-shipped client-side labeling rather than
 * inventing new thresholds server-side.
 */
function bcgQuadrant(part, croissance) {
  if (part >= 0.5 && croissance >= 0.5) return "Vedette";
  if (part >= 0.5 && croissance < 0.5) return "Vache à lait";
  if (part < 0.5 && croissance >= 0.5) return "Dilemme";
  return "Poids mort";
}

/**
 * computeBcg({orders}) -> Array<{n, part, croissance, marge, q}>
 * Groups `orders` by `bu`. For each BU:
 *   - croissance = (CAS_N − CAS_N1) / CAS_N1, clamped to [0,1] (matches the maquette's
 *     0-1 domain on the BCG chart's Y axis — a BU shrinking is clamped to 0, not negative,
 *     since the chart has no negative-growth quadrant; a BU growing >100% is clamped to 1).
 *   - part = that BU's CAS_N ÷ max(BU CAS_N) — a *relative* market-share PROXY, not a true
 *     "part de marché relative" (which would need a competitor's CAS, unavailable internally).
 *     Documented per BUILD_KIT.md §8.3's own wording: "BCG (croissance CAS N/N-1 × part
 *     relative, taille=marge)" — "part relative" here is relative to our OWN largest BU, a
 *     reasonable stand-in in the absence of external market-share data.
 *   - marge = Σ mb (mb assumed already in the same unit as the maquette's BCG.marge, i.e.
 *     "M FCFA" — no unit conversion performed here; calibrate/convert at the parser or here once
 *     real P&L units are known).
 *   - q = quadrant label via bcgQuadrant().
 * Rows with CAS_N1 <= 0 (no meaningful growth denominator) are still included with
 * croissance = 0 rather than dropped or NaN — a BU with no N-1 baseline is conservatively
 * treated as flat rather than infinite/undefined growth.
 * Returns [] (not null) when `orders` is empty — an empty BCG chart is a valid, renderable state.
 */
function computeBcg({ orders } = {}) {
  if (!Array.isArray(orders) || orders.length === 0) return [];

  const byBu = new Map();
  for (const r of orders) {
    const bu = r && r.bu;
    if (!bu) continue;
    const cas = Number(r.cas) || 0;
    const casN1 = Number(r.casN1) || 0;
    const mb = Number(r.mb) || 0;
    const entry = byBu.get(bu) || { cas: 0, casN1: 0, mb: 0 };
    entry.cas += cas;
    entry.casN1 += casN1;
    entry.mb += mb;
    byBu.set(bu, entry);
  }
  if (byBu.size === 0) return [];

  const maxCas = Math.max(...[...byBu.values()].map((v) => v.cas));
  if (maxCas <= 0) return [];

  return [...byBu.entries()].map(([bu, v]) => {
    const croissance = v.casN1 > 0 ? Math.max(0, Math.min(1, (v.cas - v.casN1) / v.casN1)) : 0;
    const part = Math.max(0, Math.min(1, v.cas / maxCas));
    return { n: bu, part, croissance, marge: Math.round(v.mb), q: bcgQuadrant(part, croissance) };
  });
}

/* ------------------------------------------------------------------------------------------- *
 * CAS total — calibration source for the Simulateur's `SIM_BASE.cas` (BUILD_KIT.md §8.2
 * "SIM_BASE ← calibrer sur données réelles" / §11 "Simulateur | summaries/quanti (calibrage)")
 * ------------------------------------------------------------------------------------------- */

/**
 * computeCasSummary({orders}) -> { casTotal, casN1Total }
 * Sums `cas` (current-year revenue) and `casN1` (prior-year revenue) across ALL `orders` rows
 * (P&L, same source as computeBcg — see that function's header for the `orders` row shape),
 * regardless of `bu`/`fournisseur` grouping — this is the portfolio-wide total, not a per-BU
 * breakdown (computeBcg already covers the per-BU view).
 * Returns { casTotal: null, casN1Total: null } (not 0) when `orders` is empty/missing — same
 * graceful-null convention as topNConcentration/computePipeline: "no data yet" must not render
 * as a real zero. Rows missing a numeric `cas`/`casN1` contribute 0 to that specific sum (a
 * malformed row shouldn't zero out the whole total), matching computeBcg's `Number(...) || 0`
 * tolerance.
 */
function computeCasSummary({ orders } = {}) {
  if (!Array.isArray(orders) || orders.length === 0) return { casTotal: null, casN1Total: null };
  let casTotal = 0;
  let casN1Total = 0;
  for (const r of orders) {
    casTotal += Number(r && r.cas) || 0;
    casN1Total += Number(r && r.casN1) || 0;
  }
  return { casTotal: Math.round(casTotal), casN1Total: Math.round(casN1Total) };
}

/* ------------------------------------------------------------------------------------------- *
 * Pipeline pondéré / win rate (BUILD_KIT.md §9 "LIVE → pipeline pondéré, win rate")
 * ------------------------------------------------------------------------------------------- */

/**
 * étape → probabilité map. BUILD_KIT.md/DELTA_01 mention "win rate (6 vs 7)" (LIVE's own step
 * numbering, presumably étape 6 = Gagné, étape 7 = Perdu, per DELTA_01 §3bis.E "Win/Loss —
 * opportunities étapes 6/7"), but do not spell out the full étape list/labels. Absent the real
 * LIVE workbook, a conventional 5-stage sales-pipeline vocabulary is assumed here (documented in
 * functions/parsers/live.js) — calibrate this map (labels + probabilities) once the real LIVE
 * `étape` values are known.
 */
const ETAPE_PROBABILITY = {
  Qualification: 0.2,
  Proposition: 0.4,
  Négociation: 0.6,
  Verbal: 0.8,
  Gagné: 1.0,
  Perdu: 0,
};

function etapeProbability(etape) {
  return Object.prototype.hasOwnProperty.call(ETAPE_PROBABILITY, etape) ? ETAPE_PROBABILITY[etape] : 0.3; // unknown étape → conservative mid-pipeline guess
}

/**
 * computePipeline({opportunities}) -> { pipelinePondere, realise, winRate }
 * pipelinePondere = Σ(montant × probabilité-per-étape) over OPEN opportunities only (étape not in
 * ['Gagné','Perdu']). Une prévision pondérée ne doit PAS inclure le CA déjà réalisé (Gagné=1.0) ni
 * les affaires perdues : sinon le "pondéré" gonfle avec du réalisé et ment sur ce qu'il reste à
 * fermer (audit doubler-CA, levier VICTOIRE). Le CA gagné est exposé à part via `realise`.
 * realise = Σ(montant) des opportunités Gagné — le réalisé issu du pipe, distinct de la prévision.
 * winRate = count(étape=='Gagné') / count(étape in ['Gagné','Perdu']) — null if there are no
 * closed opportunities yet (0/0 is undefined, not 0%).
 */
function computePipeline({ opportunities } = {}) {
  if (!Array.isArray(opportunities) || opportunities.length === 0) {
    return { pipelinePondere: null, realise: null, winRate: null };
  }
  let pipelinePondere = 0;
  let realise = 0;
  let gagne = 0;
  let closed = 0;
  for (const o of opportunities) {
    const montant = Number(o && o.montant) || 0;
    const etape = o && o.etape;
    if (etape === "Gagné") {
      realise += montant;
      gagne += 1;
      closed += 1;
    } else if (etape === "Perdu") {
      closed += 1;
    } else {
      // Affaires OUVERTES uniquement dans la prévision pondérée.
      pipelinePondere += montant * etapeProbability(etape);
    }
  }
  return {
    pipelinePondere: Math.round(pipelinePondere),
    realise: Math.round(realise),
    winRate: closed > 0 ? Math.round((gagne / closed) * 100) / 100 : null,
    wins: gagne,      // nb d'opportunités Gagné (échantillon du taux de conversion)
    closed,           // nb d'opportunités closes (Gagné + Perdu) — dénominateur du win-rate
  };
}

/* ------------------------------------------------------------------------------------------- *
 * KRIs (BUILD_KIT.md §2 row 4 "10 KRIs leading" / §9)
 * ------------------------------------------------------------------------------------------- */

/**
 * computeKris({orders, opportunities, invoices}) -> Array<{n, u, val, stat}>
 * Field names (`n`, `u`, `val`, `stat`) match web/src/modules/veille/data.ts's `KRI` sample
 * constant (minus `data`/sparkline history and `dir`, which need a TIME SERIES of snapshots —
 * this function only has a single point-in-time ingestion's worth of data, so no sparkline can be
 * derived here; the frontend hook treats `data`/`dir` as optional and falls back to "—").
 *
 * Implements a subset of the "10 KRIs leading" that are actually derivable from the 3 internal
 * sources wired in V4 (orders/opportunities/invoices — no creditLines/objectives yet, those are
 * out of DELTA_01 §3bis.A's V4 scope too):
 *   - "Taux de conversion" = winRate × 100 (from computePipeline).
 *   - "Saturation lignes fournisseurs" = pouvoirFournisseurs (from computePorterForces) — reusing
 *     the Top-3 fournisseur CAS concentration as a saturation PROXY, since real "ligne de crédit"
 *     saturation needs `creditLines` (not in V4's scope; DELTA_01 §3bis.A lists creditLines as a
 *     SEPARATE source feeding this KRI "properly" later).
 *   - "Délai commande→facturation" = average days between `dateCommande` and `dateFacturation`
 *     across `invoices`.
 *   - "Part de récurrent" = DELTA_01 §3bis.F explicitly calls out that this KRI requires a
 *     "récurrent vs projet" tag that does not exist yet on orders/opportunities ("Prérequis
 *     internes à créer... sinon KRIs en estimation"). Per that documented prerequisite, this
 *     function returns `val: null` with an explicit caveat string rather than fabricating a
 *     number from unrelated data.
 * `stat` (ok/warn/alert) thresholds are placeholders — calibrate against real historical
 * distributions once available; documented per-KRI below.
 */
function computeKris({ orders, opportunities, invoices } = {}) {
  const kris = [];

  const { winRate, wins, closed } = computePipeline({ opportunities });
  // CRÉDIBILITÉ (audit écran KRI 2026-07) : un « 100 % » sur 2-3 deals est un artefact de couverture,
  // pas un feu vert. Sous un échantillon minimal d'affaires CLOSES, on N'AFFICHE PAS de statut coloré
  // (stat null) et on l'explique ; au-dessus, on montre toujours l'échantillon (n gagnés / n clos).
  const MIN_CLOSED_FOR_STATUS = 5;
  const enoughSample = winRate != null && closed >= MIN_CLOSED_FOR_STATUS;
  kris.push({
    n: "Taux de conversion",
    u: "%",
    val: winRate != null ? Math.round(winRate * 100) : null,
    // Placeholder thresholds: >=55% ok, >=40% warn, else alert (below industry-typical B2B win rates).
    stat: !enoughSample ? null : winRate >= 0.55 ? "ok" : winRate >= 0.4 ? "warn" : "alert",
    sub: winRate == null ? null
      : enoughSample ? `${wins} gagné${wins > 1 ? "s" : ""} / ${closed} clos`
        : `échantillon insuffisant — ${wins} gagné${wins > 1 ? "s" : ""} / ${closed} clos (min. ${MIN_CLOSED_FOR_STATUS} pour un statut fiable)`,
  });

  const { pouvoirFournisseurs } = computePorterForces({ orders });
  kris.push({
    // Renommé (audit écran KRI) : ce n'est PAS une saturation de lignes de crédit mais la concentration
    // des achats sur le Top-3 fournisseurs (proxy de dépendance, faute de données de lignes de crédit).
    n: "Dépendance Top-3 fournisseurs",
    u: "%",
    val: pouvoirFournisseurs,
    hint: "Part des achats (CAS) concentrée sur vos 3 principaux fournisseurs — proxy de dépendance/risque d'approvisionnement (les vraies lignes de crédit ne sont pas encore importées).",
    // Placeholder thresholds: <60% ok, <80% warn, else alert (high supplier concentration = risk).
    stat: pouvoirFournisseurs == null ? null : pouvoirFournisseurs < 60 ? "ok" : pouvoirFournisseurs < 80 ? "warn" : "alert",
  });

  let delaiVal = null;
  let delaiStat = null;
  if (Array.isArray(invoices) && invoices.length > 0) {
    const delays = [];
    for (const inv of invoices) {
      const cmd = Date.parse(inv && inv.dateCommande);
      const fac = Date.parse(inv && inv.dateFacturation);
      if (!Number.isNaN(cmd) && !Number.isNaN(fac) && fac >= cmd) {
        delays.push((fac - cmd) / (24 * 60 * 60 * 1000));
      }
    }
    if (delays.length > 0) {
      delaiVal = Math.round(delays.reduce((s, d) => s + d, 0) / delays.length);
      // Placeholder thresholds: <=90j ok, <=120j warn, else alert.
      delaiStat = delaiVal <= 90 ? "ok" : delaiVal <= 120 ? "warn" : "alert";
    }
  }
  kris.push({ n: "Délai commande→facturation", u: " j", val: delaiVal, stat: delaiStat });

  kris.push({
    n: "Part de récurrent",
    u: "%",
    val: null,
    stat: null,
    caveat: "Indisponible : nécessite de taguer chaque commande « récurrent » ou « projet » dans l'import (LIVE/P&L). Une fois ce champ présent, la part de récurrent se calcule automatiquement.",
  });

  return kris;
}

/* ------------------------------------------------------------------------------------------- *
 * Value-at-stake (BUILD_KIT.md §8.3 "ev = probabilité × impact" / §11 "Création de valeur")
 * ------------------------------------------------------------------------------------------- */

/**
 * computeValueAtStake({opportunities}) -> Array<{n, type, p, impact}>
 * Derived from OPEN opportunities only (étape not in ['Gagné','Perdu']) — closed deals are
 * either already realized (Gagné, not "at stake" anymore) or dead (Perdu, no value left at
 * stake). `p` reuses the étape→probabilité map from computePipeline; `impact` = montant;
 * `type` is always 'opp' — LIVE has no negative/threat rows (a threat would be e.g. "risk of
 * losing an existing recurring contract", which isn't represented in the opportunities pipeline
 * at all). BUILD_KIT.md/DELTA_01 note that threats in the maquette's VAS sample come from a
 * different concern entirely: `intelItems` with `stance:'threat'` (the veille/signals side of
 * the app, V2/V3 scope) — merging those into this same array is explicitly OUT of V4's scope
 * (V4 is "quanti interne" only); a later phase could union computeValueAtStake's opp rows with
 * a threat-items summary. Not attempted here.
 * Sorted by impact descending (matches the maquette's Valeur.tsx client-side sort by |ev|, though
 * the sort key there is |ev| — this function returns raw rows; the sort-by-|ev| step stays a
 * frontend concern, same division of labor as the maquette).
 */
function computeValueAtStake({ opportunities } = {}) {
  if (!Array.isArray(opportunities) || opportunities.length === 0) return [];
  return opportunities
    .filter((o) => o && o.etape !== "Gagné" && o.etape !== "Perdu")
    .map((o) => ({
      n: o.client ? `${o.client}${o.idc ? " · " + o.idc : ""}` : o.idc || "Opportunité",
      client: o.client || null, // kept separate from the display label so downstream matching
      // (computePipelineInfluenced) doesn't have to parse `n` back apart
      type: "opp",
      p: etapeProbability(o.etape),
      impact: Math.round(Number(o.montant) || 0),
    }))
    .sort((a, b) => Math.abs(b.p * b.impact) - Math.abs(a.p * a.impact));
}

/* ------------------------------------------------------------------------------------------- *
 * Granularité de la croissance (Portefeuille — "où gagner", BUILD_KIT.md §5.4)
 * ------------------------------------------------------------------------------------------- */

/**
 * computeGranularite({orders}) -> Array<{seg, casN, casN1, delta}>
 * Decomposes portfolio growth by segment (BU): for each BU, current-year CAS, prior-year CAS and
 * the raw delta (casN − casN1, raw XOF — can be negative, unlike computeBcg's clamped 0-1
 * `croissance`). Sorted by delta descending so the view reads top-to-bottom as "où l'on gagne →
 * où l'on perd". Same `orders` row shape as computeBcg ({bu, cas, casN1, ...}). Returns [] when
 * empty — an empty list is a renderable state.
 * "Segment" is the BU for now — a finer segment×offre axis needs an offer/segment tag that the
 * internal sources don't carry yet (same prerequisite pattern as recurrentShare).
 */
function computeGranularite({ orders } = {}) {
  if (!Array.isArray(orders) || orders.length === 0) return [];
  const byBu = new Map();
  for (const r of orders) {
    const bu = r && r.bu;
    if (!bu) continue;
    const entry = byBu.get(bu) || { casN: 0, casN1: 0 };
    entry.casN += Number(r.cas) || 0;
    entry.casN1 += Number(r.casN1) || 0;
    byBu.set(bu, entry);
  }
  return [...byBu.entries()]
    .map(([seg, v]) => ({ seg, casN: Math.round(v.casN), casN1: Math.round(v.casN1), delta: Math.round(v.casN - v.casN1) }))
    .sort((a, b) => b.delta - a.delta);
}

/* ------------------------------------------------------------------------------------------- *
 * Pipeline influencé par la veille (Radar exécutif — "pipeline influencé", BUILD_KIT.md §6
 * summaries/veille_exec.pipelineInfluenced). Left at 0 until 2026-07-02, when the internal
 * pipeline became available via nt360 — now computed as the value-at-stake carried by clients
 * that the veille actually tracks or has produced signals about.
 * ------------------------------------------------------------------------------------------- */

/** Uppercases, strips accents, collapses non-alphanumerics to single spaces — tolerant matching
 * between free-typed entity names ("Orange CI") and pipeline client names ("ORANGE-CI SA"). */
function normalizeEntityName(name) {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * computePipelineInfluenced({valueAtStake, entities}) -> number|null
 * Σ `impact` (raw XOF) of value-at-stake rows whose `client` matches one of the veille's entities
 * (intelWatchlist names + intelItems.ent values). Match = whole-token containment either way
 * ("ORANGE CI" tokens appear in "ORANGE CI SA", or vice versa) — token-based to avoid substring
 * false positives ("BAD" must be its own word, not part of another). Returns null (not 0) when
 * there is no value-at-stake data at all — "no pipeline yet" must not render as "0 influencé".
 */
function computePipelineInfluenced({ valueAtStake, entities } = {}) {
  if (!Array.isArray(valueAtStake) || valueAtStake.length === 0) return null;
  const entityTokenSets = (Array.isArray(entities) ? entities : [])
    .map(normalizeEntityName)
    .filter(Boolean)
    .map((n) => n.split(" "));
  if (entityTokenSets.length === 0) return 0;

  const containsSeq = (haystack, needle) => {
    if (needle.length === 0 || needle.length > haystack.length) return false;
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };

  let total = 0;
  for (const row of valueAtStake) {
    const clientTokens = normalizeEntityName(row && row.client).split(" ").filter(Boolean);
    if (clientTokens.length === 0) continue;
    const matched = entityTokenSets.some(
      (ent) => containsSeq(clientTokens, ent) || containsSeq(ent, clientTokens)
    );
    if (matched) total += Number(row.impact) || 0;
  }
  return Math.round(total);
}

module.exports = {
  computePorterForces,
  computeGranularite,
  computePipelineInfluenced,
  normalizeEntityName,
  computeBcg,
  computeCasSummary,
  computePipeline,
  computeKris,
  computeValueAtStake,
  topNConcentration,
  bcgQuadrant,
  etapeProbability,
  ETAPE_PROBABILITY,
};
