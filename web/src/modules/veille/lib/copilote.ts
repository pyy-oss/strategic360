/**
 * Data layer — Copilote Commercial (add-on DELTA 02 / 02B).
 *
 * Reuse maximum : mêmes conventions que lib/execution.ts / lib/intel.ts (onSnapshot + httpsCallable).
 * Le moteur IA vit côté serveur (callables copiloteGenerate / copiloteChat) ; ici on ne fait que
 * wrapper les appels + gérer la collection `copiloteAccounts` (qualitatif compte).
 */
import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  type FieldValue,
  type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../../../lib/firebase";

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
  /** Attribution manuelle (e-mails) — champ SERVEUR, écrit via setCopiloteAccountOwners. */
  owners?: string[];
  /** Empreinte dérivée du pipeline nt360 (read-only) — additive, ne remplace jamais le qualitatif. */
  nt360?: {
    historique?: CopiloteHistoriqueItem[];
    enCours?: string[];
    casTotal?: number;
    pipelinePondere?: number;
    wins?: number;
    opportunites?: CopiloteOpportunite[];
    ams?: string[];
    bus?: string[];
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

/** Normalise un doc compte (défauts sûrs) — un compte issu seulement de la synchro nt360 ne porte
 *  que nom + nt360 ; sans ces défauts, `account.enjeux.map` planterait la fiche. */
function normalizeAccount(raw: CopiloteAccount): CopiloteAccount {
  return {
    id: raw.id,
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
    owners: raw.owners ?? [],
    nt360: raw.nt360,
  };
}

/**
 * Portefeuille CLOISONNÉ : on ne streame plus les ~800 docs côté client (cf. audit). On appelle le
 * callable listCopiloteAccounts qui applique le périmètre serveur (exec/dir → tout ; commercial →
 * son périmètre). `reload` rafraîchit après une synchro/création/attribution.
 */
export function useCopiloteAccounts(): {
  accounts: CopiloteAccount[];
  loading: boolean;
  error: Error | null;
  scoped: boolean;
  reload: () => void;
} {
  const [accounts, setAccounts] = useState<CopiloteAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [scoped, setScoped] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    const call = httpsCallable<void, { accounts: CopiloteAccount[]; scoped: boolean }>(functions, "listCopiloteAccounts");
    call()
      .then(({ data }) => {
        setAccounts((data.accounts || []).map(normalizeAccount));
        setScoped(!!data.scoped);
        setError(null);
      })
      .catch((e) => setError(e as Error))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { accounts, loading, error, scoped, reload };
}

export async function createCopiloteAccount(input: CopiloteAccountInput): Promise<string> {
  // Vise le doc `copiloteAccounts/<slug(nom)>` (merge) au lieu d'un id auto : ainsi un compte créé
  // à la main et son jumeau synchronisé depuis nt360 partagent le MÊME doc — plus de doublon ni de
  // double comptage dans les KPIs du portefeuille. Repli id auto si le nom n'a pas de slug.
  // `createdBy` = créateur : garantit qu'un commercial voit le compte qu'il vient de créer même
  // sans rattachement am/BU/owner (le cloisonnement filtrerait sinon son propre compte).
  const uid = auth.currentUser?.uid;
  const payload = uid ? { ...input, createdBy: uid } : input;
  const slug = slugifyClient(input.nom);
  if (slug) {
    await setDoc(doc(db, "copiloteAccounts", slug), payload, { merge: true });
    return slug;
  }
  const ref = await addDoc(collection(db, "copiloteAccounts"), payload);
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

/** Attribue un compte à des commerciaux (e-mails). Réservé direction / commercial_dir (gate serveur). */
export async function setCopiloteAccountOwners(accountId: string, owners: string[]): Promise<void> {
  const call = httpsCallable<{ action: string; accountId: string; owners: string[] }, unknown>(functions, "copiloteAdmin");
  await call({ action: "setOwners", accountId, owners });
}

/** Définit le périmètre (am / BU) d'un commercial. Réservé direction / commercial_dir (gate serveur). */
export async function setCopiloteScope(uid: string, ams: string[], bus: string[]): Promise<void> {
  const call = httpsCallable<{ action: string; uid: string; ams: string[]; bus: string[] }, unknown>(functions, "copiloteAdmin");
  await call({ action: "setScope", uid, ams, bus });
}
