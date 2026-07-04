/**
 * Firestore data layer for the V2 "Saisie & Fil" phase (BUILD_KIT.md §6, §10, §11).
 *
 * Covers exactly the three collections in scope for V2: `intelItems`, `intelWatchlist`,
 * `intelSources`. Other collections (frameworks, initiatives, decisions, …) are out of scope
 * until later roadmap phases and are NOT touched here.
 *
 * Types mirror BUILD_KIT.md §6 field-for-field. IDs for `intelItems` are deterministic
 * (`hash(url|title+date)`, BUILD_KIT.md §10 "Idempotence") so re-ingestion/re-submission of the
 * same item never creates a duplicate document — writes use `setDoc(..., {merge:true})` against
 * that computed id instead of `addDoc`.
 */
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type FieldValue,
  type QueryConstraint,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";

/* ---------------------------------------------------------------------------------------------
 * Types (BUILD_KIT.md §6)
 * ------------------------------------------------------------------------------------------- */

export type IntelAxis = "partenaires" | "concurrents" | "clients_prospects" | "tech" | "reglementaire";
export type IntelImpact = "high" | "medium" | "low";
export type IntelStance = "opportunity" | "threat" | "neutral";
export type IntelStatus = "new" | "reviewed" | "actioned" | "archived";
export type IntelProx = "imminent" | "court" | "moyen" | "horizon";

export interface IntelItem {
  id: string;
  title: string;
  summary: string;
  url?: string;
  sourceName?: string;
  axis: IntelAxis;
  subtype?: string;
  cat?: string;
  ent?: string;
  geo?: string;
  date: string;
  impact: IntelImpact;
  stance: IntelStance;
  sourceRating: string; // A1..F5 (code de l'amirauté)
  confidence?: string;
  priorityScore?: number;
  soWhat?: string;
  recommendedAction?: string;
  owner?: string;
  dueDate?: string;
  budgetIdentified?: boolean;
  prox?: IntelProx;
  stale?: boolean; // échéance (dueDate) dépassée — item périmé, ne pas présenter comme imminent
  neuf?: boolean;
  linkedFp?: string;
  linkedSupplierId?: string;
  linkedClientId?: string;
  decisionId?: string;
  initiativeId?: string;
  status: IntelStatus;
  createdBy: string;
  createdAt?: Timestamp | FieldValue;
}

export type IntelItemInput = Omit<IntelItem, "id" | "createdBy" | "createdAt" | "status"> & {
  status?: IntelStatus;
};

export interface IntelWatchlistEntry {
  id: string;
  name: string;
  type: string;
  geo?: string;
  priority: "Haute" | "Moyenne" | "Basse" | string;
  linkedSupplierId?: string;
  linkedClientId?: string;
  active: boolean;
}

export type IntelWatchlistInput = Omit<IntelWatchlistEntry, "id">;

export type IntelSourceKind = "rss" | "web" | "web-js" | "newsletter" | "manual" | "portal";

export interface IntelSource {
  id: string;
  name: string;
  kind: IntelSourceKind;
  url?: string;
  axis?: IntelAxis;
  active: boolean;
  lastFetch?: Timestamp | FieldValue | null;
  /** Santé de la source (mise à jour par syncSources) : "ok", "degraded: …" ou "error: …". */
  lastStatus?: string;
  consecutiveFailures?: number;
  sourceRating?: string;
}

export type IntelSourceInput = Omit<IntelSource, "id" | "lastFetch">;

/* ---------------------------------------------------------------------------------------------
 * Detection-view derivation (Radar de détection)
 *
 * The Detection radar positions items by `cat` (ECAT key: marche/sectoriel/tech/regpays) and
 * `prox`, and its "Types d'événements" panel counts canonical French labels. The AI classifier
 * (functions/domain/classify.js) fills `axis` + snake_case `subtype` codes but historically not
 * `cat` — per the "100% données externes automatiques" decision, both are derived
 * deterministically here so every classified signal is plottable without human touch-up.
 * (classify.js now also persists `cat` for new items; this client-side fallback keeps older
 * items live too.)
 * ------------------------------------------------------------------------------------------- */

