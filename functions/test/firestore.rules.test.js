"use strict";

/**
 * Security Rules tests for firestore.rules (BUILD_KIT.md §7 / §14 "tests de règles par profil").
 * Uses @firebase/rules-unit-testing against the local Firestore Emulator (must be running —
 * see the `serve`/`test:rules` scripts / README note below). Custom claims (`role`) are simulated
 * via `testEnv.authenticatedContext(uid, { role })`, matching how firestore.rules reads
 * `request.auth.token.role`.
 *
 * Run against the emulator:
 *   firebase emulators:exec --only firestore "npx vitest run test/firestore.rules.test.js"
 * or, with an emulator already running (FIRESTORE_EMULATOR_HOST set), just:
 *   npx vitest run test/firestore.rules.test.js
 *
 * This is a representative subset (not exhaustive) covering BUILD_KIT.md §14's acceptance
 * criterion: "Une écriture non autorisée est refusée par les Security Rules".
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");

const ALL_ROLES = [
  "direction",
  "strategie",
  "innovation",
  "commercial_dir",
  "commercial",
  "pmo",
  "achats",
  "lecture",
];

const EXEC_ROLES = ["direction", "strategie", "innovation"];
const CONTRIB_ROLES = ["direction", "strategie", "innovation", "commercial_dir", "commercial"];
const READ_ONLY_ROLES = ["pmo", "achats", "lecture"];

const PERMISSIONS_MATRIX = {
  direction: { veille: "write" },
  strategie: { veille: "write" },
  innovation: { veille: "write" },
  commercial_dir: { veille: "write" },
  commercial: { veille: "write" },
  pmo: { veille: "read" },
  achats: { veille: "read" },
  lecture: { veille: "read" },
};

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "veille-rules-test",
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed config/permissions as an unauthenticated Admin SDK write (bypasses rules).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("config/permissions").set({ matrix: PERMISSIONS_MATRIX });
  });
});

function ctxFor(role) {
  return testEnv.authenticatedContext(`user-${role}`, { role });
}

describe("intelItems", () => {
  it.each(ALL_ROLES)("read is allowed for role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(db.collection("intelItems").doc("i1").get());
  });

  it.each(CONTRIB_ROLES)("create is allowed for role=%s (own createdBy)", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(
      db.collection("intelItems").doc(`item-${role}`).set({
        title: "Test signal",
        createdBy: `user-${role}`,
      })
    );
  });

  it.each(READ_ONLY_ROLES)("create is rejected for role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertFails(
      db.collection("intelItems").doc(`item-${role}`).set({
        title: "Test signal",
        createdBy: `user-${role}`,
      })
    );
  });

  it("create is rejected when createdBy doesn't match the caller", async () => {
    const db = ctxFor("commercial").firestore();
    await assertFails(
      db.collection("intelItems").doc("item-spoof").set({
        title: "Test signal",
        createdBy: "someone-else",
      })
    );
  });

  it("read is rejected when unauthenticated", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.collection("intelItems").doc("i1").get());
  });
});

describe("frameworks", () => {
  it.each(EXEC_ROLES)("write is allowed for exec role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(db.collection("frameworks").doc("swot").set({ content: "x" }));
  });

  it.each(["commercial_dir", "commercial", "pmo", "achats", "lecture"])(
    "write is rejected for non-exec role=%s",
    async (role) => {
      const db = ctxFor(role).firestore();
      await assertFails(db.collection("frameworks").doc("swot").set({ content: "x" }));
    }
  );

  it.each(ALL_ROLES)("read is allowed for role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(db.collection("frameworks").doc("swot").get());
  });
});

describe("summaries/veille", () => {
  it.each(ALL_ROLES)("write is always rejected client-side for role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertFails(db.collection("summaries").doc("veille").set({ countsByAxis: {} }));
  });

  it.each(ALL_ROLES)("read is allowed for authenticated role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(db.collection("summaries").doc("veille").get());
  });
});

// Audit intégral 2026-07 (m3) : agrégats exécutifs/financiers réservés aux exécutifs.
describe("summaries/veille_exec & quanti — exec-only", () => {
  it.each(EXEC_ROLES)("read veille_exec allowed for exec role=%s", async (role) => {
    await assertSucceeds(ctxFor(role).firestore().doc("summaries/veille_exec").get());
  });
  it.each(ALL_ROLES.filter((r) => !EXEC_ROLES.includes(r)))(
    "read veille_exec rejected for role=%s",
    async (role) => {
      await assertFails(ctxFor(role).firestore().doc("summaries/veille_exec").get());
    }
  );
  it.each(EXEC_ROLES)("read quanti allowed for exec role=%s", async (role) => {
    await assertSucceeds(ctxFor(role).firestore().doc("summaries/quanti").get());
  });
  it.each(ALL_ROLES.filter((r) => !EXEC_ROLES.includes(r)))(
    "read quanti rejected for role=%s",
    async (role) => {
      await assertFails(ctxFor(role).firestore().doc("summaries/quanti").get());
    }
  );
});

describe("config/permissions", () => {
  it("write is allowed for direction", async () => {
    const db = ctxFor("direction").firestore();
    await assertSucceeds(
      db.doc("config/permissions").set({ matrix: PERMISSIONS_MATRIX })
    );
  });

  it.each(ALL_ROLES.filter((r) => r !== "direction"))(
    "write is rejected for role=%s",
    async (role) => {
      const db = ctxFor(role).firestore();
      await assertFails(db.doc("config/permissions").set({ matrix: PERMISSIONS_MATRIX }));
    }
  );
});

// Audit pré-lancement 2026-07 (M4) : les autres docs config/* (dont le brouillon d'onboarding,
// qui contient le crawl concurrentiel + l'analyse IA) sont réservés en LECTURE aux exécutifs.
describe("config/* (hors permissions) — lecture exec-only", () => {
  it.each(EXEC_ROLES)("read onboardingDraft allowed for exec role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(db.doc("config/onboardingDraft").get());
  });

  it.each(ALL_ROLES.filter((r) => !EXEC_ROLES.includes(r)))(
    "read onboardingDraft rejected for role=%s",
    async (role) => {
      const db = ctxFor(role).firestore();
      await assertFails(db.doc("config/onboardingDraft").get());
    }
  );

  it("config/permissions reste lisible par un rôle non-exec (RBAC front)", async () => {
    const db = ctxFor("commercial").firestore();
    await assertSucceeds(db.doc("config/permissions").get());
  });

  it.each(EXEC_ROLES)("read kpiHistory allowed for exec role=%s", async (role) => {
    await assertSucceeds(ctxFor(role).firestore().doc("summaries/kpiHistory").get());
  });
  it.each(ALL_ROLES.filter((r) => !EXEC_ROLES.includes(r)))(
    "read kpiHistory rejected for role=%s",
    async (role) => {
      await assertFails(ctxFor(role).firestore().doc("summaries/kpiHistory").get());
    }
  );

  it.each(ALL_ROLES)("write config/onboardingDraft always rejected for role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertFails(db.doc("config/onboardingDraft").set({ status: "draft" }));
  });

  // Cadence des pipelines (maîtrise coûts) : config/runtime — lecture exec-only, écriture client
  // TOUJOURS interdite (seul le callable exec setPipelineConfig écrit, via Admin SDK).
  it.each(EXEC_ROLES)("read config/runtime allowed for exec role=%s", async (role) => {
    await assertSucceeds(ctxFor(role).firestore().doc("config/runtime").get());
  });
  it.each(ALL_ROLES.filter((r) => !EXEC_ROLES.includes(r)))("read config/runtime rejected for role=%s", async (role) => {
    await assertFails(ctxFor(role).firestore().doc("config/runtime").get());
  });
  it.each(ALL_ROLES)("write config/runtime rejected for role=%s (callable-only)", async (role) => {
    await assertFails(ctxFor(role).firestore().doc("config/runtime").set({ paused: true }));
  });
});

// Waouh v2 — cibles commerciales : lecture/écriture réservées aux managers (exec + commercial_dir).
describe("salesTargets — managers only", () => {
  const MANAGERS = ["direction", "strategie", "innovation", "commercial_dir"];
  const NON_MANAGERS = ["commercial", "pmo", "achats", "lecture"];
  it.each(MANAGERS)("read+write allowed for manager role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(db.doc("salesTargets/current").set({ targets: { "a@x.com": 1000 } }));
    await assertSucceeds(db.doc("salesTargets/current").get());
  });
  it.each(NON_MANAGERS)("read+write rejected for role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertFails(db.doc("salesTargets/current").get());
    await assertFails(db.doc("salesTargets/current").set({ targets: { "a@x.com": 1000 } }));
  });
});

// Levier « waouh » n°2 — persistance marketing : lecture/écriture pour les rôles commerciaux +
// exécutifs (même audience que l'add-on Copilote). createdBy imposé ; chacun édite/supprime les
// siens, les exec gardent la main sur tout.
describe("marketingContent — commercial/exec, createdBy imposé", () => {
  const COMMERCIAL = ["commercial", "commercial_dir", "direction", "strategie", "innovation"];
  const NON_COMMERCIAL = ["pmo", "achats", "lecture"];

  it.each(COMMERCIAL)("read allowed for role=%s", async (role) => {
    await assertSucceeds(ctxFor(role).firestore().doc("marketingContent/m1").get());
  });
  it.each(NON_COMMERCIAL)("read rejected for role=%s", async (role) => {
    await assertFails(ctxFor(role).firestore().doc("marketingContent/m1").get());
  });

  it.each(COMMERCIAL)("create allowed for role=%s with own createdBy", async (role) => {
    const db = ctxFor(role).firestore();
    await assertSucceeds(db.doc(`marketingContent/c-${role}`).set({ titre: "T", corps: "x", createdBy: `user-${role}` }));
  });
  it("create rejected when createdBy is not the caller", async () => {
    const db = ctxFor("commercial").firestore();
    await assertFails(db.doc("marketingContent/spoof").set({ titre: "T", corps: "x", createdBy: "someone-else" }));
  });
  it.each(NON_COMMERCIAL)("create rejected for role=%s", async (role) => {
    const db = ctxFor(role).firestore();
    await assertFails(db.doc(`marketingContent/c-${role}`).set({ titre: "T", corps: "x", createdBy: `user-${role}` }));
  });

  it("owner can update/delete their own; a peer commercial cannot", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("marketingContent/owned").set({ titre: "T", corps: "x", status: "idee", createdBy: "user-commercial" });
    });
    const owner = ctxFor("commercial").firestore(); // uid = user-commercial
    await assertSucceeds(owner.doc("marketingContent/owned").update({ status: "planifie" }));
    const peer = testEnv.authenticatedContext("user-other", { role: "commercial" }).firestore();
    await assertFails(peer.doc("marketingContent/owned").update({ status: "publie" }));
    await assertFails(peer.doc("marketingContent/owned").delete());
    // Un exécutif garde la main sur tout (revue éditoriale).
    await assertSucceeds(ctxFor("direction").firestore().doc("marketingContent/owned").update({ status: "publie" }));
  });
});
