/**
 * Firestore data layer for the V6 "Tech Radar & Innovation" view (BUILD_KIT.md §6, §7, §11).
 *
 * Covers `techRadar` and `innovationPortfolio` — both gated `allow write: if role() in
 * ['direction','innovation']` per `firestore.rules` (BUILD_KIT.md §7: "techRadar/innovationPortfolio
 * → innovation"), i.e. narrower than the general `exec()` gate used by `initiatives`/`decisions`/etc.
 * Client-side convenience gating here therefore checks the role directly rather than `useIsExec()`.
 *
 * Same `onSnapshot`-based hook + `create*` pattern as `lib/intel.ts` (V2) / `lib/execution.ts` (V6).
 */
import { useEffect, useState } from "react";
import { addDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "../../../lib/firebase";

/* ---------------------------------------------------------------------------------------------
 * techRadar
 * ------------------------------------------------------------------------------------------- */

export type TechRadarRing = "adopter" | "essayer" | "evaluer" | "suspendre";
export type TechRadarMomentum = "↑" | "→" | "↓";

export interface TechRadarBlip {
  id: string; // == blipId
  name: string;
  quadrant: number; // 0-3, matches design/tokens.ts QUAD_TECH order
  ring: TechRadarRing;
  momentum: TechRadarMomentum;
  rationale?: string;
  linkedItems: string[];
}

export type TechRadarBlipInput = Omit<TechRadarBlip, "id">;

export function useTechRadar(): { blips: TechRadarBlip[]; loading: boolean; error: Error | null } {
  const [blips, setBlips] = useState<TechRadarBlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "techRadar"),
      (snap) => {
        setBlips(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TechRadarBlip, "id">) })));
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

  return { blips, loading, error };
}

export async function createTechRadarBlip(input: TechRadarBlipInput): Promise<string> {
  const ref = await addDoc(collection(db, "techRadar"), input);
  return ref.id;
}

/* ---------------------------------------------------------------------------------------------
 * innovationPortfolio
 * ------------------------------------------------------------------------------------------- */

export type InnovationStage = "idée" | "exploration" | "poc" | "pilote" | "scale" | string;

export interface InnovationBet {
  id: string;
  title: string;
  reach: number; // 1-10
  impact: number; // 1-10
  confidence: number; // 0-1
  effort: number; // 1-10
  rice: number; // BUILD_KIT.md §8.3: RICE = (reach·impact·confidence)/effort — stored for quick sort/read
  stage: InnovationStage;
  owner?: string;
  budget?: number;
  horizon?: string;
  // Rendu actionnable (2026-07) : secteur métier ciblé → offre NT → comptes/profils cibles (généré par l'IA).
  sector?: string;
  offre?: string;
  comptesCibles?: string[];
  // Auditabilité (2026-07) : justification + indices des signaux sources qui fondent le pari.
  rationale?: string;
  sourceSignals?: number[];
}

export type InnovationBetInput = Omit<InnovationBet, "id" | "rice">;

export function useInnovationPortfolio(): { bets: InnovationBet[]; loading: boolean; error: Error | null } {
  const [bets, setBets] = useState<InnovationBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "innovationPortfolio"),
      (snap) => {
        setBets(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InnovationBet, "id">) })));
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

  return { bets, loading, error };
}

/** BUILD_KIT.md §8.3: RICE = (reach·impact·confidence)/effort. */
export function riceScore(o: { reach: number; impact: number; confidence: number; effort: number }): number {
  if (!o.effort) return 0;
  return Math.round(((o.reach * o.impact * o.confidence) / o.effort) * 10) / 10;
}

export async function createInnovationBet(input: InnovationBetInput): Promise<string> {
  const ref = await addDoc(collection(db, "innovationPortfolio"), { ...input, rice: riceScore(input) });
  return ref.id;
}
