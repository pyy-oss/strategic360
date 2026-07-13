"use strict";

/**
 * Admin script — assign a `role` custom claim to a user by email, running with full
 * Admin SDK privileges (bypasses the `setUserRole` Cloud Function's bootstrap/exec-only gate
 * entirely — access to this script is instead gated by whoever can trigger the
 * `.github/workflows/set-user-role.yml` workflow, i.e. holders of GCP_SA_KEY_STRATEGIC360 +
 * (if configured) the "production" Environment's required reviewers).
 *
 * Creates the Auth user if they don't exist yet (no password set — they get a "set your
 * password" email instead, see below). Merges the new `role` into any EXISTING custom claims
 * (never overwrites unrelated claims another app in this shared project may have set — same
 * rationale as the merge fix in functions/index.js's setUserRole).
 *
 * If `role` is "direction" and `config/bootstrap` isn't marked done yet, marks it done — keeps
 * this script consistent with the deployed `setUserRole` callable's own bootstrap tracking, so a
 * later normal in-app "assign a role" action correctly requires a `direction` caller afterward.
 *
 * Env vars (all required unless noted):
 *   GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT — GCP project id (set by google-github-actions/auth)
 *   FIRESTORE_DATABASE_ID  — named Firestore database (e.g. "strategic360"); "(default)" if unset
 *   TARGET_EMAIL           — the user's email address
 *   TARGET_ROLE             — one of the 8 roles (see VALID_ROLES below)
 *   FIREBASE_WEB_API_KEY    — optional. Firebase web API keys are NOT secret (Google's own docs:
 *                             they identify the project, security is enforced by Auth/Rules/App
 *                             Check, not by hiding the key) — safe to keep in a committed env
 *                             file. When set, and the target user has no "password" Auth
 *                             provider yet, this script sends them a password-reset email via the
 *                             Identity Toolkit REST API so they can set an initial password
 *                             without one ever passing through CI logs.
 *
 * Usage (CI): see .github/workflows/set-user-role.yml.
 * Usage (local, against a real project): set the env vars above (with
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key) and run
 * `node functions/adminSetUserRole.js`.
 */

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// SOURCE UNIQUE des rôles (13 profils ESN) — domain/rbac.js, partagée avec index.js/seed.js.
const { ROLES: VALID_ROLES } = require("./domain/rbac");

async function sendPasswordSetupEmail(email, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sendOobCode failed: ${res.status} ${body}`);
  }
}

async function main() {
  const email = process.env.TARGET_EMAIL;
  const role = process.env.TARGET_ROLE;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";

  if (!email) throw new Error("TARGET_EMAIL is required.");
  if (!role || !VALID_ROLES.includes(role)) {
    throw new Error(`TARGET_ROLE must be one of: ${VALID_ROLES.join(", ")}.`);
  }

  initializeApp();
  const auth = getAuth();
  const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);

  let user;
  let created = false;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await auth.createUser({ email, emailVerified: false });
    created = true;
  }

  const existingClaims = user.customClaims || {};
  await auth.setCustomUserClaims(user.uid, { ...existingClaims, role });

  const bootstrapRef = db.doc("config/bootstrap");
  if (role === "direction") {
    const bootstrapSnap = await bootstrapRef.get();
    if (!bootstrapSnap.exists || bootstrapSnap.data()?.done !== true) {
      await bootstrapRef.set({ done: true, ts: FieldValue.serverTimestamp() }, { merge: true });
    }
  }

  await db.collection("auditLog").add({
    uid: null, // CI-triggered (GitHub Actions), not an in-app caller
    action: "adminSetUserRole",
    module: "config",
    entity: "users",
    entityId: user.uid,
    detail: { role, viaGithubActions: true, userCreated: created },
    ts: FieldValue.serverTimestamp(),
  });

  const hasPasswordProvider = (user.providerData || []).some((p) => p.providerId === "password");
  let resetEmailSent = false;
  if (apiKey && !hasPasswordProvider) {
    await sendPasswordSetupEmail(email, apiKey);
    resetEmailSent = true;
  }

  console.log(
    JSON.stringify(
      {
        uid: user.uid,
        email,
        role,
        userCreated: created,
        passwordSetupEmailSent: resetEmailSent,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
