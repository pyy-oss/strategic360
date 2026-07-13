/**
 * marketing.ts — PERSISTANCE du contenu marketing (levier « waouh » n°2). Les angles de contenu
 * générés par l'agent IA (Copilote > Contenu marketing) étaient volatiles : régénérés à chaque
 * clic, perdus au rechargement. Ici on les persiste dans `marketingContent/{id}` comme un BACKLOG
 * ÉDITORIAL : chaque angle enregistré porte un statut (idée → planifié → publié) et une date de
 * programmation optionnelle → calendrier éditorial partagé et suivi dans le temps.
 *
 * Même pattern que lib/execution.ts (onSnapshot + create/update/delete, `createdBy` imposé par les
 * règles). Écriture réservée aux rôles commerciaux/exécutifs (firestore.rules > marketingContent).
 */
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type FieldValue,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";

export type MarketingStatus = "idee" | "planifie" | "publie";

export const MARKETING_STATUS_LABEL: Record<MarketingStatus, string> = {
  idee: "Idée",
  planifie: "Planifié",
  publie: "Publié",
};

export interface MarketingContent {
  id: string;
  format: string; // "LinkedIn" | "Tribune"
  titre: string;
  accroche?: string;
  corps: string;
  cta?: string;
  hashtags?: string[];
  differenciateur?: string;
  signalSource?: string;
  accountId?: string | null;
  status: MarketingStatus;
  scheduledDate?: string | null; // YYYY-MM-DD
  createdBy?: string;
  createdAt?: Timestamp | FieldValue | null;
  updatedAt?: Timestamp | FieldValue | null;
}

/** Champs fournis à l'enregistrement d'un angle généré (le reste est dérivé/imposé). */
export type MarketingContentInput = Omit<MarketingContent, "id" | "status" | "createdBy" | "createdAt" | "updatedAt"> & {
  status?: MarketingStatus;
};

/** Backlog éditorial (marketingContent), le plus récent d'abord. */
export function useMarketingContent(): { items: MarketingContent[]; loading: boolean; error: Error | null } {
  const [items, setItems] = useState<MarketingContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "marketingContent"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MarketingContent, "id">) })));
        setLoading(false);
        setError(null);
      },
      (err) => { setError(err as Error); setLoading(false); }
    );
    return unsub;
  }, []);

  return { items, loading, error };
}

/** Enregistre un angle de contenu dans le backlog éditorial. `createdBy` imposé par les règles. */
export async function saveMarketingContent(input: MarketingContentInput): Promise<string> {
  const ref = await addDoc(collection(db, "marketingContent"), {
    ...input,
    status: input.status ?? "idee",
    createdBy: auth.currentUser?.uid ?? "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Met à jour le statut éditorial (et la date de programmation) d'un contenu. */
export async function updateMarketingStatus(id: string, status: MarketingStatus, scheduledDate?: string | null): Promise<void> {
  const patch: Record<string, unknown> = { status, updatedAt: serverTimestamp() };
  if (scheduledDate !== undefined) patch.scheduledDate = scheduledDate;
  await updateDoc(doc(db, "marketingContent", id), patch);
}

/** Supprime un contenu du backlog. */
export async function deleteMarketingContent(id: string): Promise<void> {
  await deleteDoc(doc(db, "marketingContent", id));
}
