/**
 * Firestore data layer for `frameworks/{key}` (BUILD_KIT.md §6 "documents vivants versionnés",
 * §7 exec-write, §11 "Diagnostic lit frameworks, saisie").
 *
 * Minimal CRUD layer added in V6 because `Diagnostic.tsx` is the first view in scope whose
 * BUILD_KIT.md §11 mapping explicitly names `frameworks` as its data source (Cadres.tsx's
 * SWOT/PESTEL/Canvas tabs were out of V4's scope and remain static — see that view's own
 * doc comment; V6 does not touch Cadres.tsx).
 *
 * `content` is intentionally untyped (`unknown`) here: each `frameworks/{key}` document can hold
 * whatever shape its consuming view needs (e.g. `frameworks/diagnostic` holds
 * `{ issue: {...}, s7: [...], maturite: [...] }` for Diagnostic's 3 sub-tabs). Callers narrow the
 * type themselves. `version` is bumped on every `updateFramework` call; `updatedBy`/`updatedAt`
 * are stamped server-side (`updatedAt` via `serverTimestamp()`).
 */
import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, type FieldValue, type Timestamp } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";

export interface FrameworkDoc<T = unknown> {
  key: string;
  content: T;
  version: number;
  updatedBy?: string;
  updatedAt?: Timestamp | FieldValue;
}

/** Live (`onSnapshot`) read of a single `frameworks/{key}` document. `data` is null while it
 * doesn't exist yet (never written) — callers should fall back to a static default, same
 * convention as `lib/quanti.ts`'s `useQuantiSummary()`. */
export function useFramework<T = unknown>(key: string): { data: FrameworkDoc<T> | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<FrameworkDoc<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "frameworks", key),
      (snap) => {
        setData(snap.exists() ? (snap.data() as FrameworkDoc<T>) : null);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading, error };
}

/** Exec-only write (per `firestore.rules`) — upserts `frameworks/{key}`, bumping `version`. */
export async function updateFramework<T = unknown>(key: string, content: T): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("updateFramework: no authenticated user");
  const ref = doc(db, "frameworks", key);
  const existing = await getDoc(ref);
  const prevVersion = existing.exists() ? ((existing.data().version as number | undefined) ?? 0) : 0;
  await setDoc(
    ref,
    {
      key,
      content,
      version: prevVersion + 1,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
