import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { Role } from "./rbac";

/**
 * Intégrations tierces — wrappers TypeScript des callables `userAdmin` et `webhookAdmin` (Direction
 * uniquement, cf. functions/index.js). Tout est routé par `action`. Les secrets ne sont renvoyés
 * qu'à la création/rotation (jamais relus ensuite : le backend renvoie `secretMasked`).
 */

export const OUTBOUND_EVENTS = ["intel.signal", "briefing.created", "action.created", "account.event"] as const;
export const INBOUND_ACTIONS = ["ingest", "action", "sync", "pull"] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];
export type InboundAction = (typeof INBOUND_ACTIONS)[number];

export const EVENT_LABEL: Record<OutboundEvent, string> = {
  "intel.signal": "Signal de veille (fort score)",
  "briefing.created": "Nouveau briefing",
  "action.created": "Nouvelle action / plan",
  "account.event": "Cycle de vie compte",
};
export const ACTION_LABEL: Record<InboundAction, string> = {
  ingest: "Ingérer un signal",
  action: "Créer une action",
  sync: "Déclencher une sync",
  pull: "Lecture seule (pull)",
};

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  disabled: boolean;
  lastSignIn: string | null;
  createdAt: string | null;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: OutboundEvent[];
  label: string;
  active: boolean;
  secretMasked: string;
  lastDeliveryOk: boolean | null;
  lastDeliveryAt: unknown;
  lastError: string | null;
}

export interface InboundSource {
  id: string;
  label: string;
  actions: InboundAction[];
  active: boolean;
  secretMasked: string;
  lastSeenAt: unknown;
}

export interface Delivery {
  id: string;
  event: string;
  url: string;
  ok: boolean;
  status: number;
  error: string | null;
  attempts: number;
  ts: unknown;
}

export interface InboundLogEntry {
  id: string;
  sourceId: string | null;
  action: string | null;
  ok: boolean;
  status: number;
  error?: string | null;
  ms?: number;
  ts: unknown;
}

function userAdmin<T>(payload: Record<string, unknown>): Promise<T> {
  const call = httpsCallable<Record<string, unknown>, T>(functions, "userAdmin");
  return call(payload).then((r) => r.data);
}
function webhookAdmin<T>(payload: Record<string, unknown>): Promise<T> {
  const call = httpsCallable<Record<string, unknown>, T>(functions, "webhookAdmin");
  return call(payload).then((r) => r.data);
}

// ---- Utilisateurs ----
export const listUsers = () => userAdmin<{ users: AppUser[] }>({ action: "list" }).then((r) => r.users);
export const inviteUser = (email: string, role: Role) =>
  userAdmin<{ ok: boolean; uid: string; created: boolean; passwordEmailSent: boolean }>({ action: "invite", email, role });
export const assignRole = (uid: string, role: Role) => userAdmin<{ ok: boolean }>({ action: "assign", uid, role });
export const revokeUser = (uid: string) => userAdmin<{ ok: boolean }>({ action: "revoke", uid });

// ---- Webhooks sortants ----
export const listEndpoints = () => webhookAdmin<{ endpoints: WebhookEndpoint[] }>({ action: "listEndpoints" }).then((r) => r.endpoints);
export const upsertEndpoint = (endpoint: { url: string; events: OutboundEvent[]; label: string; active: boolean }, id?: string) =>
  webhookAdmin<{ ok: boolean; id: string; secret?: string }>({ action: "upsertEndpoint", endpoint, id });
export const rotateEndpointSecret = (id: string) => webhookAdmin<{ ok: boolean; secret: string }>({ action: "rotateEndpointSecret", id });
export const deleteEndpoint = (id: string) => webhookAdmin<{ ok: boolean }>({ action: "deleteEndpoint", id });
export const listDeliveries = () => webhookAdmin<{ deliveries: Delivery[] }>({ action: "listDeliveries" }).then((r) => r.deliveries);

// ---- Webhooks entrants ----
export const listInboundSources = () => webhookAdmin<{ sources: InboundSource[] }>({ action: "listInboundSources" }).then((r) => r.sources);
export const upsertInboundSource = (source: { label: string; actions: InboundAction[]; active: boolean }, id?: string) =>
  webhookAdmin<{ ok: boolean; id: string; secret?: string }>({ action: "upsertInboundSource", source, id });
export const rotateInboundSecret = (id: string) => webhookAdmin<{ ok: boolean; secret: string }>({ action: "rotateInboundSecret", id });
export const deleteInboundSource = (id: string) => webhookAdmin<{ ok: boolean }>({ action: "deleteInboundSource", id });
export const listInboundLog = () => webhookAdmin<{ log: InboundLogEntry[] }>({ action: "listInboundLog" }).then((r) => r.log);
