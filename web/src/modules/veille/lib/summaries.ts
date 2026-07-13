/**
 * Firestore data layer for the V3 "Scoring & agrégats veille" phase (BUILD_KIT.md §6, §10, §11).
 *
 * Reads the two aggregate documents written by Cloud Functions (`aggregateVeille`,
 * `aggregateVeilleExec`/`aggregateVeilleExecOnWrite`): `summaries/veille` and
 * `summaries/veille_exec`. These are read-only from the client (Security Rules: `allow write:
 * if false` — Functions only), following the same Firebase v9 modular SDK `onSnapshot` hook
 * pattern as `lib/intel.ts`.
 *
 * Both documents may not exist yet (e.g. before any `intelItems` has ever been written/scored),
 * so `data` is nullable and callers should render a loading/placeholder state accordingly.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot, type FieldValue, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase";

/* ---------------------------------------------------------------------------------------------
 * Types (BUILD_KIT.md §6)
 * ------------------------------------------------------------------------------------------- */

export interface VeilleSummaryLite {
  id: string;
  title: string;
  score: number;
}

export interface VeilleSummaryRecentItem {
  id: string;
  title: string;
  date: string;
  axis?: string;
  impact?: string;
}

export interface VeilleSummaryEntity {
  ent: string;
  count: number;
}

export interface VeilleSummary {
  countsByAxis: Record<string, number>;
  countsByImpact: Record<string, number>;
  countsByGeo: Record<string, number>;
  topThreats: VeilleSummaryLite[];
  topOpportunities: VeilleSummaryLite[];
  recentItems: VeilleSummaryRecentItem[];
  tendersOpen: number;
  entitiesMostActive: VeilleSummaryEntity[];
  updatedAt?: Timestamp | FieldValue;
}

export interface VeilleExecBoardKpis {
  menacesTotal: number;
  menacesTraitees: number;
  opportunites: number;
  winRateGlobal?: number | null; // taux de victoire global (winLoss) — null si aucun deal
}

export interface VeilleExecDecisionPending {
  id: string;
  title: string;
  owner: string;
}

export interface VeilleExecWinRate {
  win: number;
  deals: number;
  amountWon?: number;
  amountLost?: number;
}

export interface VeilleExecSummary {
  boardKpis: VeilleExecBoardKpis;
  decisionsPending: VeilleExecDecisionPending[];
  porter: unknown | null; // from summaries/quanti (nt360 sync)
  winRateByCompetitor: Record<string, VeilleExecWinRate>; // taux de victoire par concurrent (winLoss)
  pipelineInfluenced: number | null; // XOF — value-at-stake des clients suivis/cités par la veille (null tant que summaries/quanti est absent)
  threatsHighUnactionedCount: number; // compte de menaces high-impact non traitées (ex-« threatsExposure »)
  okrProgress: number | null; // avancement moyen des initiatives (0-1)
  updatedAt?: Timestamp | FieldValue;
}

/* ---------------------------------------------------------------------------------------------
 * summaries/veille
 * ------------------------------------------------------------------------------------------- */

export function useVeilleSummary(): { data: VeilleSummary | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<VeilleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "summaries", "veille"),
      (snap) => {
        setData(snap.exists() ? (snap.data() as VeilleSummary) : null);
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

  return { data, loading, error };
}

/* ---------------------------------------------------------------------------------------------
 * summaries/veille_exec
 * ------------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------------
 * summaries/aiHealth — canari Vertex AI (écrit par la Cloud Function aiHealthCheck)
 * ------------------------------------------------------------------------------------------- */

export interface AiHealth {
  ok?: boolean;
  model?: string;
  lastError?: string | null;
  checkedAt?: Timestamp | FieldValue;
}

/** Santé de la chaîne IA. `ok===false` → panne Vertex (modèle KO) : à signaler visiblement. */
export function useAiHealth(): { data: AiHealth | null; loading: boolean } {
  const [data, setData] = useState<AiHealth | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "summaries", "aiHealth"),
      (snap) => { setData(snap.exists() ? (snap.data() as AiHealth) : null); setLoading(false); },
      () => { setData(null); setLoading(false); }
    );
    return unsub;
  }, []);
  return { data, loading };
}

