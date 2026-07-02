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

async function seed() {
  initializeApp();
  const db = getFirestore();

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

  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
