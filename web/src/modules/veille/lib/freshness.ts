/**
 * Anti-obsolescence (2026-07) — dérive la fraîcheur d'un signal de veille de ses VRAIES dates
 * (`dueDate` / `date`), afin de ne jamais présenter un événement passé comme « imminent ». Ces
 * helpers sont purs et servent de filet de sécurité au rendu : même si un item classé avant ce
 * correctif porte encore un `prox:"imminent"` obsolète, l'UI le neutralise en le comparant à la
 * date du jour. Le serveur (classify.js) marque déjà les items à échéance dépassée `stale:true`.
 */
import type { IntelProx } from "./intel";

const DAY_MS = 24 * 60 * 60 * 1000;

type Datable = { prox?: IntelProx; dueDate?: string; date?: string; stale?: boolean };

/** Échéance (`dueDate`) dépassée ? — ou item explicitement marqué `stale` par le serveur. */
export function isPastDue(item: Datable | undefined, now: number = Date.now()): boolean {
  if (!item) return false;
  if (item.stale) return true;
  if (!item.dueDate) return false;
  const t = Date.parse(item.dueDate);
  return !Number.isNaN(t) && t < now;
}

/** Âge de publication en jours (≥ 0), ou null si `date` absente/illisible. */
export function ageInDays(dateStr: string | undefined, now: number = Date.now()): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.max((now - t) / DAY_MS, 0);
}

/** Périmé = échéance dépassée, OU publication ancienne (> 180 j) sans échéance future. */
export function isStale(item: Datable | undefined, now: number = Date.now()): boolean {
  if (isPastDue(item, now)) return true;
  const age = ageInDays(item?.date, now);
  return age !== null && age > 180 && !item?.dueDate;
}

/** Imminence effective : neutralise un label IA « imminent/court » si l'item est périmé. */
export function effectiveProx(item: Datable | undefined, now: number = Date.now()): IntelProx | undefined {
  if (isStale(item, now)) return "horizon";
  return item?.prox;
}

/** Libellé court pour un badge de péremption, ou null si l'item est frais. */
export function stalenessLabel(item: Datable | undefined, now: number = Date.now()): string | null {
  if (isPastDue(item, now)) return "Échéance passée";
  const age = ageInDays(item?.date, now);
  if (age !== null && age > 180 && !item?.dueDate) return "Ancien";
  return null;
}
