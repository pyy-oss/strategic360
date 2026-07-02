/**
 * Firestore data layer for the V6 "Exécution & concurrence" phase (BUILD_KIT.md §6, §7, §11).
 *
 * Covers the collections behind the Exécution, Plan d'action, Concurrence and Scénarios views:
 * `strategicThemes`, `initiatives`, `decisions`, `actions`, `battlecards`, `winLoss`, `scenarios`.
 * (`techRadar`/`innovationPortfolio` live in `./innovation.ts`; `frameworks` in `./frameworks.ts`.)
 *
 * Types mirror BUILD_KIT.md §6 field-for-field. All 7 collections here are exec-write per
 * `firestore.rules` (`allow write: if exec()` for strategicThemes/initiatives/decisions/actions/
 * winLoss/scenarios; `allow write: if canWrite('veille')` — i.e. any veille contributor — for
 * `battlecards`, which BUILD_KIT.md §7 explicitly calls out as "battlecards → contribution
 * commerciale"). Client-side gating below uses `useIsExec()`/`useCan('veille')` from
 * `lib/rbac.ts` for UX only; the Security Rules remain the sole authority.
 *
 * Same `onSnapshot`-based hook + `create*`/`update*` function pattern as `lib/intel.ts` (V2) and
 * `lib/quanti.ts` (V4).
 */
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type FieldValue,
  type Timestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";

/* ---------------------------------------------------------------------------------------------
 * strategicThemes
 * ------------------------------------------------------------------------------------------- */

export interface StrategicTheme {
  id: string;
  title: string;
  description?: string;
  owner?: string;
  order?: number;
}

export type StrategicThemeInput = Omit<StrategicTheme, "id">;

export function useStrategicThemes(): { themes: StrategicTheme[]; loading: boolean; error: Error | null } {
  const [themes, setThemes] = useState<StrategicTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "strategicThemes"), orderBy("order", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setThemes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StrategicTheme, "id">) })));
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

  return { themes, loading, error };
}

export async function createStrategicTheme(input: StrategicThemeInput): Promise<string> {
  const ref = await addDoc(collection(db, "strategicThemes"), input);
  return ref.id;
}

/* ---------------------------------------------------------------------------------------------
 * initiatives
 * ------------------------------------------------------------------------------------------- */

export type InitiativeStatus = "à lancer" | "en cours" | "terminée" | "en retard" | string;
export type InitiativeHorizon = "H1" | "H2" | "H3" | string;

export interface Initiative {
  id: string;
  title: string;
  themeId?: string;
  objective: string;
  keyResults: string[];
  owner: string;
  status: InitiativeStatus;
  horizon: InitiativeHorizon;
  dueDate?: string;
  progress: number; // 0-1
  linkedItems: string[];
  linkedDecisionId?: string;
  createdAt?: Timestamp | FieldValue;
}

export type InitiativeInput = Omit<Initiative, "id" | "createdAt">;

export function useInitiatives(): { initiatives: Initiative[]; loading: boolean; error: Error | null } {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "initiatives"),
      (snap) => {
        setInitiatives(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Initiative, "id">) })));
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

  return { initiatives, loading, error };
}

export async function createInitiative(input: InitiativeInput): Promise<string> {
  const ref = await addDoc(collection(db, "initiatives"), input);
  return ref.id;
}

export async function updateInitiative(id: string, patch: Partial<Initiative>): Promise<void> {
  await updateDoc(doc(db, "initiatives", id), patch as Record<string, unknown>);
}

/* ---------------------------------------------------------------------------------------------
 * decisions
 * ------------------------------------------------------------------------------------------- */

export type DecisionStatus = "Actée" | "En cours" | "En attente" | string;

export interface Decision {
  id: string;
  title: string;
  context?: string;
  options: string[];
  chosen: string;
  rationale?: string;
  decidedBy: string;
  date: string;
  linkedItems: string[];
  linkedInitiativeId?: string;
  reviewDate?: string;
  outcome?: string;
  statut: DecisionStatus; // convenience field for the maquette's badge (not in BUILD_KIT.md §6
  // literally, but the maquette's DECISIONS sample has a `statut`; kept alongside `chosen`/
  // `outcome` so the existing table rendering (Actée/En cours/En attente badge) needs no redesign.
}

export type DecisionInput = Omit<Decision, "id">;

export function useDecisions(): { decisions: Decision[]; loading: boolean; error: Error | null } {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "decisions"), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDecisions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Decision, "id">) })));
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

  return { decisions, loading, error };
}

export async function createDecision(input: DecisionInput): Promise<string> {
  const ref = await addDoc(collection(db, "decisions"), input);
  return ref.id;
}

/* ---------------------------------------------------------------------------------------------
 * actions
 * ------------------------------------------------------------------------------------------- */

export type ActionStatus = "À planifier" | "À lancer" | "En cours" | "À surveiller" | "Immédiat" | string;