export const AXIS_TO_DETECTION_CAT: Record<IntelAxis, string> = {
  partenaires: "marche",
  concurrents: "marche",
  clients_prospects: "sectoriel",
  tech: "tech",
  reglementaire: "regpays",
};

/** Canonical Detection event-type labels for the snake_case subtype codes the AI classifier emits. */
export const DETECTION_SUBTYPE_LABELS: Record<string, string> = {
  product_launch: "Rupture / nouvelle techno",
  trend: "Rupture / nouvelle techno",
  eol: "Obsolescence / EOL",
  regulation: "Nouvelle réglementation",
  tender: "Opportunité sectorielle",
  funding: "Opportunité sectorielle",
  ma: "Expansion de groupe",
  expansion: "Expansion de groupe",
  market_entry: "Entrée d'un concurrent",
  implantation: "Nouvelle implantation",
  macro: "Risque pays",
  supply: "Risque sectoriel",
};

/** Fills `cat`/`prox` (and Frenchifies known subtype codes) so the item is plottable on the radar. */
export function withDetectionFields(item: IntelItem): IntelItem {
  return {
    ...item,
    cat: item.cat ?? AXIS_TO_DETECTION_CAT[item.axis],
    prox: item.prox ?? "moyen",
    subtype: item.subtype ? DETECTION_SUBTYPE_LABELS[item.subtype] ?? item.subtype : item.subtype,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Deterministic IDs (idempotent ingestion — BUILD_KIT.md §10)
 * ------------------------------------------------------------------------------------------- */

/**
 * Small dependency-free string hash (djb2 XOR variant), hex-encoded. Not cryptographic — just
 * needs to be deterministic and low-collision enough for idempotent Firestore doc IDs, which is
 * exactly the job here (`intelItems/{hash(url|title+date)}`).
 */
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // Force unsigned 32-bit, hex-encode, left-pad to 8 chars.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** `intelItems/{hash(url|title+date)}` per BUILD_KIT.md §10. */
export function intelItemId(input: { url?: string; title: string; date: string }): string {
  const basis = input.url && input.url.trim() ? input.url.trim() : `${input.title}|${input.date}`;
  return `item_${djb2Hex(basis)}`;
}

/* ---------------------------------------------------------------------------------------------
 * intelItems
 * ------------------------------------------------------------------------------------------- */

export interface IntelItemFilters {
  axis?: IntelAxis | "all";
  status?: IntelStatus | "all";
}

function intelItemsQueryConstraints(filters?: IntelItemFilters): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (filters?.axis && filters.axis !== "all") constraints.push(where("axis", "==", filters.axis));
  if (filters?.status && filters.status !== "all") constraints.push(where("status", "==", filters.status));
  constraints.push(orderBy("date", "desc"));
  return constraints;
}

/** Live (`onSnapshot`) list of `intelItems`, optionally filtered by axis/status. */
export function useIntelItems(filters?: IntelItemFilters): { items: IntelItem[]; loading: boolean; error: Error | null } {
  const [items, setItems] = useState<IntelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const axisKey = filters?.axis ?? "all";
  const statusKey = filters?.status ?? "all";

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "intelItems"), ...intelItemsQueryConstraints({ axis: axisKey, status: statusKey }));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<IntelItem, "id">) })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err as Error);
        setLoading(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axisKey, statusKey]);

  return { items, loading, error };
}

/** Creates (or idempotently re-merges) an `intelItems` doc. Requires an authenticated user. */
export async function createIntelItem(input: IntelItemInput): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("createIntelItem: no authenticated user");
  const id = intelItemId({ url: input.url, title: input.title, date: input.date });
  const data: Omit<IntelItem, "id"> = {
    ...input,
    status: input.status ?? "new",
    createdBy: uid,
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, "intelItems", id), data, { merge: true });
  return id;
}

