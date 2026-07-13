"use strict";

/**
 * domain/rbac.js — SOURCE UNIQUE du modèle RBAC (rôles, modules, matrice de droits par défaut).
 *
 * Modèle : chaque utilisateur porte UN `role` (custom claim). Les droits sont une matrice
 * `matrix[role][module]` ∈ { "none" | "read" | "write" }, stockée dans `config/permissions` et
 * évaluée à l'identique côté serveur (firestore.rules `lvl(m)`/`canRead(m)`/`canWrite(m)`) et côté
 * client (web/src/lib/rbac.ts). `direction` (DG) a toujours `write` partout via un raccourci dans
 * les règles — la matrice le liste quand même pour la lisibilité.
 *
 * Taxonomie ESN/SS2I (Neurones Technologies) : 13 profils, 7 modules fonctionnels. Ce fichier est
 * PUR (aucune I/O) et réutilisé par index.js (VALID_ROLES, groupes de rôles, callable
 * setPermissionsMatrix) et seed.js (écriture du défaut). Testé unitairement.
 */

/** Les 13 rôles (profils ESN). L'ordre sert aussi à l'affichage. */
const ROLES = [
  "direction",       // Direction générale (DG) — super-admin
  "strategie",       // Direction de la stratégie
  "innovation",      // Direction innovation / R&D
  "commercial_dir",  // Direction commerciale
  "commercial",      // Commercial / ingénieur d'affaires
  "avant_vente",     // Ingénieur avant-vente (pré-vente)
  "marketing",       // Marketing & communication
  "pmo",             // Chef de projet / PMO
  "technique",       // Direction technique / DSI / consultants (delivery)
  "finance",         // DAF / contrôle de gestion
  "achats",          // Achats
  "rh",              // Ressources humaines
  "lecture",         // Observateur (lecture seule)
];

/** Les 7 modules de droits. */
const MODULES = ["veille", "strategie", "innovation", "finance", "copilote", "marketing", "admin"];

/** Niveaux de droit valides pour une case de la matrice. */
const PERM_LEVELS = ["none", "read", "write"];

const W = "write";
const R = "read";
const N = "none";

/**
 * Matrice de droits par DÉFAUT (rôle × module). Éditable ensuite par le DG (callable
 * setPermissionsMatrix) sans redéploiement. `direction` = write partout.
 */
const DEFAULT_PERMISSIONS_MATRIX = {
  direction:      { veille: W, strategie: W, innovation: W, finance: W, copilote: W, marketing: W, admin: W },
  strategie:      { veille: W, strategie: W, innovation: W, finance: R, copilote: R, marketing: R, admin: N },
  innovation:     { veille: W, strategie: R, innovation: W, finance: R, copilote: R, marketing: R, admin: N },
  commercial_dir: { veille: W, strategie: R, innovation: R, finance: R, copilote: W, marketing: R, admin: N },
  commercial:     { veille: W, strategie: N, innovation: N, finance: N, copilote: W, marketing: N, admin: N },
  avant_vente:    { veille: R, strategie: R, innovation: R, finance: N, copilote: W, marketing: R, admin: N },
  marketing:      { veille: R, strategie: R, innovation: R, finance: N, copilote: R, marketing: W, admin: N },
  pmo:            { veille: R, strategie: R, innovation: R, finance: N, copilote: R, marketing: N, admin: N },
  technique:      { veille: R, strategie: R, innovation: R, finance: N, copilote: N, marketing: N, admin: N },
  finance:        { veille: R, strategie: N, innovation: N, finance: W, copilote: R, marketing: N, admin: N },
  achats:         { veille: R, strategie: N, innovation: N, finance: R, copilote: N, marketing: N, admin: N },
  rh:             { veille: R, strategie: N, innovation: N, finance: N, copilote: N, marketing: N, admin: N },
  lecture:        { veille: R, strategie: R, innovation: R, finance: N, copilote: N, marketing: N, admin: N },
};

/** Profils exécutifs — voient/écrivent le stratégique. Miroir de `exec()` dans firestore.rules. */
const EXEC_ROLES = ["direction", "strategie", "innovation"];

/** Rôles ayant accès au Copilote Commercial (module copilote en read/write). */
const COMMERCIAL_ROLES = ["commercial", "commercial_dir", "avant_vente", ...EXEC_ROLES];

/** Rôles NON cloisonnés (voient tout le portefeuille du Copilote). */
const COPILOTE_UNSCOPED_ROLES = ["commercial_dir", ...EXEC_ROLES];

/** Libellés FR (affichage). Réutilisés côté front. */
const ROLE_LABELS = {
  direction: "Direction générale (DG)",
  strategie: "Direction stratégie",
  innovation: "Direction innovation / R&D",
  commercial_dir: "Direction commerciale",
  commercial: "Commercial / Ingénieur d'affaires",
  avant_vente: "Ingénieur avant-vente",
  marketing: "Marketing & Communication",
  pmo: "Chef de projet / PMO",
  technique: "Direction technique / DSI",
  finance: "DAF / Contrôle de gestion",
  achats: "Achats",
  rh: "Ressources humaines",
  lecture: "Observateur (lecture seule)",
};

/**
 * sanitizePermissionsMatrix(obj) → matrice nettoyée : ne garde QUE les rôles et modules connus,
 * coerce les valeurs sur { none | read | write } (défaut "none"). PUR. Sert à valider l'entrée du
 * callable setPermissionsMatrix avant écriture dans config/permissions. Un rôle absent de l'entrée
 * est omis (le DG peut ne pousser qu'un sous-ensemble) ; un module absent pour un rôle présent est
 * complété à "none" pour une matrice toujours complète et déterministe.
 */
function sanitizePermissionsMatrix(obj) {
  const src = obj && typeof obj === "object" ? obj : {};
  const out = {};
  for (const role of ROLES) {
    if (!(role in src)) continue;
    const rowSrc = src[role] && typeof src[role] === "object" ? src[role] : {};
    const row = {};
    for (const mod of MODULES) {
      const v = rowSrc[mod];
      row[mod] = PERM_LEVELS.includes(v) ? v : N;
    }
    out[role] = row;
  }
  return out;
}

module.exports = {
  ROLES,
  MODULES,
  PERM_LEVELS,
  DEFAULT_PERMISSIONS_MATRIX,
  EXEC_ROLES,
  COMMERCIAL_ROLES,
  COPILOTE_UNSCOPED_ROLES,
  ROLE_LABELS,
  sanitizePermissionsMatrix,
};
