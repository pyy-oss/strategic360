"use strict";

/**
 * One-shot cleanup — deletes the maquette-derived FICTIONAL business records that seed.js used to
 * write (fake decisions, invented win/loss records against "Concurrent A/B", sample initiatives,
 * illustrative tech-radar/innovation entries, the diagnostic first-jet, sample scenarios), per
 * the "données réelles partout" decision (2026-07-02). From now on these collections are
 * populated exclusively through the app's own contribution forms / real workflows.
 *
 * DELIBERATELY KEPT (real data / real configuration, NOT fiction):
 *   - config/permissions, config/bootstrap        (RBAC config)
 *   - intelWatchlist                              (real entities: Cisco, Orange CI, BCEAO, ...)
 *   - intelSources                                (real URLs: ARTCI, BCEAO, BAD, ...)
 *   - intelItems                                  (real AI-classified signals + human submissions)
 *   - summaries/*                                 (recomputed automatically from real data)
 *
 * Env vars: GCLOUD_PROJECT (set by google-github-actions/auth), FIRESTORE_DATABASE_ID
 * (e.g. "strategic360"). Usage (CI): .github/workflows/cleanup-sample-data.yml.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

/** Whole collections whose current content is entirely maquette-derived fiction. */
const COLLECTIONS_TO_PURGE = [
  "strategicThemes",
  "initiatives",
  "decisions",
  "battlecards",
  "winLoss",
  "scenarios",
  "techRadar",
  "innovationPortfolio",
  "actions", // seeded empty, but purge defensively in case sample entries were added manually
];

/** Individual seeded docs (collection stays — future docs will be real, human-authored). */
const DOCS_TO_PURGE = ["frameworks/diagnostic"];

async function purgeCollection(db, name) {
  const snap = await db.collection(name).get();
  if (snap.empty) {
    console.log(`- ${name}: already empty`);
    return 0;
  }
  // Batched deletes, 500 ops per batch (Firestore limit).
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 500)) batch.delete(doc.ref);
    await batch.commit();
    deleted += Math.min(500, docs.length - i);
  }
  console.log(`- ${name}: deleted ${deleted} doc(s)`);
  return deleted;
}

async function main() {
  initializeApp();
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
  const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);

  console.log(`Purging maquette sample data from database "${databaseId}"...`);

  let total = 0;
  for (const name of COLLECTIONS_TO_PURGE) {
    total += await purgeCollection(db, name);
  }
  for (const path of DOCS_TO_PURGE) {
    const ref = db.doc(path);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      total += 1;
      console.log(`- ${path}: deleted`);
    } else {
      console.log(`- ${path}: not present`);
    }
  }

  // summaries/veille_exec caches decisionsPending/winRateByCompetitor/okrProgress derived from the
  // now-purged collections; delete so the next intelItems write / hourly schedule recomputes it
  // from real (now-empty) sources instead of serving stale fiction.
  for (const path of ["summaries/veille_exec"]) {
    const ref = db.doc(path);
    if ((await ref.get()).exists) {
      await ref.delete();
      console.log(`- ${path}: deleted (will be recomputed by aggregateVeilleExec)`);
    }
  }

  console.log(`Cleanup complete — ${total} fictional doc(s) removed. Kept: config/*, intelWatchlist, intelSources, intelItems.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
