/**
 * Attribution de la valeur — mesurer le CA que la BOUCLE VEILLE → ACTION fait entrer dans le pipeline
 * commercial. C'est la preuve de ROI de l'intégration veille ↔ vente (direction « intégrée ») : sans
 * cette mesure, l'apport de la veille reste une conviction, pas un chiffre défendable devant la DG.
 *
 * Pur : dérivé des opportunités (`bizOpportunities`) et des actions (`actions`) déjà en base. Aucune
 * hypothèse — on n'attribue QUE ce qui porte une trace explicite : un déclencheur de veille
 * (`triggerEvent`) ou une origine proactive dérivée du portefeuille (`source`).
 */
import type { BizOpportunity } from "./intel";
import { ACTION_TERMINAL, type StrategicAction } from "./execution";

/** Sources d'opportunité proactives (émises par la boucle, pas saisies à la main). */
export const PROACTIVE_SOURCES = new Set(["cross-sell", "upsell", "managed", "relance"]);

/** Une opportunité est attribuable à la boucle si elle porte un déclencheur de veille OU une source proactive. */
export function isVeilleAttributed(o: Pick<BizOpportunity, "triggerEvent" | "source">): boolean {
  return Boolean(o.triggerEvent) || (typeof o.source === "string" && PROACTIVE_SOURCES.has(o.source));
}

/**
 * Parse un montant estimé saisi librement en un nombre sûr (0 si illisible). Robuste aux formats
 * réels du marché (audit pertinence 2026-07) : espaces & points de milliers, virgule décimale,
 * suffixes k / M / Md. Ex. « 1 500 000 FCFA »→1500000, « 1,5M »→1500000, « 12.500.000 »→12500000,
 * « 1 500 000,50 »→1500001. Le montant reste une SAISIE (jamais recalculé), on ne fait que le lire.
 */
export function amount(estAmount?: string | null): number {
  if (!estAmount) return 0;
  const raw = String(estAmount).trim().toLowerCase();
  const m = raw.match(/([0-9][0-9.,\s\u00a0\u202f]*)\s*(md|mrd|milliards?|m|millions?|k|mille)?/i);
  if (!m) return 0;
  let numStr = m[1].replace(/[\s\u00a0\u202f]/g, ""); // retire espaces (dont insécables)
  if (numStr.includes(",") && numStr.includes(".")) {
    numStr = numStr.replace(/\./g, "").replace(",", "."); // point = milliers, virgule = décimale
  } else if (numStr.includes(",")) {
    numStr = numStr.replace(",", "."); // virgule décimale (français)
  } else if ((numStr.match(/\./g) || []).length > 1) {
    numStr = numStr.replace(/\./g, ""); // points de milliers multiples
  }
  let n = Number(numStr);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || "").toLowerCase();
  if (/^(md|mrd|milliard)/.test(unit)) n *= 1e9;
  else if (/^(m|million)/.test(unit)) n *= 1e6;
  else if (/^(k|mille)/.test(unit)) n *= 1e3;
  return n > 0 ? Math.round(n) : 0;
}

export interface VeilleAttribution {
  attribuables: number;       // opportunités attribuables (hors écartées)
  pipelineXof: number;        // Σ des montants du pipeline OUVERT attribuable (exclut gagné/perdu/terminé)
  declenchees: number;        // dont déclenchées par un événement de veille (triggerEvent)
  declencheesXof: number;
  parSource: { source: string; count: number; xof: number }[];
  qualifiees: number;         // statut « qualifiée » (revue humaine positive)
  converties: number;         // converties en action suivie (actionId présent)
  gagnees: number;            // action liée au statut terminal « Gagné »
  gagneesXof: number;
}

/**
 * computeVeilleAttribution(opportunities, actions) -> VeilleAttribution.
 * Joint chaque opportunité attribuable à son action (via `actionId`) pour tracer le funnel
 * signal → qualification → conversion → gain. Ne compte JAMAIS une opportunité écartée (`dropped`).
 */
export function computeVeilleAttribution(
  opportunities: BizOpportunity[],
  actions: StrategicAction[]
): VeilleAttribution {
  const statutById = new Map<string, string>();
  for (const a of Array.isArray(actions) ? actions : []) {
    if (a && a.id) statutById.set(a.id, a.statut);
  }

  const bySource = new Map<string, { count: number; xof: number }>();
  const out: VeilleAttribution = {
    attribuables: 0, pipelineXof: 0, declenchees: 0, declencheesXof: 0,
    parSource: [], qualifiees: 0, converties: 0, gagnees: 0, gagneesXof: 0,
  };

  for (const o of Array.isArray(opportunities) ? opportunities : []) {
    if (!o || o.status === "dropped" || !isVeilleAttributed(o)) continue;
    const xof = amount(o.estAmount);
    // Statut de l'action liée : une opportunité rattachée à une action TERMINALE (Gagné/Abandonné/
    // Terminé) est RÉALISÉE ou perdue — elle ne fait plus partie du pipeline OUVERT (audit pertinence
    // 2026-07 : pipelineXof mélangeait ouvert, gagné et perdu, gonflant le « pipeline »).
    const linkedStatut = o.actionId ? statutById.get(o.actionId) : undefined;
    const isTerminal = !!linkedStatut && ACTION_TERMINAL.has(linkedStatut);
    const isWon = linkedStatut === "Gagné";
    out.attribuables += 1;
    if (!isTerminal) out.pipelineXof += xof; // pipeline OUVERT seulement
    if (o.triggerEvent) { out.declenchees += 1; if (!isTerminal) out.declencheesXof += xof; }
    const src = o.source || "autre";
    const bucket = bySource.get(src) ?? { count: 0, xof: 0 };
    bucket.count += 1; if (!isTerminal) bucket.xof += xof; bySource.set(src, bucket);
    if (o.status === "qualified") out.qualifiees += 1;
    if (o.actionId) {
      out.converties += 1;
      if (isWon) { out.gagnees += 1; out.gagneesXof += xof; }
    }
  }
  out.parSource = [...bySource.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.xof - a.xof);
  return out;
}
