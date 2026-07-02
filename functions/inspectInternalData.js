"use strict";

/**
 * READ-ONLY inventory of the OTHER apps' data living in the shared Firebase project
 * (propulse-business-87f7a) — per the "données internes disponibles dans une autre application"
 * decision (2026-07-02): the internal business data (P&L, facturation, clients, …) that
 * strategic360's quanti views need is already in Firestore, written by a sibling app, so we map
 * its structure before wiring a sync instead of asking for Excel uploads.
 *
 * STRICTLY READ-ONLY: this script only calls listCollections/get — it never writes, and it
 * deliberately prints FIELD NAMES + VALUE TYPES (plus a short truncated preview) rather than full
 * documents, to keep business values out of CI logs as much as possible while still revealing the
 * schema. "Éviter de détruire l'existant" is the standing rule for this shared project.
 *
 * Env vars:
 *   GCLOUD_PROJECT           set by google-github-actions/auth
 *   INSPECT_DATABASE_IDS     comma-separated Firestore database ids to inspect
 *                            (e.g. "(default)" — the sibling app's DB; strategic360's own named
 *                            DB is already known and skipped unless listed explicitly)
 *
 * Usage (CI): .github/workflows/inspect-internal-data.yml
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const SAMPLE_DOCS = 3; // docs sampled per collection to detect schema variants
const PREVIEW_CHARS = 60;

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v && typeof v.toDate === "function") return "timestamp";
  if (typeof v === "object") return "map";
  return typeof v;
}

function preview(v) {
  let s;
  if (v === null) s = "null";
  else if (v && typeof v.toDate === "function") s = v.toDate().toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (s.length > PREVIEW_CHARS) s = s.slice(0, PREVIEW_CHARS) + "…";
  return s;
}

async function inspectCollection(col, indent) {
  const pad = "  ".repeat(indent);
  const snap = await col.limit(SAMPLE_DOCS).get();
  // NB: no cheap way to count a whole collection without reading it; sample size is enough to
  // reveal the schema, and `snap.size < SAMPLE_DOCS` tells us it's a tiny collection anyway.
  console.log(`${pad}- ${col.id} (échantillon: ${snap.size} doc${snap.size > 1 ? "s" : ""}${snap.size === SAMPLE_DOCS ? "+" : ""})`);
  const fields = new Map(); // field -> {types:Set, sample}
  for (const doc of snap.docs) {
    const data = doc.data();
    for (const [k, v] of Object.entries(data)) {
      if (!fields.has(k)) fields.set(k, { types: new Set(), sample: preview(v) });
      fields.get(k).types.add(typeOf(v));
    }
  }
  for (const [k, info] of [...fields.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${pad}    ${k}: ${[...info.types].join("|")}  ex: ${info.sample}`);
  }
  // One level of subcollections on the first sampled doc (enough to reveal nesting patterns).
  if (snap.docs.length) {
    const subs = await snap.docs[0].ref.listCollections();
    for (const sub of subs) {
      console.log(`${pad}    ↳ sous-collection sur ${snap.docs[0].id}:`);
      await inspectCollection(sub, indent + 3);
    }
  }
}

async function main() {
  initializeApp();
  const ids = (process.env.INSPECT_DATABASE_IDS || "(default)")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const databaseId of ids) {
    console.log(`\n========== Base Firestore "${databaseId}" ==========`);
    try {
      const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);
      const cols = await db.listCollections();
      if (!cols.length) {
        console.log("(aucune collection racine)");
        continue;
      }
      console.log(`${cols.length} collection(s) racine :`);
      for (const col of cols) {
        try {
          await inspectCollection(col, 1);
        } catch (err) {
          console.log(`  - ${col.id}: ERREUR lecture — ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`Base "${databaseId}" inaccessible: ${err.message}`);
    }
  }
  console.log("\nInventaire terminé (aucune écriture effectuée).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Inspection failed:", err);
    process.exit(1);
  });