export interface StrategicAction {
  id: string;
  title: string;
  impact: number; // 1-5 (maquette scale)
  urgence: number; // 1-5
  effort: number; // 1-5
  ev: number; // valeur attendue (M FCFA) — BUILD_KIT.md §8.3: priorité = impact×urgence/effort ; `ev` is
  // the action's own expected-value input (distinct from the derived priority score, computed
  // client-side at submit time per the task brief).
  owner: string;
  echeance: string;
  statut: ActionStatus;
  source?: string;
  linkedItemId?: string;
}

export type ActionInput = Omit<StrategicAction, "id">;

export function useActions(): { actions: StrategicAction[]; loading: boolean; error: Error | null } {
  const [actions, setActions] = useState<StrategicAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "actions"),
      (snap) => {
        setActions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StrategicAction, "id">) })));
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

  return { actions, loading, error };
}

export async function createAction(input: ActionInput): Promise<string> {
  const ref = await addDoc(collection(db, "actions"), input);
  return ref.id;
}

export async function updateAction(id: string, patch: Partial<StrategicAction>): Promise<void> {
  await updateDoc(doc(db, "actions", id), patch as Record<string, unknown>);
}

/** BUILD_KIT.md §8.3: "priorité action = impact×urgence/effort". */
export function actionPriority(a: { impact: number; urgence: number; effort: number }): number {
  if (!a.effort) return 0;
  return Math.round(((a.impact * a.urgence) / a.effort) * 10) / 10;
}

/* ---------------------------------------------------------------------------------------------
 * battlecards
 * ------------------------------------------------------------------------------------------- */

export interface Battlecard {
  id: string; // == competitorId
  competitor: string;
  positioning?: string;
  strengths: string[];
  weaknesses: string[];
  ourWinThemes: string[];
  theirLikelyMoves: string[];
  objectionHandling: string[];
  recentMoves: string[];
}

export type BattlecardInput = Omit<Battlecard, "id">;

export function useBattlecards(): { battlecards: Battlecard[]; loading: boolean; error: Error | null } {
  const [battlecards, setBattlecards] = useState<Battlecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "battlecards"),
      (snap) => {
        setBattlecards(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Battlecard, "id">) })));
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

  return { battlecards, loading, error };
}

/** `battlecards/{competitorId}` — deterministic ID from the competitor name (idempotent upsert). */
export function battlecardId(competitor: string): string {
  return competitor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function upsertBattlecard(input: BattlecardInput): Promise<string> {
  const id = battlecardId(input.competitor);
  await setDoc(doc(db, "battlecards", id), input, { merge: true });
  return id;
}

/* ---------------------------------------------------------------------------------------------
 * winLoss
 * ------------------------------------------------------------------------------------------- */

export type WinLossResult = "win" | "loss";

export interface WinLossEntry {
  id: string; // == oppFp (opportunity fingerprint)
  competitor: string;
  result: WinLossResult;
  reason?: string;
  amount?: number;
  lesson?: string;
  date: string;
}

export type WinLossInput = Omit<WinLossEntry, "id">;

export function useWinLoss(): { entries: WinLossEntry[]; loading: boolean; error: Error | null } {
  const [entries, setEntries] = useState<WinLossEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "winLoss"), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WinLossEntry, "id">) })));
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

  return { entries, loading, error };
}

export async function createWinLossEntry(input: WinLossInput): Promise<string> {
  const ref = await addDoc(collection(db, "winLoss"), input);
  return ref.id;
}

/** Aggregates `winLoss` entries into a per-competitor win rate, mirroring the maquette's
 * `CONCURRENTS[].win`/`.deals` fields so `Concurrence.tsx` can compute the same bar chart from
 * real data once `winLoss` has entries (falls back to an empty map otherwise). */
export function winRateByCompetitor(entries: WinLossEntry[]): Record<string, { win: number; deals: number }> {
  const byCompetitor: Record<string, { wins: number; total: number }> = {};
  for (const e of entries) {
    const bucket = (byCompetitor[e.competitor] ??= { wins: 0, total: 0 });
    bucket.total += 1;
    if (e.result === "win") bucket.wins += 1;
  }
  const out: Record<string, { win: number; deals: number }> = {};
  for (const [competitor, { wins, total }] of Object.entries(byCompetitor)) {
    out[competitor] = { win: total ? wins / total : 0, deals: total };
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * scenarios
 * ------------------------------------------------------------------------------------------- */

export interface ScenarioWorld {
  q: string; // quadrant label
  d: string; // description / implication
  c: string; // accent color (hex, matches design tokens at write-time)
}

export interface Scenario {
  id: string;
  title: string;
  axisX: string;
  axisY: string;
  worlds: ScenarioWorld[]; // length 4
  probs?: number[]; // length 4, sums ~1
  triggers: string[];
  responses: string[];
}

export type ScenarioInput = Omit<Scenario, "id">;

export function useScenarios(): { scenarios: Scenario[]; loading: boolean; error: Error | null } {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "scenarios"),
      (snap) => {
        setScenarios(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Scenario, "id">) })));
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

  return { scenarios, loading, error };
}

export async function createScenario(input: ScenarioInput): Promise<string> {
  const ref = await addDoc(collection(db, "scenarios"), input);
  return ref.id;
}
