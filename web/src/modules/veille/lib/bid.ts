/**
 * Bid management — grille GO/NO-GO pondérée + décisions tracées (audit 10/10 2026-07).
 *
 * Chez toute ESN structurée, aucun AO au-dessus d'un seuil ne part sans grille de décision :
 * accès client (sponsor), capacité à staffer, position concurrentielle, marge attendue, alignement
 * offre. Ici le bouton « Go » existait sans critères — le jour où deux AO arrivent avec une équipe
 * avant-vente saturée, rien ne disait lequel lâcher, et aucune décision n'était TRACÉE (donc pas de
 * taux de transformation ni de post-mortem). Ce module fournit : la grille (poids ajustables en un
 * seul endroit), le calcul du score pondéré /100 avec recommandation, la persistance des décisions
 * (`bidDecisions`, une par AO — la re-décision remplace) et le hook de lecture temps réel.
 */
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc, serverTimestamp, type Timestamp, type FieldValue } from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";

/** Critères de la grille — libellés métier ESN, poids en % (somme = 100). */
export const BID_CRITERIA = [
  { key: "sponsor", label: "Accès client / sponsor identifié", weight: 25, hint: "Connaît-on l'acheteur ? A-t-on un sponsor interne ?" },
  { key: "staffing", label: "Capacité à staffer dans les délais", weight: 20, hint: "Équipe avant-vente + delivery disponibles pour l'échéance ?" },
  { key: "concurrence", label: "Position concurrentielle", weight: 20, hint: "Concurrent installé chez l'acheteur ? Nos références pèsent-elles ?" },
  { key: "marge", label: "Marge attendue", weight: 20, hint: "Mix produit/service — un AO 100 % matériel à 8 % ne vaut pas un managé récurrent." },
  { key: "alignement", label: "Alignement offre / références", weight: 15, hint: "Cœur de métier ? Références similaires démontrables ?" },
] as const;

export type BidCriterionKey = (typeof BID_CRITERIA)[number]["key"];
export type BidScores = Record<BidCriterionKey, number>; // 0..5 par critère

/** Score pondéré 0-100 depuis les notes 0-5. PUR. */
export function computeBidScore(scores: Partial<BidScores>): number {
  let total = 0;
  for (const c of BID_CRITERIA) {
    const v = Math.max(0, Math.min(5, Number(scores[c.key]) || 0));
    total += (v / 5) * c.weight;
  }
  return Math.round(total);
}

/** Recommandation issue du score — le décideur reste libre, la grille éclaire. */
export function bidRecommendation(score: number): { verdict: "go" | "comite" | "nogo"; label: string } {
  if (score >= 60) return { verdict: "go", label: "GO recommandé" };
  if (score >= 40) return { verdict: "comite", label: "À arbitrer en comité" };
  return { verdict: "nogo", label: "NO-GO recommandé" };
}

export interface BidDecision {
  id: string;
  itemId: string;
  title: string;
  decision: "go" | "nogo";
  scores: Partial<BidScores>;
  score: number; // pondéré /100 au moment de la décision
  note?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: Timestamp | FieldValue;
}

/** Persiste la décision (une par AO — doc id = itemId, la re-décision remplace, createdBy = décideur). */
export async function saveBidDecision(input: Omit<BidDecision, "id" | "createdBy" | "createdAt">): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error("Non authentifié.");
  await setDoc(doc(db, "bidDecisions", input.itemId), {
    ...input,
    createdBy: u.uid,
    createdByName: u.displayName || u.email || "",
    createdAt: serverTimestamp(),
  });
}

/** Décisions live, indexées par itemId (affichage sur la ligne AO + taux de transformation). */
export function useBidDecisions(): { byItem: Map<string, BidDecision>; goCount: number; nogoCount: number } {
  const [byItem, setByItem] = useState<Map<string, BidDecision>>(new Map());
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "bidDecisions"), (snap) => {
      const m = new Map<string, BidDecision>();
      snap.docs.forEach((d) => { const v = { id: d.id, ...(d.data() as Omit<BidDecision, "id">) }; m.set(v.itemId, v); });
      setByItem(m);
    }, () => { /* droits insuffisants : la vue AO reste utilisable sans les décisions */ });
    return unsub;
  }, []);
  let goCount = 0, nogoCount = 0;
  byItem.forEach((d) => { if (d.decision === "go") goCount += 1; else nogoCount += 1; });
  return { byItem, goCount, nogoCount };
}
