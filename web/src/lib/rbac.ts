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

/** Subscribes to auth state, forces an ID token refresh, and exposes the `role` custom claim. */
export function useClaims(): Claims {
  const [state, setState] = useState<Claims>({ user: null, role: null, loading: true });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, role: null, loading: false });
        return;
      }
      try {
        // Force refresh so a role granted server-side (setUserRole) is picked up without
        // requiring the user to sign out/in again.
        const tokenResult = await user.getIdTokenResult(true);
        const role = (tokenResult.claims.role as Role | undefined) ?? null;
        setState({ user, role, loading: false });
      } catch {
        setState({ user, role: null, loading: false });
      }
    });
    return unsub;
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