/** Progression de la synchro (summaries/syncStatus, écrit par runSyncSources) — pour l'UI live. */
export interface SyncStatus {
  running?: boolean;
  total?: number;
  processed?: number;
  created?: number;
  evaluated?: number;
  phase?: "ingestion" | "dedup" | "evaluation" | "done" | string;
  startedAt?: Timestamp | FieldValue | null;
  finishedAt?: Timestamp | FieldValue | null;
}

export function useSyncStatus(): { data: SyncStatus | null } {
  const [data, setData] = useState<SyncStatus | null>(null);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "summaries", "syncStatus"),
      (snap) => setData(snap.exists() ? (snap.data() as SyncStatus) : null),
      () => setData(null)
    );
    return unsub;
  }, []);
  return { data };
}

/* ---------------------------------------------------------------------------------------------
 * summaries/kpiHistory — historique quotidien des KPIs exécutifs (levier « waouh » : tendances)
 * ------------------------------------------------------------------------------------------- */

export interface KpiHistoryPoint {
  date: string; // YYYY-MM-DD
  pipelineInfluenced?: number | null;
  menacesTotal?: number | null;
  menacesTraitees?: number | null;
  opportunites?: number | null;
  winRateGlobal?: number | null;
  okrProgress?: number | null;
  threatsHighUnactioned?: number | null;
  backfilled?: boolean; // point RECONSTRUIT depuis intelItems.createdAt (menaces/opps cumulés) — pas un vrai instantané figé le jour même.
}
export interface KpiHistory { points?: KpiHistoryPoint[]; updatedAt?: Timestamp | FieldValue }

export interface BackfillKpiResult { ok: boolean; total: number; reconstructed: number; todaySnapshot: boolean }

/**
 * Reconstruit l'historique KPI (callable exec `backfillKpiHistory`) : au lancement, l'historique est
 * vide → aucune tendance ↑/↓ avant plusieurs jours. Ce seed recrée honnêtement le cumul
 * menaces/opportunités depuis les dates de création des signaux, puis fige le point du jour.
 */
export async function backfillKpiHistory(days?: number): Promise<BackfillKpiResult> {
  const call = httpsCallable<{ days?: number }, BackfillKpiResult>(functions, "backfillKpiHistory", { timeout: 540_000 });
  const { data } = await call(days ? { days } : {});
  return data;
}

/** Historique des KPIs (summaries/kpiHistory, écrit par snapshotVeilleKpis) — exec-only en lecture. */
export function useKpiHistory(): { points: KpiHistoryPoint[] } {
  const [points, setPoints] = useState<KpiHistoryPoint[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "summaries", "kpiHistory"),
      (snap) => setPoints(snap.exists() ? ((snap.data() as KpiHistory).points ?? []) : []),
      () => setPoints([])
    );
    return unsub;
  }, []);
  return { points };
}

export interface KpiDelta { abs: number; pct: number | null; dir: "up" | "down" | "flat"; sinceDate: string }

/**
 * kpiDelta(points, key, days) → variation de `key` entre la valeur courante et le point le plus
 * proche d'il y a `days` jours (repli sur le plus ancien point disponible si l'historique est plus
 * court). Renvoie null tant qu'il n'y a pas au moins deux points comparables — pas de fausse
 * tendance. `sinceDate` sert au libellé (« depuis le … »).
 */
export function kpiDelta(points: KpiHistoryPoint[], key: keyof KpiHistoryPoint, days = 7): KpiDelta | null {
  const usable = points
    .filter((p) => typeof p[key] === "number")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (usable.length < 2) return null;
  const latest = usable[usable.length - 1];
  const cur = latest[key] as number;
  const target = new Date(new Date(latest.date + "T00:00:00Z").getTime() - days * 86400000);
  const targetStr = target.toISOString().slice(0, 10);
  const olderOrEqual = usable.filter((p) => p.date <= targetStr && p !== latest);
  const ref = olderOrEqual.length ? olderOrEqual[olderOrEqual.length - 1] : usable[0];
  if (ref === latest) return null;
  const prev = ref[key] as number;
  const abs = cur - prev;
  const pct = prev !== 0 ? abs / Math.abs(prev) : null;
  const dir: "up" | "down" | "flat" = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, dir, sinceDate: ref.date };
}

export function useVeilleExecSummary(): { data: VeilleExecSummary | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<VeilleExecSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "summaries", "veille_exec"),
      (snap) => {
        setData(snap.exists() ? (snap.data() as VeilleExecSummary) : null);
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

  return { data, loading, error };
}
