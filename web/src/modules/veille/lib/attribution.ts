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
import type { StrategicAction } from "./execution";

/** Sources d'opportunité proactives (émises par la boucle, pas saisies à la main). */
export const PROACTIVE_SOURCES = new Set(["cross-sell", "upsell", "managed", "relance"]);

/** Une opportunité est attribuable à la boucle si elle porte un déclencheur de veille OU une source proactive. */
export function isVeilleAttributed(o: Pick<BizOpportunity, "triggerEvent" | "source">): boolean {
  return Boolean(o.triggerEvent) || (typeof o.source === "string" && PROACTIVE_SOURCES.has(o.source));
}

/** Parse un montant estimé (string, jamais recalculé) en nombre sûr (0 si illisible). */
function amount(estAmount?: string | null): number {
  if (!estAmount) return 0;
  const n = Number(String(estAmount).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface VeilleAttribution {
  attribuables: number;       // opportunités attribuables (hors écartées)
  pipelineXof: number;        // Σ des montants estimés attribuables
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
  const wonById = new Map<string, boolean>();
  for (const a of Array.isArray(actions) ? actions : []) {
    if (a && a.id) wonById.set(a.id, a.statut === "Gagné");
  }

  const bySource = new Map<string, { count: number; xof: number }>();
  const out: VeilleAttribution = {
    attribuables: 0, pipelineXof: 0, declenchees: 0, declencheesXof: 0,
    parSource: [], qualifiees: 0, converties: 0, gagnees: 0, gagneesXof: 0,
  };

  for (const o of Array.isArray(opportunities) ? opportunities : []) {
    if (!o || o.status === "dropped" || !isVeilleAttributed(o)) continue;
    const xof = amount(o.estAmount);
    out.attribuables += 1;
    out.pipelineXof += xof;
    if (o.triggerEvent) { out.declenchees += 1; out.declencheesXof += xof; }
    const src = o.source || "autre";
    const bucket = bySource.get(src) ?? { count: 0, xof: 0 };
    bucket.count += 1; bucket.xof += xof; bySource.set(src, bucket);
    if (o.status === "qualified") out.qualifiees += 1;
    if (o.actionId) {
      out.converties += 1;
      if (wonById.get(o.actionId)) { out.gagnees += 1; out.gagneesXof += xof; }
    }
  }
  out.parSource = [...bySource.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.xof - a.xof);
  return out;
}
