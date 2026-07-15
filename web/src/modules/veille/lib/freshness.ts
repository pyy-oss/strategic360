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

/**
 * FRAÎCHEUR AS-OF (audit valeur CXO 2026-07) — libellé temps-relatif français d'un instant `ms`
 * (epoch ms), pour dater à l'écran les chiffres nt360/summaries (« un DAF ne signe pas un chiffre
 * sans savoir de quand il date »). PUR. Renvoie null si `ms` n'est pas un instant exploitable.
 */
export function relativeTimeFr(ms: number | null | undefined, now: number = Date.now()): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const diff = now - ms;
  if (diff < 0) return "à l'instant";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  return `il y a ${Math.floor(mo / 12)} an(s)`;
}

/** Âge d'un instant `ms` en jours (≥ 0), ou null si inexploitable. Sert le seuil de péremption des chiffres. */
export function timestampAgeDays(ms: number | null | undefined, now: number = Date.now()): number | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.max((now - ms) / DAY_MS, 0);
}
