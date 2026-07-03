/**
 * Data layer — Copilote Commercial (add-on DELTA 02 / 02B).
 *
 * Reuse maximum : mêmes conventions que lib/execution.ts / lib/intel.ts (onSnapshot + httpsCallable).
 * Le moteur IA vit côté serveur (callables copiloteGenerate / copiloteChat) ; ici on ne fait que
 * wrapper les appels + gérer la collection `copiloteAccounts` (qualitatif compte).
 */
import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  type FieldValue,
  type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase";

/* ---------------------------------------------------------------------------------------------
 * Comptes (copiloteAccounts) — qualitatif édité par les commerciaux
 * ------------------------------------------------------------------------------------------- */

export interface CopiloteContact {
  role: string;
  posture: string;
}
export interface CopiloteHistoriqueItem {
  offre: string;
  statut: string;
}
export interface CopiloteOpportunite {
  nom: string;
  montant: number;
  etape: string;
  bu?: string;
  closingDate?: string;
  probability?: number | null;
}
export interface CopiloteAccount {
  id: string;
  nom: string;
  // Champs qualitatifs OPTIONNELS : un compte issu UNIQUEMENT de la synchro nt360 ne porte que
  // `nom` + `nt360`. Le hook les normalise à [] / "" pour que les consommateurs n'aient jamais
  // à manipuler d'undefined (sinon `account.enjeux.map` plante la fiche).
  secteur?: string;
  tier?: string; // ex: "Stratégique", "Clé", "Standard"
  enjeux?: string[];
  whitespace?: string[];
  enCours?: string[];
  historique?: CopiloteHistoriqueItem[];
  contacts?: CopiloteContact[];
  preuves?: string[];
  tendances?: string[];
  reglementation?: string;
  concurrence?: string;
  /** Empreinte dérivée du pipeline nt360 (read-only) — additive, ne remplace jamais le qualitatif. */
  nt360?: {
    historique?: CopiloteHistoriqueItem[];
    enCours?: string[];
    casTotal?: number;
    pipelinePondere?: number;
    wins?: number;
    opportunites?: CopiloteOpportunite[];
    updatedAt?: Timestamp | FieldValue;
  };
  updatedAt?: Timestamp | FieldValue;
}

export type CopiloteAccountInput = Omit<CopiloteAccount, "id" | "updatedAt">;

/** Slug client — MÊME règle que le backend (functions/domain/nt360.js#slugifyClient), pour que la
 *  création manuelle vise le même doc que la synchro nt360 (réconciliation, pas de doublon). */
export function slugifyClient(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function useCopiloteAccounts(): { accounts: CopiloteAccount[]; loading: boolean; error: Error | null } {
  const [accounts, setAccounts] = useState<CopiloteAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "copiloteAccounts"), orderBy("nom", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        // Normalisation : garantit que les champs qualitatifs sont toujours des tableaux/chaînes,
        // même pour un compte issu seulement de la synchro nt360 (qui n'écrit que nom + nt360).
        setAccounts(
          snap.docs.map((d) => {
            const raw = d.data() as Omit<CopiloteAccount, "id">;
            return {
              id: d.id,
              nom: raw.nom || "",
              secteur: raw.secteur || "",
              tier: raw.tier || "",
              enjeux: raw.enjeux ?? [],
              whitespace: raw.whitespace ?? [],
              enCours: raw.enCours ?? [],
              historique: raw.historique ?? [],
              contacts: raw.contacts ?? [],
              preuves: raw.preuves ?? [],
              tendances: raw.tendances ?? [],
              reglementation: raw.reglementation,
              concurrence: raw.concurrence,
              nt360: raw.nt360,
            };
          })
        );
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { accounts, loading, error };
}

export async function createCopiloteAccount(input: CopiloteAccountInput): Promise<string> {
  // Vise le doc `copiloteAccounts/<slug(nom)>` (merge) au lieu d'un id auto : ainsi un compte créé
  // à la main et son jumeau synchronisé depuis nt360 partagent le MÊME doc — plus de doublon ni de
  // double comptage dans les KPIs du portefeuille. Repli id auto si le nom n'a pas de slug.
  const slug = slugifyClient(input.nom);
  if (slug) {
    await setDoc(doc(db, "copiloteAccounts", slug), input, { merge: true });
    return slug;
  }
  const ref = await addDoc(collection(db, "copiloteAccounts"), input);
  return ref.id;
}
export async function upsertCopiloteAccount(id: string, patch: Partial<CopiloteAccountInput>): Promise<void> {
  await setDoc(doc(db, "copiloteAccounts", id), patch, { merge: true });
}
export async function deleteCopiloteAccount(id: string): Promise<void> {
  await deleteDoc(doc(db, "copiloteAccounts", id));
}

/* ---------------------------------------------------------------------------------------------
 * Agents IA (callables server-side)
 * ------------------------------------------------------------------------------------------- */

export type CopiloteAgent = "prospection" | "cvp" | "triennal" | "planCompte" | "redaction";

export interface ProspectionCible { nom: string; source?: string; angle: string; accroche: string; chaleur: "Chaud" | "Tiède" | "Froid" }
export interface ProspectionResult { cibles: ProspectionCible[] }

export interface CvpResult { message: string; differenciateurs: string[] }

export interface TriennalItem { an: "An 1" | "An 2" | "An 3"; titre: string; offres: string[]; jalon: string }
export interface TriennalResult { roadmap: TriennalItem[] }

export interface PlanCompteAction { libelle: string; horizon: "Court terme" | "Moyen terme" | "Continu" }
export interface PlanCompteRisque { r: string; m: string; niv: "Élevé" | "Moyen" | "Faible" }
export interface PlanCompteResult { actions: PlanCompteAction[]; risques: PlanCompteRisque[] }

export interface RedactionVariante { label: string; objet: string; corps: string }
export interface RedactionResult { variantes: RedactionVariante[] }

export interface CopiloteChatMessage { role: "user" | "assistant"; content: string }

/** Appelle un agent structuré. `extra` fournit les champs propres à l'écran (ex. redaction). */
export async function copiloteGenerate<T>(agent: CopiloteAgent, accountId?: string, extra?: Record<string, unknown>): Promise<T> {
  const call = httpsCallable<{ agent: string; accountId?: string; extra?: Record<string, unknown> }, T>(functions, "copiloteGenerate");
  const { data } = await call({ agent, accountId, extra });
  return data;
}

/** Chat multi-turn : envoie l'historique complet + contexte compte. */
export async function copiloteChat(messages: CopiloteChatMessage[], accountId?: string, ecran?: string): Promise<{ reply: string }> {
  const call = httpsCallable<{ messages: CopiloteChatMessage[]; accountId?: string; ecran?: string }, { reply: string }>(functions, "copiloteChat");
  const { data } = await call({ messages, accountId, ecran });
  return data;
}

/** Pré-remplit l'empreinte des comptes depuis nt360 (read-only). Retourne le nombre de comptes traités. */
export async function syncCopiloteAccountsFromNt360(): Promise<{ accounts: number }> {
  const call = httpsCallable<void, { accounts: number }>(functions, "syncCopiloteAccountsNow");
  const { data } = await call();
  return data;
}
