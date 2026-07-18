"use strict";

/**
 * Webhooks — module PUR (aucun accès Firestore/réseau ici, tout est injecté) partagé par index.js
 * (dispatch sortant + endpoint entrant) et les tests. Couvre :
 *  - la SIGNATURE HMAC-SHA256 des charges utiles (sortantes ET entrantes) avec horodatage anti-rejeu ;
 *  - les CONSTANTES d'événements sortants / actions entrantes (source unique, réutilisée par le front) ;
 *  - les VALIDATEURS de config (endpoint sortant, source entrante) — n'acceptent que des champs connus ;
 *  - l'appariement endpoint ↔ événement et la construction de l'enveloppe d'événement.
 *
 * Sécurité : la signature porte sur `${timestamp}.${body}` — le timestamp est signé, donc une capture
 * rejouée expire après `toleranceSec`. La vérification est à temps constant (timingSafeEqual).
 */

const crypto = require("node:crypto");

/** Événements SORTANTS supportés (Sentinel → app tierce). Source unique, mirroir côté front. */
const OUTBOUND_EVENTS = [
  "intel.signal", // un signal de veille FRANCHIT le seuil « fort score »
  "briefing.created", // un briefing (hebdo/quotidien) vient d'être produit
  "action.created", // une action / un geste de plan vient d'être créé
  "account.event", // événement de cycle de vie (onboarding terminé, compte à fort enjeu)
];

/** Actions ENTRANTES supportées (app tierce → Sentinel), via l'endpoint HTTPS public signé. */
const INBOUND_ACTIONS = [
  "ingest", // POST d'un signal externe → entre dans le fil intelItems (pipeline classify/score)
  "action", // POST → crée une action datée (ex. depuis un CRM)
  "sync", // POST → force un rafraîchissement (syncSources / syncInternalQuanti)
  "pull", // GET signé → expose des résumés/KPI en lecture seule (aucune écriture)
];

/** En-têtes HTTP portant la signature et l'horodatage (entrant ET sortant). */
const SIGNATURE_HEADER = "x-sentinel-signature";
const TIMESTAMP_HEADER = "x-sentinel-timestamp";
const EVENT_HEADER = "x-sentinel-event";

/** Tolérance d'horloge par défaut (s) pour l'anti-rejeu. */
const DEFAULT_TOLERANCE_SEC = 300;

function canonicalBody(body) {
  if (typeof body === "string") return body;
  if (body === undefined || body === null) return "";
  return JSON.stringify(body);
}

/**
 * signPayload(body, secret, timestamp) → "sha256=<hex>". La signature porte sur
 * `${timestamp}.${body}` : l'horodatage EST signé, donc un rejeu échoue après la fenêtre de tolérance.
 */
function signPayload(body, secret, timestamp) {
  const mac = crypto
    .createHmac("sha256", String(secret || ""))
    .update(`${String(timestamp)}.${canonicalBody(body)}`)
    .digest("hex");
  return `sha256=${mac}`;
}

/**
 * verifySignature({ body, secret, signature, timestamp, nowMs, toleranceSec }) → bool.
 * Rejette si l'horodatage est hors tolérance (anti-rejeu) puis compare à temps constant.
 */
function verifySignature({ body, secret, signature, timestamp, nowMs, toleranceSec = DEFAULT_TOLERANCE_SEC }) {
  if (!secret || !signature || timestamp === undefined || timestamp === null || timestamp === "") return false;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor((typeof nowMs === "number" ? nowMs : Date.now()) / 1000);
  if (Math.abs(nowSec - tsNum) > toleranceSec) return false;
  const expected = signPayload(body, secret, timestamp);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Secret partagé (hex, 256 bits) pour un endpoint sortant ou une source entrante. */
function generateSecret() {
  return crypto.randomBytes(32).toString("hex");
}

/** Masque un secret pour l'affichage (jamais renvoyé en clair au client après création). */
function maskSecret(secret) {
  if (!secret || typeof secret !== "string") return "";
  if (secret.length <= 8) return "••••";
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** Nettoie un endpoint SORTANT venant du client : n'accepte que url/events/label/active. */
function sanitizeEndpoint(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const url = typeof o.url === "string" ? o.url.trim() : "";
  const events = Array.isArray(o.events)
    ? [...new Set(o.events.filter((e) => OUTBOUND_EVENTS.includes(e)))]
    : [];
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 120) : "";
  const active = o.active !== false;
  return { url, events, label, active };
}

/** Nettoie une source ENTRANTE venant du client : n'accepte que label/actions/active. */
function sanitizeInboundSource(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 120) : "";
  const actions = Array.isArray(o.actions)
    ? [...new Set(o.actions.filter((a) => INBOUND_ACTIONS.includes(a)))]
    : [];
  const active = o.active !== false;
  return { label, actions, active };
}

/** Vrai si l'endpoint est actif et abonné à `eventType`. */
function endpointMatchesEvent(endpoint, eventType) {
  return (
    !!endpoint &&
    endpoint.active !== false &&
    Array.isArray(endpoint.events) &&
    endpoint.events.includes(eventType)
  );
}

/** Enveloppe standard d'un événement sortant (JSON envoyé aux endpoints abonnés). */
function buildEventEnvelope(eventType, data, opts = {}) {
  return {
    id: opts.id || null,
    type: eventType,
    createdAt: opts.timestamp || new Date().toISOString(),
    source: opts.source || "sentinel-360",
    data: data && typeof data === "object" ? data : {},
  };
}

module.exports = {
  OUTBOUND_EVENTS,
  INBOUND_ACTIONS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_HEADER,
  DEFAULT_TOLERANCE_SEC,
  signPayload,
  verifySignature,
  generateSecret,
  maskSecret,
  sanitizeEndpoint,
  sanitizeInboundSource,
  endpointMatchesEvent,
  buildEventEnvelope,
};
