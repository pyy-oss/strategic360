/**
 * Firestore data layer for the V7 "IA & sync" phase — `briefings` collection (BUILD_KIT.md §6,
 * §10 `generateBriefing`/`exportPdf`, §11 "Briefing lit briefings, summaries/*").
 *
 * Same `onSnapshot`-based hook pattern as `lib/intel.ts`/`lib/execution.ts`; the two Cloud
 * Functions (`generateBriefing`, `exportPdf`) are wrapped as thin `httpsCallable` calls, following
 * the same "callable from the client, all business logic + AI calls server-side" convention
 * documented throughout BUILD_KIT.md §10.
 */
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, type FieldValue, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../../../lib/firebase";

/* ---------------------------------------------------------------------------------------------
 * Types (BUILD_KIT.md §6 `briefings/{id}`, mirrored from functions/domain/briefing.js)
 * ------------------------------------------------------------------------------------------- */

export interface BriefingArgument {
  title: string;
  body: string;
}

export interface BriefingTopItem {
  title: string;
  score: number;
}

/** Recommandation orientée décision (miroir de coerceRecommendation, functions/domain/briefing.js). */
export interface BriefingRecommendation {
  action: string;
  owner: string;
  deadline: string;
  expectedValue: string | null;
}

export interface BriefingContent {
  narrative: string;
  topOpportunities: BriefingTopItem[];
  topThreats: BriefingTopItem[];
  recommendations: BriefingRecommendation[];
  /** 1 à 3 décisions explicites demandées au comité (go/no-go AO, budget certif, agrément PASSI). */
  decisionsRequested?: string[];
}

export type BriefingStatus = "draft" | "reviewed" | "published" | string;

export interface Briefing {
  id: string;
  period: string;
  governingThought: string;
  arguments: BriefingArgument[]; // length 3 (MECE)
  content: BriefingContent;
  kpis?: Record<string, unknown> | null;
  generatedBy?: string;
  reviewedBy?: string | null; // null until a human reviews it — BUILD_KIT.md §1 human-review gate
  status: BriefingStatus; // ALWAYS starts 'draft' — never auto-published (see functions/domain/briefing.js)
  createdAt?: Timestamp | FieldValue;
}

/* ---------------------------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------------------------- */

/** Live (`onSnapshot`) list of `briefings`, ordered most-recent first. */
export function useBriefings(): { briefings: Briefing[]; loading: boolean; error: Error | null } {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "briefings"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setBriefings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Briefing, "id">) })));
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

  return { briefings, loading, error };
}

/** The most recently generated briefing (or `null` if none exists yet). */
export function useLatestBriefing(): { briefing: Briefing | null; loading: boolean; error: Error | null } {
  const { briefings, loading, error } = useBriefings();
  return { briefing: briefings[0] ?? null, loading, error };
}

/* ---------------------------------------------------------------------------------------------
 * Cloud Functions callables
 * ------------------------------------------------------------------------------------------- */

interface GenerateBriefingResult {
  id: string;
  status: BriefingStatus;
}

/**
 * Calls the `generateBriefing` Cloud Function (exec-gated server-side — see functions/index.js).
 * Returns the newly created `briefings/{id}` doc id.
 */
// Timeout client aligné sur le serveur (540 s) — la génération IA d'un briefing dépasse le défaut 70 s.
const HEAVY_CALL = { timeout: 540_000 } as const;

export async function generateBriefing(): Promise<GenerateBriefingResult> {
  const call = httpsCallable<void, GenerateBriefingResult>(functions, "generateBriefing", HEAVY_CALL);
  const { data } = await call();
  return data;
}

interface ExportBriefingPdfResult {
  url: string;
  path: string;
}

/**
 * Calls the `exportPdf` Cloud Function (exec-gated server-side) for the given briefing id (or the
 * most recent briefing if `briefingId` is omitted). Returns the Cloud Storage signed read URL —
 * callers typically `window.open(url, "_blank")` it or offer it as a download link.
 */
export async function exportBriefingPdf(briefingId?: string): Promise<string> {
  const call = httpsCallable<{ briefingId?: string }, ExportBriefingPdfResult>(functions, "exportPdf", HEAVY_CALL);
  const { data } = await call(briefingId ? { briefingId } : {});
  return data.url;
}

/**
 * FRANCHIT LE GATE DE REVUE HUMAINE (audit valeur CXO 2026-07). Un briefing naît toujours `draft` ;
 * sans action de validation, le board pack reste éternellement « Brouillon — à valider », ce qui
 * neutralise l'engagement décisionnel du DG. Cette écriture directe (autorisée par firestore.rules :
 * `briefings` write si exec()) pose `status: 'reviewed'` + `reviewedBy`/`reviewedAt`. C'EST l'acte
 * de revue humaine exigé par le socle — jamais fait par l'IA. Repasser en brouillon est possible
 * (un exec peut vouloir retirer une validation). Le serveur reste l'autorité (règle exec()).
 */
export async function reviewBriefing(briefingId: string, reviewed: boolean): Promise<void> {
  const uid = auth.currentUser?.uid ?? null;
  await updateDoc(doc(db, "briefings", briefingId), reviewed
    ? { status: "reviewed", reviewedBy: uid, reviewedAt: serverTimestamp() }
    : { status: "draft", reviewedBy: null, reviewedAt: null });
}
