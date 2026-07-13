import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";

/**
 * RBAC — 8 roles (BUILD_KIT.md §7). Client-side mirror of firestore.rules' `role()`/`lvl()`/
 * `canRead()`/`canWrite()`/`exec()` functions, used to gate the UI. The Security Rules remain the
 * sole authority for actual writes — this is convenience/UX only (hide/disable, never trust-only).
 */
// RBAC — 13 profils ESN × 7 modules. MIROIR de functions/domain/rbac.js (garder les deux en phase).
export type Role =
  | "direction"
  | "strategie"
  | "innovation"
  | "commercial_dir"
  | "commercial"
  | "avant_vente"
  | "marketing"
  | "pmo"
  | "technique"
  | "finance"
  | "achats"
  | "rh"
  | "lecture";

export const ROLES: Role[] = [
  "direction",
  "strategie",
  "innovation",
  "commercial_dir",
  "commercial",
  "avant_vente",
  "marketing",
  "pmo",
  "technique",
  "finance",
  "achats",
  "rh",
  "lecture",
];

export type Module = "veille" | "strategie" | "innovation" | "finance" | "copilote" | "marketing" | "admin";
export const MODULES: Module[] = ["veille", "strategie", "innovation", "finance", "copilote", "marketing", "admin"];

/** Libellés FR des rôles (affichage badge, écran Réglages). Miroir de ROLE_LABELS (domain/rbac.js). */
export const ROLE_LABEL: Record<Role, string> = {
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

/** Regroupement pour l'affichage (écran Réglages). */
export const ROLE_GROUP: Record<Role, string> = {
  direction: "Direction / COMEX", strategie: "Direction / COMEX", innovation: "Direction / COMEX",
  commercial_dir: "Commercial", commercial: "Commercial", avant_vente: "Commercial",
  marketing: "Marketing",
  pmo: "Delivery / Technique", technique: "Delivery / Technique",
  finance: "Corporate / Support", achats: "Corporate / Support", rh: "Corporate / Support",
  lecture: "Observateur",
};

/** Libellés FR des modules (écran Réglages). */
export const MODULE_LABEL: Record<Module, string> = {
  veille: "Veille", strategie: "Stratégie", innovation: "Innovation",
  finance: "Finance", copilote: "Copilote", marketing: "Marketing", admin: "Admin",
};

/** Matrice de droits par DÉFAUT (miroir de functions/domain/rbac.js) — bouton « réinitialiser ». */
const W = "write" as const, R = "read" as const, N = "none" as const;
export const DEFAULT_PERMISSIONS_MATRIX: Record<Role, Record<Module, PermLevel>> = {
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

/** Met à jour la matrice RBAC (callable `setPermissionsMatrix`, DG uniquement). */
export async function setPermissionsMatrix(matrix: PermMatrix): Promise<void> {
  const call = httpsCallable<{ matrix: PermMatrix }, { ok: boolean }>(functions, "setPermissionsMatrix");
  await call({ matrix });
}

export type PermLevel = "none" | "read" | "write";
export type PermMatrix = Record<string, Partial<Record<string, PermLevel>>>;

export interface Claims {
  user: User | null;
  role: Role | null;
  loading: boolean;
}

/**
 * Abonnement auth PARTAGÉ (audit intégral 2026-07, m5) — un SEUL `onAuthStateChanged` +
 * `getIdTokenResult(true)` pour toute l'app, quel que soit le nombre de composants qui appellent
 * `useClaims`/`useCan`/`useIsExec`. Auparavant chaque consommateur ouvrait son propre listener et
 * forçait un refresh de token à chaque montage. Singleton module : la source démarre au 1er
 * abonné, diffuse l'état à tous, et se maintient tant qu'il reste des abonnés.
 */
let claimsState: Claims = { user: null, role: null, loading: true };
const claimsSubscribers = new Set<(c: Claims) => void>();
let claimsAuthUnsub: (() => void) | null = null;

function emitClaims(next: Claims) {
  claimsState = next;
  for (const fn of claimsSubscribers) fn(next);
}

function startClaimsSource() {
  if (claimsAuthUnsub) return;
  claimsAuthUnsub = onAuthStateChanged(auth, async (user) => {
    if (!user) { emitClaims({ user: null, role: null, loading: false }); return; }
    try {
      // Force refresh so a role granted server-side (setUserRole) is picked up without
      // requiring the user to sign out/in again.
      const tokenResult = await user.getIdTokenResult(true);
      const role = (tokenResult.claims.role as Role | undefined) ?? null;
      emitClaims({ user, role, loading: false });
    } catch {
      emitClaims({ user, role: null, loading: false });
    }
  });
}

/** Subscribes to the SHARED auth-state source and exposes the `role` custom claim. */
export function useClaims(): Claims {
  const [state, setState] = useState<Claims>(claimsState);

  useEffect(() => {
    claimsSubscribers.add(setState);
    startClaimsSource();
    setState(claimsState); // synchronise le nouvel abonné sur l'état courant
    return () => {
      claimsSubscribers.delete(setState);
      // Dernier abonné parti : on ferme la source (elle redémarrera au prochain montage).
      if (claimsSubscribers.size === 0 && claimsAuthUnsub) {
        claimsAuthUnsub();
        claimsAuthUnsub = null;
      }
    };
  }, []);

  return state;
}

/** Mirrors `lvl(m)` in firestore.rules: direction always has write; else read the matrix. */
function levelFor(role: Role | null, matrix: PermMatrix | null, moduleName: string): PermLevel {
  if (!role) return "none";
  if (role === "direction") return "write";
  return matrix?.[role]?.[moduleName] ?? "none";
}

export interface CanResult {
  canRead: boolean;
  canWrite: boolean;
  loading: boolean;
}

/**
 * Reads `config/permissions` (matrix) via a live listener and combines it with the current
 * role to mirror the server-side `canRead()`/`canWrite()` rules functions.
 */
export function useCan(moduleName: string, claims?: Claims): CanResult {
  const ownClaims = useClaims();
  const { user, role, loading: claimsLoading } = claims ?? ownClaims;
  const [matrix, setMatrix] = useState<PermMatrix | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setMatrix(null);
      setMatrixLoading(false);
      return;
    }
    setMatrixLoading(true);
    const unsub = onSnapshot(
      doc(db, "config/permissions"),
      (snap) => {
        setMatrix((snap.data()?.matrix as PermMatrix | undefined) ?? null);
        setMatrixLoading(false);
      },
      () => {
        setMatrix(null);
        setMatrixLoading(false);
      }
    );
    return unsub;
  }, [user]);

  const loading = claimsLoading || matrixLoading;
  const level = levelFor(role, matrix, moduleName);
  return {
    canRead: level === "read" || level === "write",
    canWrite: level === "write",
    loading,
  };
}

