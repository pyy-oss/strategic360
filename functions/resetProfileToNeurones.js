"use strict";

/**
 * resetProfileToNeurones.js — REMISE A ZERO du profil client sur "Neurones Technologies".
 *
 * Contexte : une session d'onboarding de TEST a surchargé la configuration de veille avec le profil
 * "Orange Cote d'Ivoire" (telecom) alors que toutes les donnees de veille/opportunites/battlecards
 * sont orientees Neurones (integrateur IT/ESN). Resultat : les docs config/* et le contexte
 * entreprise pilotent les agents (systemRole du copilote, contexte des prompts strategiques) avec
 * l'identite Orange -> toute NOUVELLE generation parle au nom d'Orange. Ce script rend la config a
 * son socle canonique Neurones.
 *
 * Principe : DEFAULT_PROFILE (domain/profile.js) EST deja le profil Neurones, et loadClientProfile
 * fusionne les docs config/* PAR-DESSUS ce defaut. Donc SUPPRIMER les docs de surcharge config/*
 * contamines suffit a restaurer le comportement Neurones (fallback = code). Le contexte entreprise
 * (frameworks/companyContext, doc versionne) est REECRIT sur le contexte statique Neurones plutot
 * que supprime.
 *
 * SECURITE : ne touche QUE des docs de config identite/veille. Ne touche jamais config/permissions
 * (RBAC), config/bootstrap, ni aucune donnee metier (intelItems, opportunites, comptes...).
 *
 *   RESET_MODE = "report" (defaut)  -> LECTURE SEULE : diagnostique et imprime, n'ecrit rien.
 *   RESET_MODE = "apply"            -> applique : supprime les docs config/* contamines + reecrit le
 *                                      contexte entreprise sur le socle Neurones.
 *
 * Env : GCLOUD_PROJECT (auth), FIRESTORE_DATABASE_ID=strategic360.
 * Usage (CI) : .github/workflows/reset-profile.yml
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { DEFAULT_PROFILE } = require("./domain/profile");
const { COMPANY_CONTEXT: STATIC_COMPANY_CONTEXT } = require("./domain/companyContext");

// Docs de SURCHARGE lus par loadClientProfile (index.js). Les supprimer => fallback DEFAULT_PROFILE
// (= Neurones). config/permissions et config/bootstrap sont volontairement EXCLUS.
const OVERRIDE_DOCS = [
  "config/profile",
  "config/veilleTaxonomy",
  "config/scoring",
  "config/offerMapping",
  "config/sourceAuthority",
];

const CANONICAL_NAME = DEFAULT_PROFILE.profile.companyName; // "Neurones Technologies"

/** Un doc est "contamine" s'il ne colle pas a l'identite Neurones canonique. */
function isContaminated(path, data) {
  if (!data) return false; // absent => deja au fallback Neurones, rien a faire
  const blob = JSON.stringify(data).toLowerCase();
  if (blob.includes("orange")) return true;
  if (path === "config/profile") {
    // Le nom d'usage doit etre exactement le canonique ; sinon la surcharge deroute l'identite.
    if (typeof data.companyName === "string" && data.companyName.trim() && data.companyName.trim() !== CANONICAL_NAME) {
      return true;
    }
  }
  return false;
}

function short(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s == null ? "null" : (s.length > 120 ? s.slice(0, 120) + "…" : s);
}

async function main() {
  const mode = (process.env.RESET_MODE || "report").trim();
  if (mode !== "report" && mode !== "apply") {
    console.error(`RESET_MODE invalide: "${mode}" (attendu report|apply).`);
    process.exit(1);
  }
  initializeApp();
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
  const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);

  console.log(`\n========== Reset profil -> "${CANONICAL_NAME}" (base "${databaseId}", mode: ${mode}) ==========`);

  const flagged = [];

  // 1) Docs de surcharge config/*
  for (const path of OVERRIDE_DOCS) {
    const snap = await db.doc(path).get();
    const data = snap.exists ? snap.data() : null;
    if (!snap.exists) {
      console.log(`- ${path} : absent (deja au fallback Neurones).`);
      continue;
    }
    const bad = isContaminated(path, data);
    console.log(`- ${path} : ${bad ? "CONTAMINE" : "OK (Neurones)"}`);
    if (path === "config/profile" && data) {
      console.log(`    companyName: ${short(data.companyName)}`);
      console.log(`    sector     : ${short(data.sector)}`);
      console.log(`    systemRole : ${short(data.systemRole)}`);
    }
    if (bad) flagged.push(path);
  }

  // 2) Contexte entreprise (versionne) — reecrit s'il est Orange ou vide/absent d'un texte Neurones.
  const ctxRef = db.doc("frameworks/companyContext");
  const ctxSnap = await ctxRef.get();
  const ctxText = ctxSnap.exists ? (ctxSnap.data()?.content?.text || "") : "";
  const ctxBad = ctxSnap.exists && String(ctxText).toLowerCase().includes("orange");
  console.log(`- frameworks/companyContext : ${ctxSnap.exists ? (ctxBad ? "CONTAMINE" : "OK/present") : "absent"}`);
  if (ctxSnap.exists) console.log(`    content.text: ${short(ctxText)}`);

  if (mode === "report") {
    console.log(`\n[REPORT] ${flagged.length} doc(s) config a supprimer${ctxBad ? " + 1 contexte a reecrire" : ""}. Aucune ecriture effectuee.`);
    console.log("Relancer avec RESET_MODE=apply pour appliquer.");
    return;
  }

  // mode === "apply"
  let actions = 0;
  for (const path of flagged) {
    await db.doc(path).delete();
    console.log(`[APPLY] supprime ${path} -> fallback DEFAULT_PROFILE (Neurones).`);
    actions++;
  }
  if (ctxBad) {
    await ctxRef.set(
      { content: { text: STATIC_COMPANY_CONTEXT }, source: "reset-neurones", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    console.log(`[APPLY] reecrit frameworks/companyContext sur le contexte statique Neurones (${STATIC_COMPANY_CONTEXT.length} car.).`);
    actions++;
  }
  console.log(`\n[APPLY] Termine : ${actions} action(s). Identite resolue = "${CANONICAL_NAME}" (code canonique).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
  });
