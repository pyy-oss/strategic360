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
  tti: number | null; // pending V6 (decisions collection)
}

export interface VeilleExecSummary {
  boardKpis: VeilleExecBoardKpis;
  decisionsPending: unknown[]; // pending V6
  porter: unknown | null; // pending V4 (summaries/quanti)
  winRateByCompetitor: Record<string, number>; // pending V6 (winLoss)
  pipelineInfluenced: number; // pending V4+ (opportunities/pipeline linkage)
  threatsExposure: number; // placeholder metric (count of high-impact, unactioned threats)
  okrProgress: number | null; // pending V6 (initiatives)
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
