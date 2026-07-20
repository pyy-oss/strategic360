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

/**
 * INSPECT_MODE="roots": compact overview only — root collections with doc ids (+ name-ish fields)
 * instead of the full field dump. Used to locate a specific workspace/tenant (e.g. "nt360") in a
 * multi-tenant sibling app before pointing a deep inspection at it via INSPECT_PATH.
 * INSPECT_PATH="workspaces/ws_x": deep-inspect only the subcollections of that document.
 */
const NAMEISH = ["name", "title", "label", "company", "companyName", "shopName", "displayName", "slug"];

async function rootsOverview(db) {
  const cols = await db.listCollections();
  console.log(`${cols.length} collection(s) racine :`);
  for (const col of cols) {
    try {
      const snap = await col.limit(25).get();
      console.log(`- ${col.id} (${snap.size}${snap.size === 25 ? "+" : ""} docs)`);
      for (const d of snap.docs) {
        const data = d.data();
        const hints = NAMEISH.filter((k) => typeof data[k] === "string").map((k) => `${k}=${preview(data[k])}`);
        console.log(`    · ${d.id}${hints.length ? `  [${hints.join(", ")}]` : ""}`);
      }
    } catch (err) {
      console.log(`- ${col.id}: ERREUR lecture — ${err.message}`);
    }
  }
}

/**
 * INSPECT_MODE="sources": dump READ-ONLY de la santé des sources de veille (collection intelSources
 * de la base strategic360) — id, nom, kind, actif, échecs consécutifs et lastStatus — pour trier les
 * URL mortes (404/410) des blocages transitoires. Non sensible (URLs/statuts publics). Aucune écriture.
 */
async function sourcesHealth(db) {
  const snap = await db.collection("intelSources").get();
  console.log(`intelSources : ${snap.size} source(s).`);
  const rows = snap.docs.map((d) => {
    const x = d.data() || {};
    return {
      id: d.id,
      name: x.name || "",
      kind: x.kind || "",
      active: x.active !== false,
      fails: Number(x.consecutiveFailures) || 0,
      status: x.lastStatus || "(jamais synchro)",
      url: x.url || "",
    };
  });
  // Tri : échecs d'abord (les plus problématiques), puis par nombre d'échecs décroissant.
  const rank = (s) => (s.status.startsWith("error") ? 0 : s.status.startsWith("degraded") ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || b.fails - a.fails || a.name.localeCompare(b.name));
  for (const r of rows) {
    console.log(`- [${r.active ? "actif" : "OFF  "}] ${r.kind.padEnd(7)} ${r.fails}x  ${r.name}\n    ${r.url}\n    → ${r.status}`);
  }
  const errors = rows.filter((r) => r.status.startsWith("error")).length;
  const degraded = rows.filter((r) => r.status.startsWith("degraded")).length;
  console.log(`\nRésumé : ${errors} en échec · ${degraded} dégradées · ${rows.length - errors - degraded} OK/en attente.`);
}

/**
 * INSPECT_MODE="diag": dump READ-ONLY du diagnostic DOM (`_diag`) persisté par syncSources sur les
 * sources web/web-js qui rendent « ok » mais 0 avis. Sert à construire un extracteur dédié sur PREUVE :
 * on voit la taille du DOM rendu, la présence de JSON embarqué, l'échantillon de liens, et un extrait
 * du HTML. Fiable (lecture Firestore) contrairement au fetch de logs fenêtré.
 */
async function sourceDiag(db) {
  const snap = await db.collection("sourceDiag").get();
  console.log(`${snap.size} source(s) avec diagnostic DOM persisté (collection sourceDiag).\n`);
  for (const d of snap.docs) {
    const g = d.data() || {};
    console.log(`### ${g.name || d.id}  [${g.kind || "?"}]`);
    console.log(`    url=${g.url || ""}`);
    console.log(`    htmlLen=${g.htmlLen} textLen=${g.textLen} jsonEmbedded=${g.jsonEmbedded}`);
    console.log(`    hrefs=${JSON.stringify(g.hrefs || [])}`);
    console.log(`    noticeHrefs=${JSON.stringify(g.noticeHrefs || [])}`);
    if (g.nextData) console.log(`    --- __NEXT_DATA__ (SPA) ---\n${String(g.nextData).replace(/\s+/g, " ").slice(0, 3200)}\n`);
    console.log(`    --- htmlHead ---\n${String(g.htmlHead || "").replace(/\s+/g, " ").slice(0, 3200)}\n`);
  }
}

