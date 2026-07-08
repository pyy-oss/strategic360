import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

/**
 * RBAC — 8 roles (BUILD_KIT.md §7). Client-side mirror of firestore.rules' `role()`/`lvl()`/
 * `canRead()`/`canWrite()`/`exec()` functions, used to gate the UI. The Security Rules remain the
 * sole authority for actual writes — this is convenience/UX only (hide/disable, never trust-only).
 */
export type Role =
  | "direction"
  | "strategie"
  | "innovation"
  | "commercial_dir"
  | "commercial"
  | "pmo"
  | "achats"
  | "lecture";

export const ROLES: Role[] = [
  "direction",
  "strategie",
  "innovation",
  "commercial_dir",
  "commercial",
  "pmo",
  "achats",
  "lecture",
];

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
