"use strict";

/**
 * One-shot re-scoring — reapplies `computePriorityScore` to every non-archived `intelItems` doc.
 * Needed after any scoring-barème change (Action 5.5 de l'audit 2026-07 : sans re-scoring, le fil
 * mélange les scores de l'ancien et du nouveau barème et le tri devient incohérent). Idempotent —
 * safe to re-run.
 *
 * Env vars: GCLOUD_PROJECT (set by google-github-actions/auth), FIRESTORE_DATABASE_ID
 * (e.g. "strategic360"). Usage (CI): .github/workflows/rescore-items.yml.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { computePriorityScore } = require("./domain/scoring");

async function main() {
  initializeApp();
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
  const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);

  const snap = await db.collection("intelItems").get();
  let updated = 0;
  let skippedArchived = 0;
  for (const doc of snap.docs) {
    const item = doc.data();
    if (item.status === "archived") {
      skippedArchived += 1;
      continue;
    }
    const priorityScore = computePriorityScore(item);
    if (priorityScore !== item.priorityScore) {
      await doc.ref.update({ priorityScore });
      updated += 1;
      console.log(`- ${doc.id}: ${item.priorityScore ?? "—"} → ${priorityScore} (${(item.title || "").slice(0, 60)})`);
    }
  }
  console.log(`Rescore complete — ${updated} doc(s) updated, ${skippedArchived} archived skipped, ${snap.size} total.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Rescore failed:", err);
    process.exit(1);
  });
