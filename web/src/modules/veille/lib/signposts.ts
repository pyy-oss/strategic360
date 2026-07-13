/**
 * signposts.ts — SIGNPOST-MONITORING ACTIF (levier « waouh » n°6). Confronte les « signes
 * précurseurs » d'un scénario (texte libre) aux signaux de veille RÉELS déjà captés : au lieu d'une
 * liste inerte « à guetter », l'exécutif voit « rupture en approche : 2/3 signes déjà déclenchés »
 * avec le signal-preuve cliquable. PUR (aucune I/O).
 */
import type { IntelItem } from "./intel";

const STOP = new Set([
  "de", "la", "le", "les", "des", "du", "et", "en", "un", "une", "pour", "sur", "au", "aux", "dans",
  "the", "of", "a", "to", "in", "and", "with", "on", "for", "par", "plus", "vers", "une", "que", "qui",
  "est", "sont", "se", "ce", "cette", "ces", "son", "ses", "leur", "leurs", "avec", "sans",
]);

function tokens(s: string): Set<string> {
  return new Set(
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
  );
}

export interface SignpostMatch {
  text: string;
  triggered: boolean;
  items: IntelItem[]; // signaux qui corroborent ce signe précurseur
}

/**
 * matchSignposts(signposts, items, opts) → un statut par signe précurseur. Un signe est
 * « déclenché » si un signal partage assez de jetons significatifs avec lui (défaut ≥ 2). PUR.
 */
export function matchSignposts(
  signposts: string[],
  items: IntelItem[],
  opts?: { minShared?: number; maxItems?: number }
): SignpostMatch[] {
  const minShared = opts?.minShared ?? 2;
  const maxItems = opts?.maxItems ?? 3;
  const indexed = (Array.isArray(items) ? items : []).map((it) => ({
    it,
    toks: tokens(`${it.title || ""} ${it.soWhat || ""} ${it.summary || ""} ${it.ent || ""}`),
  }));
  return (Array.isArray(signposts) ? signposts : []).map((sp) => {
    const spToks = tokens(sp);
    const matches: { it: IntelItem; overlap: number }[] = [];
    for (const { it, toks } of indexed) {
      let overlap = 0;
      for (const t of spToks) if (toks.has(t)) overlap += 1;
      if (overlap >= minShared) matches.push({ it, overlap });
    }
    matches.sort((a, b) => b.overlap - a.overlap || (b.it.priorityScore ?? 0) - (a.it.priorityScore ?? 0));
    return { text: sp, triggered: matches.length > 0, items: matches.slice(0, maxItems).map((m) => m.it) };
  });
}

/** Nombre de signes déclenchés sur le total (pour le compteur « 2/3 »). */
export function triggeredCount(matches: SignpostMatch[]): { n: number; total: number } {
  return { n: matches.filter((m) => m.triggered).length, total: matches.length };
}
