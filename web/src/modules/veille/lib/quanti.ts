/**
 * Firestore data layer for the V4 "Quanti interne" phase (BUILD_KIT.md §6, §9, §10, §11).
 *
 * Reads the single aggregate document written by the `ingestInternal` Cloud Function:
 * `summaries/quanti`. Read-only from the client (Security Rules: `allow write: if false` —
 * Functions only, same pattern as `lib/summaries.ts`'s `summaries/veille*`).
 *
 * The document may not exist yet (no internal file has ever been uploaded to Storage `imports/*`
 * in this environment), so `data` is nullable — callers must render a loading/"—" placeholder
 * state, same convention as `RadarExecutif.tsx` (V3).
 *
 * Field shapes mirror exactly what `functions/index.js`'s `computeSummaryQuanti` writes (see
 * that function's doc comment for which fields are genuinely computed vs. deliberately left
 * null because they aren't derivable from the 3 internal sources wired in V4 — `ge9`, `marginAvg`,
 * `recurrentShare`).
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot, type FieldValue, type Timestamp } from "firebase/firestore";
import { db } from "../../../lib/firebase";

/* ---------------------------------------------------------------------------------------------
 * Types (BUILD_KIT.md §6 `summaries/quanti` + functions/domain/quanti.js return shapes)
 * ------------------------------------------------------------------------------------------- */

export interface QuantiPorterForces {
  pouvoirFournisseurs: number | null; // Top-3 fournisseur CAS concentration (0-100), from `orders`
  pouvoirClients: number | null; // Top-5 client montant concentration (0-100), from `opportunities`
}

export interface QuantiBcgEntry {
  n: string; // BU name
  part: number; // 0-1, relative to our largest BU's CAS (proxy — see functions/domain/quanti.js)
  croissance: number; // 0-1, clamped (CAS_N - CAS_N1) / CAS_N1
  marge: number;
  q: "Vedette" | "Vache à lait" | "Dilemme" | "Poids mort";
}

export interface QuantiKri {
  n: string;
  u: string;
  val: number | null;
  stat: "ok" | "warn" | "alert" | null;
  caveat?: string; // present when val is null due to a known missing-prerequisite (e.g. Part de récurrent)
  sub?: string;    // sous-texte de contexte (ex. échantillon « 3 gagnés / 3 clos ») — crédibilité
  hint?: string;   // infobulle explicative (ex. proxy « Dépendance Top-3 fournisseurs »)
}

export interface QuantiValueAtStakeEntry {
  n: string;
  type: "opp"; // V4 only derives opportunities — no threats (those live in intelItems, a separate concern)
  p: number;
  impact: number;
}

export interface QuantiGranulariteEntry {
  seg: string; // segment = BU (un axe segment×offre plus fin attend un tag offre côté source)
  casN: number; // CAS exercice courant (XOF)
  casN1: number; // CAS exercice précédent (XOF)
  delta: number; // casN − casN1 (XOF, peut être négatif)
}

export interface QuantiSummary {
  porterForces: QuantiPorterForces;
  bcg: QuantiBcgEntry[];
  granularite?: QuantiGranulariteEntry[]; // croissance par segment (BU), XOF bruts — nt360 sync
  ge9: unknown[] | null; // not derivable from internal data alone — see Portefeuille.tsx
  casTotal: number | null; // portfolio-wide CAS (current year), from P&L `orders` — Simulateur SIM_BASE.cas calibration
  casN1Total: number | null; // portfolio-wide CAS (prior year), from P&L `orders`
  pipelinePondere: number | null;
  winRate: number | null;
  marginAvg: number | null; // not specified beyond BCG's per-BU marge — left null (see functions/index.js)
  supplierSaturation: number | null; // == porterForces.pouvoirFournisseurs
  recurrentShare: number | null; // prerequisite tag missing (DELTA_01 §3bis.F)
  kris: QuantiKri[];
  valueAtStake: QuantiValueAtStakeEntry[];
  updatedAt?: Timestamp | FieldValue;
}

/* ---------------------------------------------------------------------------------------------
 * summaries/quanti
 * ------------------------------------------------------------------------------------------- */

export function useQuantiSummary(): { data: QuantiSummary | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<QuantiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "summaries", "quanti"),
      (snap) => {
        setData(snap.exists() ? (snap.data() as QuantiSummary) : null);
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
