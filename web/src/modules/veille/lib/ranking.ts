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

/**
 * Multiplicateur d'alignement par focale × axe. `dg` = neutre (le DG voit la priorité globale telle
 * quelle). `strategie` favorise l'exécution commerciale/réglementaire/partenariale. `innovation`
 * remonte fortement la tech et la concurrence (contre-balance le tech=0.45 du barème serveur).
 * Un axe absent de la table vaut 1 (neutre).
 */
const LENS_AXIS_BOOST: Record<string, Partial<Record<IntelAxis, number>>> = {
  dg: {},
  strategie: { clients_prospects: 1.15, reglementaire: 1.15, partenaires: 1.1, concurrents: 1.05, tech: 0.8 },
  innovation: { tech: 1.5, concurrents: 1.2, clients_prospects: 1.0, reglementaire: 0.9, partenaires: 0.9 },
};

/** Score ajusté à la focale (pour le TRI uniquement) : priorityScore × multiplicateur d'axe du lens. */
export function lensAdjustedScore(item: Rankable, lens: string): number {
  const base = item.priorityScore ?? 0;
  const table = LENS_AXIS_BOOST[lens];
  const mult = table && item.axis ? table[item.axis] ?? 1 : 1;
  return base * mult;
}

/**
 * Copie triée par score ajusté à la focale (desc). Tri STABLE (départage par priorityScore brut puis
 * ordre d'origine) pour un rendu déterministe. Ne mute pas l'entrée.
 */
export function rankByLens<T extends Rankable>(items: readonly T[], lens: string): T[] {
  return items
    .map((it, i) => ({ it, i, s: lensAdjustedScore(it, lens) }))
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
