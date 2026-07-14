/**
 * Data layer — Onboarding auto (Phase 1 « produit agnostique », P5).
 *
 * Wrappe les deux callables serveur : `onboardCompany` (crawl + IA → brouillon config/onboardingDraft)
 * et `applyOnboardingDraft` (brouillon → docs config/* + amorçage). Plus un hook onSnapshot sur
 * `config/onboardingDraft` pour ré-afficher le dernier brouillon. Mêmes conventions que lib/copilote.ts
 * (httpsCallable + HEAVY_CALL, onSnapshot). Tout est exec-gated côté serveur.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot, type FieldValue, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../lib/firebase";

// Le crawl + 3 appels IA + validation des sources peuvent durer > 60 s : timeout aligné sur le serveur.
const HEAVY_CALL = { timeout: 540_000 } as const;

/* --------------------------------------------------------------------------------------------- */

export type EntityType = "concurrent" | "client" | "partenaire" | "regulateur" | "editeur";
export type SourceKind = "rss" | "web" | "web-js" | "newsletter" | "portal";

export interface OnboardingProfile {
  companyName: string;
  legalName?: string | null;
  sector?: string;
  geographies?: string[];
  currency?: string | null;
  homonyms?: string[];
  differentiators?: string;
  regulators?: string[];
}
export interface OnboardingEntity { name: string; type: EntityType; geo?: string | null; note?: string }
export interface OnboardingAxis { key: string; label?: string; alignWeight?: number; guetGuidance?: string }
export interface OnboardingCandidateSource {
  name: string; url: string; kind: SourceKind; axis?: string;
  valid?: boolean | null; itemCount?: number; validationReason?: string;
}
export interface OnboardingDraft {
  status?: "draft" | "applied" | string;
  sourceUrl?: string;
  hints?: { name?: string; sector?: string };
  profile: OnboardingProfile;
  contextText?: string;
  ecosystem?: { entities?: OnboardingEntity[]; axes?: OnboardingAxis[]; subtypes?: string[] };
  plan?: {
    axes?: OnboardingAxis[]; classifierGuidance?: string; homonymyRule?: string;
    keywords?: string[]; candidateSources?: OnboardingCandidateSource[];
    // Mapping type d'événement de veille → mots-clés des offres du client (boucle veille → cross-sell),
    // dérivé par l'IA depuis le site. Écrit dans config/offerMapping à l'application.
    offerMarkers?: Record<string, string[]>;
  };
  stats?: { siteTextLength?: number; entities?: number; axes?: number; candidateSources?: number; validSources?: number };
  createdBy?: string | null;
  createdAt?: Timestamp | FieldValue | null;
  appliedAt?: Timestamp | FieldValue | null;
  appliedBy?: string | null;
}

export interface OnboardCompanyInput {
  url: string;
  docsText?: string;
  hints?: { name?: string; sector?: string };
  maxPages?: number;
  validateSources?: boolean;
}

export interface ApplyOnboardingInput {
  draft?: OnboardingDraft;
  seedSources?: boolean;
  seedWatchlist?: boolean;
  activateSources?: boolean;
}
export interface ApplyOnboardingResult {
  ok: boolean; companyName: string; axes: number; subtypes: number;
  sourcesWritten: number; watchlistWritten: number; sourcesActive: boolean;
}

/** Lance le crawl + l'analyse IA d'un site → écrit le brouillon config/onboardingDraft et le renvoie. */
export async function onboardCompany(input: OnboardCompanyInput): Promise<OnboardingDraft> {
  const call = httpsCallable<OnboardCompanyInput, OnboardingDraft>(functions, "onboardCompany", HEAVY_CALL);
  const { data } = await call(input);
  return data;
}

/** Applique le brouillon (éventuellement édité) → docs config/* de production + graines de veille. */
export async function applyOnboardingDraft(input: ApplyOnboardingInput): Promise<ApplyOnboardingResult> {
  const call = httpsCallable<ApplyOnboardingInput, ApplyOnboardingResult>(functions, "applyOnboardingDraft", HEAVY_CALL);
  const { data } = await call(input);
  return data;
}

/** Dernier brouillon d'onboarding (config/onboardingDraft) — pour ré-afficher/reprendre une revue. */
export function useOnboardingDraft(): { data: OnboardingDraft | null; loading: boolean } {
  const [data, setData] = useState<OnboardingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "onboardingDraft"),
      (snap) => { setData(snap.exists() ? (snap.data() as OnboardingDraft) : null); setLoading(false); },
      () => { setData(null); setLoading(false); }
    );
    return unsub;
  }, []);
  return { data, loading };
}
