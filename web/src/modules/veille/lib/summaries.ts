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
import { db } from "../../../lib/firebase";

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