/**
 * INSPECT_MODE="ao": dump READ-ONLY de la PROVENANCE des items d'appel d'offres (collection
 * intelItems de la base strategic360). Pour chaque item AO-like (subtype tender/funding/budget,
 * ou tenderRef présent, ou intitulé d'avis), imprime titre + subtype + URL source + nom de source
 * + geo + date + businessAngle — afin de vérifier si les AO sont bien ancrés dans une vraie source
 * (URL présente ? geo cohérent avec la source ?) ou fabriqués. Veille externe = infos publiques.
 */
const AO_SUBTYPES_INSPECT = new Set(["tender", "funding", "budget"]);
const AO_NOTICE_INSPECT = /appel\s?s?\s+(?:d['’ ]?)?offres?|avis\s+(?:d['’ ]?)?appel|manifestation\s+(?:d['’ ]?)?int[ée]r|sollicitation\s+de\s+prix|demande\s+de\s+(?:propositions?|cotations?)|appel\s+à\s+(?:candidatures?|projets?)|\b(?:AOOR?|AAO|AON|AMI|DAO|RFP|RFQ)\b/i;
async function inspectAoProvenance(db) {
  const snap = await db.collection("intelItems").get();
  const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const isAo = (s) =>
    AO_SUBTYPES_INSPECT.has(s.subtype || "") || (s.businessAngle && s.businessAngle.tenderRef) || AO_NOTICE_INSPECT.test(s.title || "");
  const ao = items.filter(isAo);
  console.log(`intelItems : ${items.length} au total, ${ao.length} AO-like.\n`);
  let noUrl = 0;
  for (const s of ao) {
    const ba = s.businessAngle || {};
    if (!s.url) noUrl += 1;
    console.log(`• ${s.title || "(sans titre)"}`);
    console.log(`    subtype=${s.subtype || "—"}  status=${s.status || "—"}  geo=${s.geo || "—"}  date=${s.date || "—"}  evalScore=${s.evalScore ?? "—"}`);
    console.log(`    url=${s.url || "❌ AUCUNE"}`);
    console.log(`    sourceName=${s.sourceName || "—"}  sourceRating=${s.sourceRating || "—"}`);
    console.log(`    tenderRef=${ba.tenderRef || "—"}  buyer=${ba.buyer || "—"}  estAmount=${ba.estAmount || "—"}  deadline=${ba.deadline || "—"}`);
    console.log("");
  }
  console.log(`Résumé AO : ${ao.length} items · ${noUrl} SANS url source · ${ao.length - noUrl} avec url.`);
  // Répartition par source pour repérer un portail qui « produit » beaucoup d'items (signe de scraping stérile → hallucination).
  const bySource = {};
  for (const s of ao) { const k = s.sourceName || "(sans source)"; bySource[k] = (bySource[k] || 0) + 1; }
  console.log("\nPar source :");
  for (const [k, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${k}`);
}

async function inspectDocSubcollections(db, path) {
  const ref = db.doc(path);
  const snap = await ref.get();
  console.log(`Document ${path} — existe: ${snap.exists}`);
  if (snap.exists) {
    const data = snap.data();
    for (const [k, v] of Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${k}: ${typeOf(v)}  ex: ${preview(v)}`);
    }
  }
  const subs = await ref.listCollections();
  console.log(`${subs.length} sous-collection(s) :`);
  for (const sub of subs) {
    try {
      await inspectCollection(sub, 1);
    } catch (err) {
      console.log(`  - ${sub.id}: ERREUR lecture — ${err.message}`);
    }
  }
}

async function main() {
  initializeApp();
  const ids = (process.env.INSPECT_DATABASE_IDS || "(default)")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mode = process.env.INSPECT_MODE || "full";
  const path = process.env.INSPECT_PATH || "";

  for (const databaseId of ids) {
    console.log(`\n========== Base Firestore "${databaseId}" (mode: ${path ? `path:${path}` : mode}) ==========`);
    try {
      const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);
      if (path) {
        await inspectDocSubcollections(db, path);
      } else if (mode === "sources") {
        await sourcesHealth(db);
      } else if (mode === "diag") {
        await sourceDiag(db);
      } else if (mode === "ao") {
        await inspectAoProvenance(db);
      } else if (mode === "roots") {
        await rootsOverview(db);
      } else {
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
