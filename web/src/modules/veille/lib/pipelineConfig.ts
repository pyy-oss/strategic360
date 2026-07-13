/**
 * pipelineConfig.ts — CADENCE des pipelines planifiés (maîtrise des coûts Vertex/Cloud Run),
 * réglable EN DIRECT par les exécutifs sans redéploiement. Lit `config/runtime` (lecture exec-only
 * via les règles) et écrit via le callable `setPipelineConfig` (l'écriture directe de config/* est
 * interdite côté client — seul le callable, exec-gated, la fait).
 *
 * Chaque cron coûteux consulte cette config avant tout appel Vertex : intervalle 0 = cadence native,
 * > 0 = espacement minimum (minutes) entre deux runs automatiques ; `paused` suspend tout.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot, type FieldValue, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase";

/** Pipelines pilotables (doit matcher PIPELINE_KEYS côté functions). */
export const PIPELINE_KEYS = ["sync", "evaluate", "aggregate", "enrich", "briefing"] as const;
export type PipelineKey = (typeof PIPELINE_KEYS)[number];

export const PIPELINE_LABEL: Record<PipelineKey, { titre: string; desc: string; natif: string }> = {
  sync: { titre: "Synchronisation des sources", desc: "Capte les nouveaux articles + classification IA", natif: "quotidien 06:00" },
  evaluate: { titre: "Évaluation des signaux", desc: "Juge de pertinence IA (publie/écarte) — 1er poste de coût", natif: "toutes les heures" },
  aggregate: { titre: "Agrégat cockpit exécutif", desc: "Recalcul KPIs (aussi rafraîchi à chaque écriture)", natif: "toutes les heures" },
  enrich: { titre: "Enrichissement stratégique", desc: "Cadres IA (SWOT, PESTEL, Porter, scénarios…)", natif: "hebdomadaire lundi 05:00" },
  briefing: { titre: "Briefing hebdomadaire", desc: "Note de synthèse IA", natif: "hebdomadaire vendredi 07:00" },
};

export type PipelineIntervals = Partial<Record<PipelineKey, number>>;

export interface PipelineRuntimeConfig {
  paused?: boolean;
  intervals?: PipelineIntervals;
  lastRun?: Partial<Record<PipelineKey, Timestamp | FieldValue>>;
  updatedBy?: string;
  updatedAt?: Timestamp | FieldValue;
}

/** Config de cadence en direct (config/runtime). Lisible par les exécutifs uniquement (règles). */
export function usePipelineConfig(): { config: PipelineRuntimeConfig | null; loading: boolean } {
  const [config, setConfig] = useState<PipelineRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "runtime"),
      (snap) => { setConfig(snap.exists() ? (snap.data() as PipelineRuntimeConfig) : {}); setLoading(false); },
      () => { setConfig(null); setLoading(false); }
    );
    return unsub;
  }, []);
  return { config, loading };
}

export interface SetPipelineConfigInput { paused?: boolean; intervals?: PipelineIntervals }

/** Règle la cadence (callable exec `setPipelineConfig`). */
export async function setPipelineConfig(input: SetPipelineConfigInput): Promise<void> {
  const call = httpsCallable<SetPipelineConfigInput, { ok: boolean }>(functions, "setPipelineConfig");
  await call(input);
}
