import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase";
import { DEFAULT_LENS_AXIS_BOOST, type LensWeights } from "./ranking";

/**
 * Pondérations de focale (rôle-focale × axe) ÉDITABLES par la Direction, persistées dans
 * `config/lensWeights` (lisible par tout authentifié, écrite via le callable `setLensWeights`).
 * `useLensWeights` renvoie la table stockée fusionnée sur le défaut ESN (DEFAULT_LENS_AXIS_BOOST) :
 * une focale/axe non redéfini garde sa valeur par défaut. Tant qu'aucune table n'est en base, on
 * sert le défaut — le sélecteur de focale marche sans configuration préalable.
 */
export function useLensWeights(): { weights: LensWeights; loading: boolean } {
  const [stored, setStored] = useState<LensWeights | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config/lensWeights"),
      (snap) => {
        const data = snap.exists() ? (snap.data()?.weights as LensWeights | undefined) : undefined;
        setStored(data && typeof data === "object" ? data : null);
        setLoading(false);
      },
      () => { setStored(null); setLoading(false); } // lecture refusée / hors-ligne → défaut
    );
    return () => unsub();
  }, []);
  return { weights: mergeWeights(stored), loading };
}

/** Fusionne les pondérations stockées sur le défaut (par focale puis par axe). */
export function mergeWeights(stored: LensWeights | null | undefined): LensWeights {
  if (!stored) return DEFAULT_LENS_AXIS_BOOST;
  const out: LensWeights = {};
  for (const lens of Object.keys(DEFAULT_LENS_AXIS_BOOST)) {
    out[lens] = { ...DEFAULT_LENS_AXIS_BOOST[lens], ...(stored[lens] || {}) };
  }
  return out;
}

/** Enregistre la table de pondérations (callable `setLensWeights`, Direction uniquement). */
export async function setLensWeights(weights: LensWeights): Promise<void> {
  const call = httpsCallable<{ weights: LensWeights }, { ok: boolean }>(functions, "setLensWeights");
  await call({ weights });
}
