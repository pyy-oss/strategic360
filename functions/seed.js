"use strict";

/**
 * Seed script — writes `config/permissions` with the default RBAC matrix from
 * BUILD_KIT.md §7 ("Défauts `config/permissions` pour le module `veille`").
 *
 * IMPORTANT — matrix shape mirrors firestore.rules' `lvl(m)` exactly:
 *   lvl(m) = role() in ['direction'] ? 'write' : matrix()[role()][m]
 *   canRead(m) = lvl(m) in ['read', 'write']
 *   canWrite(m) = lvl(m) == 'write'
 * So each `matrix[role][module]` value must be one of: 'none' | 'read' | 'write'.
 * (`direction` doesn't strictly need an entry — the rules short-circuit it to 'write' — but we
 * write one anyway for clarity/consistency when the matrix doc is inspected directly.)
 *
 * BUILD_KIT.md §7 defaults for module "veille":
 *   write        -> direction, strategie, innovation
 *   contribution -> commercial_dir, commercial   (= 'write' at the rules level: rules only
 *                    distinguish none/read/write; "contribution" just means create/update
 *                    intelItems, which the rules gate the same way as full write)
 *   read         -> pmo, achats, lecture
 *
 * No real Firebase project is provisioned in this sandbox. To run this against the local
 * Emulator Suite:
 *
 *   1. firebase emulators:start --only firestore
 *   2. In another shell:
 *        export FIRESTORE_EMULATOR_HOST=localhost:8080
 *        export GCLOUD_PROJECT=veille-nt-ci   # or your .firebaserc project id
 *        node functions/seed.js
 *
 * Against a real project instead, unset FIRESTORE_EMULATOR_HOST and provide credentials
 * (e.g. GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key), then run the same
 * `node functions/seed.js`.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const DEFAULT_PERMISSIONS_MATRIX = {
  direction: { veille: "write" },
  strategie: { veille: "write" },
  innovation: { veille: "write" },
  commercial_dir: { veille: "write" },
  commercial: { veille: "write" },
  pmo: { veille: "read" },
  achats: { veille: "read" },
  lecture: { veille: "read" },
};

// intelWatchlist seed entries — taken from the maquette's `WATCH` sample data (docs/maquette_reference.jsx)
// so the emulator-backed app has something to show for BUILD_KIT.md V2 ("intelWatchlist/intelSources").
// Deliberately NOT seeding `intelItems`: V2's point is switching the Fil/Détection views from static
// sample constants to real Firestore writes made through the app's contribution UI (or later ingestion),
// so fake intelItems here would defeat that purpose.
const WATCHLIST_SEED = [
  { name: "Cisco", type: "Éditeur/Constructeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Palo Alto", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Fortinet", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "HPE", type: "Constructeur", geo: "Afrique", priority: "Moyenne", active: true },
  { name: "Microsoft", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Hiperdist", type: "Distributeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Westcon", type: "Distributeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Exclusive Networks", type: "Distributeur", geo: "Afrique", priority: "Moyenne", active: true },
  { name: "Orange CI", type: "Client/Prospect", geo: "Côte d'Ivoire", priority: "Haute", active: true },
  { name: "BAD", type: "Client/Bailleur", geo: "Afrique de l'Ouest", priority: "Haute", active: true },
  { name: "BCEAO", type: "Client/Régulateur", geo: "Afrique de l'Ouest", priority: "Haute", active: true },
];

// intelSources seed entries — first jet per BUILD_KIT.md §9.B (AO & financements, réglementaire, partenaires).
const SOURCES_SEED = [
  { name: "SIGMAP / DGMP (marchés publics CI)", kind: "portal", url: "https://www.marchespublics.ci", axis: "clients_prospects", active: true },
  { name: "ARMP — Autorité de Régulation des Marchés Publics", kind: "web", url: "https://www.armp.ci", axis: "clients_prospects", active: true },
  { name: "Banque Africaine de Développement — Avis d'appels d'offres", kind: "rss", url: "https://www.afdb.org", axis: "clients_prospects", active: true },
  { name: "ARTCI — Autorité de Régulation des Télécommunications/TIC de Côte d'Ivoire", kind: "web", url: "https://www.artci.ci", axis: "reglementaire", active: true },
  { name: "BCEAO — Banque Centrale des États de l'Afrique de l'Ouest", kind: "web", url: "https://www.bceao.int", axis: "reglementaire", active: true },
  { name: "Cisco EOL/EOS Bulletins", kind: "rss", url: "https://www.cisco.com/c/en/us/products/eos-eol-listing.html", axis: "partenaires", active: true },
];

// ---------------------------------------------------------------------------------------------
// V6 "Exécution & concurrence" seed entries — derived from the maquette's static sample data
// (web/src/modules/veille/data.ts: INITIATIVES, DECISIONS, CONCURRENTS, SCENARIOS/SCEN_PROB,
// RADAR_TECH, INNOV) so the emulator-backed app has something to show for Exécution, Plan
// d'action, Concurrence, Scénarios, Diagnostic and Tech Radar & Innovation once auth/RBAC is
// live. `actions` is intentionally NOT seeded here for the same reason `intelItems` isn't
// seeded in V2: it's the collection the Plan d'action contribution form is meant to populate.
// ---------------------------------------------------------------------------------------------

const STRATEGIC_THEMES_SEED = [
  { title: "Croissance récurrente", description: "Industrialiser le managed/SOC pour la marge et la prévisibilité.", owner: "Dir. Cyber", order: 1 },
  { title: "Souveraineté & Cloud", description: "Construire une offre cloud souverain différenciante.", owner: "Dir. Cloud", order: 2 },
  { title: "Excellence commerciale", description: "Systématiser battlecards et win/loss pour améliorer le taux de victoire.", owner: "Dir. Commercial", order: 3 },
  { title: "Innovation", description: "Accélérer l'avant-vente et les offres par l'IA.", owner: "Dir. Innovation", order: 4 },
];

// title -> theme title (resolved to themeId once strategicThemes are seeded)
const INITIATIVES_SEED = [
  { title: "Industrialiser le SOC managé", themeTitle: "Croissance récurrente", objective: "20 contrats managés d'ici T4", keyResults: ["20 contrats managés signés"], owner: "Dir. Cyber", status: "en cours", horizon: "H1", progress: 0.45, linkedItems: [] },
  { title: "Lancer l'offre cloud souverain", themeTitle: "Souveraineté & Cloud", objective: "3 références clients signées", keyResults: ["3 références clients signées"], owner: "Dir. Cloud", status: "en cours", horizon: "H2", progress: 0.3, linkedItems: [] },
  { title: "Battlecards & win/loss systématiques", themeTitle: "Excellence commerciale", objective: "Taux de victoire +5 pts", keyResults: ["Taux de victoire +5 pts"], owner: "Dir. Commercial", status: "en cours", horizon: "H1", progress: 0.6, linkedItems: [] },
  { title: "Copilot avant-vente IA", themeTitle: "Innovation", objective: "−30% temps de réponse AO", keyResults: ["−30% temps de réponse AO"], owner: "Dir. Innovation", status: "en cours", horizon: "H2", progress: 0.2, linkedItems: [] },
];

const DECISIONS_SEED = [
  { title: "Prioriser la montée en compétence Azure souverain", date: "2026-06-26", decidedBy: "CODIR", statut: "Actée", context: "", options: [], chosen: "Monter en compétence Azure souverain", rationale: "", linkedItems: ["Signaux #4", "Signal #8"] },
  { title: "Sécuriser le stock Catalyst avant EOL", date: "2026-06-29", decidedBy: "DRO", statut: "En cours", context: "", options: [], chosen: "Sécuriser le stock avant l'EOL Cisco", rationale: "", linkedItems: ["Signal #1"] },
  { title: "Constituer un consortium pour le programme BAD", date: "2026-06-27", decidedBy: "DG", statut: "En attente", context: "", options: [], chosen: "Constituer un consortium", rationale: "", linkedItems: ["Signal #2"] },
];

const BATTLECARDS_SEED = [
  { competitor: "Concurrent A", positioning: "Datacenter, proximité DSI banques", strengths: ["Datacenter, proximité DSI banques"], weaknesses: ["Faible sur cybersécurité avancée"], ourWinThemes: ["Notre expertise cyber + managed + portage"], theirLikelyMoves: [], objectionHandling: [], recentMoves: [] },
  { competitor: "Concurrent B (low-cost)", positioning: "Prix agressif segment PME", strengths: ["Prix agressif segment PME"], weaknesses: ["Peu de certifications, pas de récurrent"], ourWinThemes: ["Différenciation managed & SLA, valeur long terme"], theirLikelyMoves: [], objectionHandling: [], recentMoves: [] },
  { competitor: "Telco B2B", positioning: "Connectivité intégrée, base installée", strengths: ["Connectivité intégrée, base installée"], weaknesses: ["Moins agile sur l'intégration multi-éditeurs"], ourWinThemes: ["Neutralité éditeur + expertise projet"], theirLikelyMoves: [], objectionHandling: [], recentMoves: [] },
];

// win/deals from the maquette's CONCURRENTS sample (win rate, deal count) expanded into
// individual winLoss entries so `winRateByCompetitor()` (web/src/modules/veille/lib/execution.ts)
// reproduces the same aggregate numbers client-side.
const WIN_LOSS_SEED = (() => {
  const sample = [
    { competitor: "Concurrent A", win: 0.55, deals: 11 },
    { competitor: "Concurrent B (low-cost)", win: 0.7, deals: 6 },
    { competitor: "Telco B2B", win: 0.48, deals: 9 },
  ];
  const entries = [];
  for (const s of sample) {
    const wins = Math.round(s.win * s.deals);
    for (let i = 0; i < s.deals; i++) {
      entries.push({
        competitor: s.competitor,
        result: i < wins ? "win" : "loss",
        reason: i < wins ? "Différenciation managed/cyber" : "Prix",
        amount: null,
        lesson: "",
        date: "2026-06-01",
      });
    }
  }
  return entries;
})();

const SCENARIOS_SEED = [
  {
    title: "Pression prix hyperscalers × souveraineté réglementaire",
    axisX: "Pression prix des hyperscalers",
    axisY: "Exigence de souveraineté réglementaire",
    worlds: [
      { q: "Souveraineté forte × Prix hyperscalers agressifs", d: "Cloud souverain local valorisé mais concurrence prix. → Miser sur conformité + managed différenciant.", c: "#C9A24B" },
      { q: "Souveraineté forte × Prix hyperscalers élevés", d: "Terrain le plus favorable : demande locale, marges préservées. → Investir cloud souverain + cyber.", c: "#3E8E63" },
      { q: "Souveraineté faible × Prix agressifs", d: "Désintermédiation maximale par hyperscalers. → Se replier sur managed/cyber à forte valeur.", c: "#B85C4A" },
      { q: "Souveraineté faible × Prix élevés", d: "Statu quo, avantage à l'intégration classique. → Optimiser sourcing et efficacité.", c: "#4E7A96" },
    ],
    probs: [0.3, 0.4, 0.15, 0.15],
    triggers: [],
    responses: [],
  },
];

const TECH_RADAR_SEED = [
  { name: "Zero Trust / ZTNA", quadrant: 0, ring: "adopter", momentum: "↑", rationale: "", linkedItems: [] },
  { name: "XDR", quadrant: 0, ring: "adopter", momentum: "↑", rationale: "", linkedItems: [] },
  { name: "SASE", quadrant: 0, ring: "essayer", momentum: "↑", rationale: "", linkedItems: [] },
  { name: "Cloud souverain", quadrant: 1, ring: "evaluer", momentum: "↑", rationale: "", linkedItems: [] },
  { name: "FinOps", quadrant: 1, ring: "essayer", momentum: "→", rationale: "", linkedItems: [] },
  { name: "Conteneurs/K8s", quadrant: 1, ring: "essayer", momentum: "→", rationale: "", linkedItems: [] },
  { name: "IA générative (RAG)", quadrant: 2, ring: "evaluer", momentum: "↑", rationale: "", linkedItems: [] },
  { name: "Copilots métier", quadrant: 2, ring: "evaluer", momentum: "↑", rationale: "", linkedItems: [] },
  { name: "Data platform", quadrant: 2, ring: "essayer", momentum: "→", rationale: "", linkedItems: [] },
  { name: "SD-WAN", quadrant: 3, ring: "adopter", momentum: "→", rationale: "", linkedItems: [] },
  { name: "Wi-Fi 7", quadrant: 3, ring: "evaluer", momentum: "↑", rationale: "", linkedItems: [] },
  { name: "MPLS traditionnel", quadrant: 3, ring: "suspendre", momentum: "↓", rationale: "", linkedItems: [] },
];

const INNOVATION_PORTFOLIO_SEED = [
  { title: "SOC managé UEMOA", reach: 8, impact: 9, confidence: 0.8, effort: 6, stage: "pilote", owner: "Dir. Cyber", budget: null, horizon: "H1" },
  { title: "Offre cloud souverain", reach: 6, impact: 8, confidence: 0.6, effort: 8, stage: "exploration", owner: "Dir. Cloud", budget: null, horizon: "H2" },
  { title: "Copilot avant-vente (IA)", reach: 5, impact: 6, confidence: 0.7, effort: 3, stage: "poc", owner: "Dir. Innovation", budget: null, horizon: "H1" },
  { title: "Conformité BCEAO packagée", reach: 7, impact: 7, confidence: 0.75, effort: 4, stage: "pilote", owner: "Dir. Cyber", budget: null, horizon: "H1" },
  { title: "Managed SD-WAN", reach: 6, impact: 6, confidence: 0.7, effort: 5, stage: "exploration", owner: "Dir. Cloud", budget: null, horizon: "H2" },
];

async function seed() {
  initializeApp();
  // FIRESTORE_DATABASE_ID: set this when this project is shared with other apps, to seed the
  // dedicated named database (e.g. "strategic360") instead of "(default)" — see index.js's
  // matching comment and functions/.env.example. Falls back to "(default)" when unset.
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
  const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);

  await db.doc("config/permissions").set({ matrix: DEFAULT_PERMISSIONS_MATRIX });
  console.log("Seeded config/permissions with default RBAC matrix.");

  const watchlistCol = db.collection("intelWatchlist");
  for (const entry of WATCHLIST_SEED) {
    const existing = await watchlistCol.where("name", "==", entry.name).limit(1).get();
    if (existing.empty) {
      await watchlistCol.add(entry);
    }
  }
  console.log(`Seeded intelWatchlist (${WATCHLIST_SEED.length} entries, idempotent by name).`);

  const sourcesCol = db.collection("intelSources");
  for (const entry of SOURCES_SEED) {
    const existing = await sourcesCol.where("name", "==", entry.name).limit(1).get();
    if (existing.empty) {
      await sourcesCol.add({ ...entry, lastFetch: null });
    }
  }
  console.log(`Seeded intelSources (${SOURCES_SEED.length} entries, idempotent by name).`);

  // Bootstrap marker consumed by setUserRole (functions/index.js): stays `false` until the
  // first `direction` account is provisioned via setUserRole, at which point the function
  // flips it to `true` itself. We only ensure the doc exists here so it doesn't 404 on first read.
  const bootstrapRef = db.doc("config/bootstrap");
  const bootstrapSnap = await bootstrapRef.get();
  if (!bootstrapSnap.exists) {
    await bootstrapRef.set({ done: false, ts: FieldValue.serverTimestamp() });
    console.log("Initialized config/bootstrap { done: false }.");
  }

  // --- V6 "Exécution & concurrence" -------------------------------------------------------

  const themesCol = db.collection("strategicThemes");
  const themeIdByTitle = {};
  for (const entry of STRATEGIC_THEMES_SEED) {
    const existing = await themesCol.where("title", "==", entry.title).limit(1).get();
    if (existing.empty) {
      const ref = await themesCol.add(entry);
      themeIdByTitle[entry.title] = ref.id;
    } else {
      themeIdByTitle[entry.title] = existing.docs[0].id;
    }
  }
  console.log(`Seeded strategicThemes (${STRATEGIC_THEMES_SEED.length} entries, idempotent by title).`);

  const initiativesCol = db.collection("initiatives");
  for (const { themeTitle, ...entry } of INITIATIVES_SEED) {
    const existing = await initiativesCol.where("title", "==", entry.title).limit(1).get();
    if (existing.empty) {
      await initiativesCol.add({ ...entry, themeId: themeIdByTitle[themeTitle] ?? null });
    }
  }
  console.log(`Seeded initiatives (${INITIATIVES_SEED.length} entries, idempotent by title).`);

  const decisionsCol = db.collection("decisions");
  for (const entry of DECISIONS_SEED) {
    const existing = await decisionsCol.where("title", "==", entry.title).limit(1).get();
    if (existing.empty) {
      await decisionsCol.add(entry);
    }
  }
  console.log(`Seeded decisions (${DECISIONS_SEED.length} entries, idempotent by title).`);

  const battlecardsCol = db.collection("battlecards");
  for (const entry of BATTLECARDS_SEED) {
    const id = entry.competitor
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    await battlecardsCol.doc(id).set(entry, { merge: true });
  }
  console.log(`Seeded battlecards (${BATTLECARDS_SEED.length} entries, idempotent by deterministic id).`);

  const winLossCol = db.collection("winLoss");
  const existingWinLoss = await winLossCol.limit(1).get();
  if (existingWinLoss.empty) {
    for (const entry of WIN_LOSS_SEED) {
      await winLossCol.add(entry);
    }
    console.log(`Seeded winLoss (${WIN_LOSS_SEED.length} entries).`);
  } else {
    console.log("Skipped winLoss seeding (collection already has entries).");
  }

  const scenariosCol = db.collection("scenarios");
  for (const entry of SCENARIOS_SEED) {
    const existing = await scenariosCol.where("title", "==", entry.title).limit(1).get();
    if (existing.empty) {
      await scenariosCol.add(entry);
    }
  }
  console.log(`Seeded scenarios (${SCENARIOS_SEED.length} entries, idempotent by title).`);

  const techRadarCol = db.collection("techRadar");
  for (const entry of TECH_RADAR_SEED) {
    const existing = await techRadarCol.where("name", "==", entry.name).limit(1).get();
    if (existing.empty) {
      await techRadarCol.add(entry);
    }
  }
  console.log(`Seeded techRadar (${TECH_RADAR_SEED.length} entries, idempotent by name).`);

  const innovationCol = db.collection("innovationPortfolio");
  for (const entry of INNOVATION_PORTFOLIO_SEED) {
    const existing = await innovationCol.where("title", "==", entry.title).limit(1).get();
    if (existing.empty) {
      const rice = Math.round(((entry.reach * entry.impact * entry.confidence) / entry.effort) * 10) / 10;
      await innovationCol.add({ ...entry, rice });
    }
  }
  console.log(`Seeded innovationPortfolio (${INNOVATION_PORTFOLIO_SEED.length} entries, idempotent by title).`);

  // frameworks/diagnostic — content for the Diagnostic view's 3 sub-tabs (issue tree, 7S, maturité),
  // taken verbatim from the maquette's static ISSUE/S7/MATURITE sample data.
  const diagnosticRef = db.doc("frameworks/diagnostic");
  const diagnosticSnap = await diagnosticRef.get();
  if (!diagnosticSnap.exists) {
    await diagnosticRef.set({
      key: "diagnostic",
      version: 1,
      updatedBy: "seed",
      updatedAt: FieldValue.serverTimestamp(),
      content: {
        issue: {
          q: "Comment doubler le revenu rentable en 3 ans ?",
          branches: [
            { t: "Développer le récurrent (marge & prévisibilité)", h: ["Industrialiser le SOC/Managed", "Contrats pluriannuels de support"] },
            { t: "Monter en valeur (mix vers cyber/cloud)", h: ["Basculer le mix hors hardware banalisé", "Packager conformité & souveraineté"] },
            { t: "Conquérir de nouveaux comptes/marchés", h: ["Capter les AO financés (BAD, État)", "Étendre la couverture régionale UEMOA/CEMAC"] },
          ],
        },
        s7: [
          { s: "Stratégie", v: 70 },
          { s: "Structure", v: 60 },
          { s: "Systèmes", v: 55 },
          { s: "Style", v: 65 },
          { s: "Staff", v: 60 },
          { s: "Skills", v: 58 },
          { s: "Valeurs", v: 75 },
        ],
        maturite: [
          { c: "Avant-vente", v: 4 },
          { c: "Delivery", v: 4 },
          { c: "Cybersécurité", v: 4 },
          { c: "Cloud", v: 3 },
          { c: "Managed/SOC", v: 3 },
          { c: "Data/IA", v: 2 },
          { c: "Sourcing/Finance", v: 3 },
        ],
      },
    });
    console.log("Seeded frameworks/diagnostic.");
  }

  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