/** Mirrors `exec()` in firestore.rules. */
export function useIsExec(claims?: Claims): boolean {
  const ownClaims = useClaims();
  const { role } = claims ?? ownClaims;
  return role === "direction" || role === "strategie" || role === "innovation";
}

/**
 * usePermissions — charge la matrice (config/permissions) UNE fois et expose des helpers
 * `canRead(module)`/`canWrite(module)` synchrones + la matrice brute (pour l'écran Réglages). Un
 * seul listener partagé quel que soit le nombre de modules interrogés (contrairement à N × useCan).
 */
export function usePermissions(): {
  role: Role | null;
  matrix: PermMatrix | null;
  loading: boolean;
  canRead: (m: string) => boolean;
  canWrite: (m: string) => boolean;
} {
  const { role, user, loading: claimsLoading } = useClaims();
  const [matrix, setMatrix] = useState<PermMatrix | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(true);
  useEffect(() => {
    if (!user) { setMatrix(null); setMatrixLoading(false); return; }
    setMatrixLoading(true);
    const unsub = onSnapshot(
      doc(db, "config/permissions"),
      (snap) => { setMatrix((snap.data()?.matrix as PermMatrix | undefined) ?? null); setMatrixLoading(false); },
      () => { setMatrix(null); setMatrixLoading(false); }
    );
    return unsub;
  }, [user]);
  const canRead = (m: string) => { const l = levelFor(role, matrix, m); return l === "read" || l === "write"; };
  const canWrite = (m: string) => levelFor(role, matrix, m) === "write";
  return { role, matrix, loading: claimsLoading || matrixLoading, canRead, canWrite };
}
