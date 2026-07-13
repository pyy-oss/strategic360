"use strict";

/**
 * Tests unitaires purs pour functions/domain/rbac.js (modèle RBAC — 13 rôles × 7 modules).
 * Run: npx vitest run test/rbac.domain.test.js
 */

import { describe, it, expect } from "vitest";
import {
  ROLES,
  MODULES,
  DEFAULT_PERMISSIONS_MATRIX,
  EXEC_ROLES,
  COMMERCIAL_ROLES,
  ROLE_LABELS,
  sanitizePermissionsMatrix,
} from "../domain/rbac.js";

describe("taxonomie", () => {
  it("expose 13 rôles et 7 modules", () => {
    expect(ROLES).toHaveLength(13);
    expect(MODULES).toEqual(["veille", "strategie", "innovation", "finance", "copilote", "marketing", "admin"]);
  });
  it("chaque rôle a un libellé FR", () => {
    for (const r of ROLES) expect(typeof ROLE_LABELS[r]).toBe("string");
  });
});

describe("DEFAULT_PERMISSIONS_MATRIX", () => {
  it("est complète (chaque rôle × chaque module ∈ none/read/write)", () => {
    for (const r of ROLES) {
      expect(DEFAULT_PERMISSIONS_MATRIX[r]).toBeDefined();
      for (const m of MODULES) {
        expect(["none", "read", "write"]).toContain(DEFAULT_PERMISSIONS_MATRIX[r][m]);
      }
    }
  });
  it("direction (DG) a write partout", () => {
    for (const m of MODULES) expect(DEFAULT_PERMISSIONS_MATRIX.direction[m]).toBe("write");
  });
  it("finance voit le financier mais pas la stratégie", () => {
    expect(DEFAULT_PERMISSIONS_MATRIX.finance.finance).toBe("write");
    expect(DEFAULT_PERMISSIONS_MATRIX.finance.strategie).toBe("none");
  });
  it("marketing écrit le marketing, pas le financier", () => {
    expect(DEFAULT_PERMISSIONS_MATRIX.marketing.marketing).toBe("write");
    expect(DEFAULT_PERMISSIONS_MATRIX.marketing.finance).toBe("none");
  });
  it("rh et lecture n'ont aucun accès financier", () => {
    expect(DEFAULT_PERMISSIONS_MATRIX.rh.finance).toBe("none");
    expect(DEFAULT_PERMISSIONS_MATRIX.lecture.finance).toBe("none");
  });
  it("avant_vente a le Copilote en write", () => {
    expect(DEFAULT_PERMISSIONS_MATRIX.avant_vente.copilote).toBe("write");
  });
});

describe("groupes de rôles", () => {
  it("EXEC = direction/strategie/innovation", () => {
    expect(EXEC_ROLES).toEqual(["direction", "strategie", "innovation"]);
  });
  it("COMMERCIAL inclut avant_vente et les exec", () => {
    expect(COMMERCIAL_ROLES).toContain("avant_vente");
    expect(COMMERCIAL_ROLES).toContain("commercial");
    expect(COMMERCIAL_ROLES).toContain("direction");
  });
});

describe("sanitizePermissionsMatrix", () => {
  it("ne garde que rôles/modules connus et complète les modules manquants à none", () => {
    const out = sanitizePermissionsMatrix({
      finance: { finance: "write", inconnu: "write" },
      role_bidon: { veille: "write" },
    });
    expect(out.role_bidon).toBeUndefined();
    expect(out.finance.finance).toBe("write");
    expect("inconnu" in out.finance).toBe(false);
    expect(out.finance.veille).toBe("none"); // module non fourni → none
  });
  it("coerce une valeur invalide sur none", () => {
    const out = sanitizePermissionsMatrix({ marketing: { marketing: "admin-god" } });
    expect(out.marketing.marketing).toBe("none");
  });
  it("gère une entrée non-objet", () => {
    expect(sanitizePermissionsMatrix(null)).toEqual({});
    expect(sanitizePermissionsMatrix("x")).toEqual({});
  });
  it("le défaut passe le validateur sans perte", () => {
    const out = sanitizePermissionsMatrix(DEFAULT_PERMISSIONS_MATRIX);
    expect(out).toEqual(DEFAULT_PERMISSIONS_MATRIX);
  });
});