export async function updateIntelItem(id: string, patch: Partial<IntelItem>): Promise<void> {
  await updateDoc(doc(db, "intelItems", id), patch as Record<string, unknown>);
}

/* ---------------------------------------------------------------------------------------------
 * intelWatchlist
 * ------------------------------------------------------------------------------------------- */

export function useWatchlist(): { entries: IntelWatchlistEntry[]; loading: boolean; error: Error | null } {
  const [entries, setEntries] = useState<IntelWatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "intelWatchlist"), orderBy("name", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<IntelWatchlistEntry, "id">) })));
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

export async function createWatchlistEntry(input: IntelWatchlistInput): Promise<string> {
  const ref = await addDoc(collection(db, "intelWatchlist"), input);
  return ref.id;
}

/* ---------------------------------------------------------------------------------------------
 * intelSources
 * ------------------------------------------------------------------------------------------- */

export function useSources(): { sources: IntelSource[]; loading: boolean; error: Error | null } {
  const [sources, setSources] = useState<IntelSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "intelSources"), orderBy("name", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSources(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<IntelSource, "id">) })));
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

  return { sources, loading, error };
}

export async function createSource(input: IntelSourceInput): Promise<string> {
  const ref = await addDoc(collection(db, "intelSources"), { ...input, lastFetch: null });
  return ref.id;
}

/* ---------------------------------------------------------------------------------------------
 * bizOpportunities (pipeline d'opportunités business détectées par l'IA — plan d'audit §6.1/§6.2)
 *
 * Documents written by the backend opportunity detector (functions enrichment, statut `new`
 * forcé) ; the web app only reads them and lets exec roles qualify/drop (`updateBizOpportunity`).
 * ------------------------------------------------------------------------------------------- */

export type BizOpportunityHorizon = "imminent" | "court" | "moyen" | "horizon";
export type BizOpportunityProbability = "high" | "medium" | "low";
export type BizOpportunityStatus = "new" | "qualified" | "dropped";

export interface BizOpportunity {
  id: string;
  name: string;
  client: string;
  bu: "ICT" | "FORMATION";
  offering: string;
  estAmount?: string | null; // montant extrait du texte source (string, jamais recalculé côté client)
  deadline?: string | null;
  horizon: BizOpportunityHorizon;
  probability: BizOpportunityProbability;
  nextAction: string;
  sourceSignals?: number[];
  competitorsLikely?: string[];
  status: BizOpportunityStatus;
  generatedBy?: string;
  // Chaîne de captation (M12 audit) : une opportunité qualifiée devient un lead avec porteur et
  // échéance de prochaine action, et peut être convertie en action liée (actionId).
  owner?: string;
  nextActionDate?: string;
  actionId?: string; // id de l'action créée lors de la conversion (traçabilité opportunité→action)
}

const HORIZON_ORDER: Record<BizOpportunityHorizon, number> = { imminent: 0, court: 1, moyen: 2, horizon: 3 };
const PROBABILITY_ORDER: Record<BizOpportunityProbability, number> = { high: 0, medium: 1, low: 2 };

/** Live (`onSnapshot`) list of `bizOpportunities`, sorted client-side (horizon puis probabilité puis nom). */
export function useBizOpportunities(): { opportunities: BizOpportunity[]; loading: boolean; error: Error | null } {
  const [opportunities, setOpportunities] = useState<BizOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collection(db, "bizOpportunities"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BizOpportunity, "id">) }));
        docs.sort(
          (a, b) =>
            (HORIZON_ORDER[a.horizon] ?? 9) - (HORIZON_ORDER[b.horizon] ?? 9) ||
            (PROBABILITY_ORDER[a.probability] ?? 9) - (PROBABILITY_ORDER[b.probability] ?? 9) ||
            (a.name ?? "").localeCompare(b.name ?? "")
        );
        setOpportunities(docs);
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

  return { opportunities, loading, error };
}

export async function updateBizOpportunity(id: string, patch: Partial<BizOpportunity>): Promise<void> {
  await updateDoc(doc(db, "bizOpportunities", id), patch as Record<string, unknown>);
}
