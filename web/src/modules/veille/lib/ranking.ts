import type { IntelAxis } from "./intel";

/**
 * Classement PERSONNALISÉ + DIVERSITÉ (audit pertinence 2026-07). Le `priorityScore` stocké est
 * GLOBAL (barème serveur scoring.js) : il ne dépend ni de la focale (lens) que regarde le lecteur,
 * ni de l'entité. Deux manques en découlaient :
 *  - la focale « innovation » enterrait justement les signaux tech (AXIS_ALIGN tech=0.45 côté score),
 *    alors qu'elle est censée les mettre en avant ; seul le texte d'intro changeait.
 *  - un même compte cité par 3-4 signaux remplissait tout le top-N et évinçait la diversité.
 *
 * Ce module RE-CLASSE au rendu (jamais persisté) : un multiplicateur d'axe par lens ajuste le score
 * pour le TRI, et une passe de diversité (MMR-lite) plafonne le nombre d'items par entité dans le
 * top-N. Fonctions PURES (aucun accès Firestore/réseau) — le score serveur reste l'autorité.
 */

/** Item minimal requis pour le classement (sous-ensemble d'IntelItem). */
export interface Rankable {
  axis?: IntelAxis;
  ent?: string;
  priorityScore?: number;
}

/** Type de la table de pondérations rôle-focale × axe. */
export type LensWeights = Record<string, Partial<Record<IntelAxis, number>>>;

/**
 * Multiplicateur d'alignement par focale × axe — DÉFAUT calibré pour une ESN/SS2I en Côte d'Ivoire /
 * UEMOA (audit pondérations 2026-07). Rationale ESN :
 *  - `dg` : léger tilt business/risque-marché (le board pilote pipeline + accès marché), sans écraser.
 *  - `strategie` : accès marché (AO publics/UEMOA, bancaire, télécom, gouvernemental), réglementaire
 *    (ANSSI-CI/PASSI, localisation données, ARTCI), et CONCURRENCE remontée (marché concentré : GTN,
 *    CBI, CIS, Inovatec… se disputent les mêmes AO). Tech dévalué (altitude stratégique).
 *  - `innovation` : la tech en tête, mais aussi les PARTENAIRES (chez une ESN l'innovation arrive par
 *    l'écosystème vendeur : un lancement Microsoft/Fortinet/Google Cloud = une nouvelle offre) et le
 *    réglementaire NEUTRE-HAUT (la réglementation CRÉE la demande : cloud souverain, cybersécurité).
 * Un axe absent d'une focale vaut 1 (neutre). Éditable par la Direction (config/lensWeights).
 */
export const DEFAULT_LENS_AXIS_BOOST: LensWeights = {
  dg: { clients_prospects: 1.1, reglementaire: 1.1, partenaires: 1.05, concurrents: 1.05, tech: 0.9 },
  strategie: { clients_prospects: 1.15, reglementaire: 1.15, concurrents: 1.2, partenaires: 1.1, tech: 0.8 },
  innovation: { tech: 1.5, partenaires: 1.2, concurrents: 1.2, reglementaire: 1.05, clients_prospects: 1.0 },
};

/**
 * Score ajusté à la focale (pour le TRI uniquement) : priorityScore × multiplicateur d'axe du lens.
 * `weights` permet de surcharger la table par défaut (pondérations éditées par la Direction, live).
 */
export function lensAdjustedScore(item: Rankable, lens: string, weights: LensWeights = DEFAULT_LENS_AXIS_BOOST): number {
  const base = item.priorityScore ?? 0;
  const table = weights[lens];
  const mult = table && item.axis ? table[item.axis] ?? 1 : 1;
  return base * mult;
}

/**
 * Copie triée par score ajusté à la focale (desc). Tri STABLE (départage par priorityScore brut puis
 * ordre d'origine) pour un rendu déterministe. Ne mute pas l'entrée.
 */
export function rankByLens<T extends Rankable>(items: readonly T[], lens: string, weights: LensWeights = DEFAULT_LENS_AXIS_BOOST): T[] {
  return items
    .map((it, i) => ({ it, i, s: lensAdjustedScore(it, lens, weights) }))
    .sort((a, b) => b.s - a.s || (b.it.priorityScore ?? 0) - (a.it.priorityScore ?? 0) || a.i - b.i)
    .map((x) => x.it);
}

/**
 * Diversité du top-N (MMR-lite) : parcourt la liste DÉJÀ classée et plafonne le nombre d'items
 * partageant la même clé (par défaut l'entité `ent`) à `maxPerKey`, pour qu'un seul compte/entité
 * ne monopolise pas le top. Complète jusqu'à `n` avec les items mis de côté si besoin (on ne renvoie
 * jamais moins d'items que possible). Les items sans clé ne sont jamais plafonnés. Ne mute pas l'entrée.
 */
export function diversifyTopN<T>(
  items: readonly T[],
  n: number,
  keyFn: (it: T) => string | undefined,
  maxPerKey = 2
): T[] {
  const picked: T[] = [];
  const overflow: T[] = [];
  const counts = new Map<string, number>();
  for (const it of items) {
    if (picked.length >= n) break;
    const key = keyFn(it);
    if (!key) { picked.push(it); continue; } // sans clé → jamais plafonné
    const c = counts.get(key) ?? 0;
    if (c < maxPerKey) { picked.push(it); counts.set(key, c + 1); }
    else overflow.push(it);
  }
  // Complète avec les items écartés par le plafond (l'ordre de classement d'origine est préservé).
  for (const it of overflow) {
    if (picked.length >= n) break;
    picked.push(it);
  }
  return picked;
}
