import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase";

/**
 * Surveillance active des APPELS D'OFFRES de nos clients (config/clientTenderMonitors).
 * Sélection auto par valeur/tier (côté backend) + ajustement manuel (include/exclude/max) via le
 * callable `setClientTenderMonitors` (Direction). Lecture réservée aux exécutifs (config/{d}).
 */
export interface ClientTenderMonitorConfig {
  enabled: boolean;
  auto: boolean;
  max: number;
  include: string[];
  exclude: string[];
}

const DEFAULTS: ClientTenderMonitorConfig = { enabled: true, auto: true, max: 40, include: [], exclude: [] };

export function useClientTenderMonitors(): { config: ClientTenderMonitorConfig; loading: boolean } {
  const [config, setConfig] = useState<ClientTenderMonitorConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config/clientTenderMonitors"),
      (snap) => {
        const d = snap.exists() ? (snap.data() || {}) : {};
        setConfig({
          enabled: d.enabled !== false,
          auto: d.auto !== false,
          max: Number.isFinite(d.max) ? Number(d.max) : DEFAULTS.max,
          include: Array.isArray(d.include) ? d.include : [],
          exclude: Array.isArray(d.exclude) ? d.exclude : [],
        });
        setLoading(false);
      },
      () => { setConfig(DEFAULTS); setLoading(false); }
    );
    return () => unsub();
  }, []);
  return { config, loading };
}

/** Enregistre la config de surveillance AO clients (callable exec). */
export async function setClientTenderMonitors(patch: Partial<ClientTenderMonitorConfig>): Promise<void> {
  const call = httpsCallable<Partial<ClientTenderMonitorConfig>, { ok: boolean }>(functions, "setClientTenderMonitors");
  await call(patch);
}
