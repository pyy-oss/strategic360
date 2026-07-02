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

async function seed() {
  initializeApp();
  const db = getFirestore();

  await db.doc("config/permissions").set({ matrix: DEFAULT_PERMISSIONS_MATRIX });
  console.log("Seeded config/permissions with default RBAC matrix.");

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
