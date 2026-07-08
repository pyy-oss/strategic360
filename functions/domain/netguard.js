"use strict";

/**
 * domain/netguard.js — GARDE ANTI-SSRF (audit pré-lancement 2026-07, B1).
 *
 * L'app fetch des URLs qui ne viennent pas d'elle : URL saisie par un exécutif (onboardCompany),
 * URLs proposées par l'IA (candidateSources), redirections HTTP de sites tiers. Sans filtre, un
 * appelant (ou une page qui redirige, ou un prompt injecté) peut faire viser le réseau INTERNE du
 * projet partagé (RFC1918, link-local, metadata GCP 169.254.169.254, loopback).
 *
 * PUR (aucune I/O) : classification d'IP et validation de forme d'URL, testables unitairement.
 * La résolution DNS (I/O) vit dans index.js (assertSafePublicUrl) et s'appuie sur isForbiddenIp.
 */

/** IPv4 sous forme d'entier 32 bits, ou null si ce n'est pas une IPv4 littérale valide. */
function ipv4ToInt(ip) {
  const m = String(ip == null ? "" : ip).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** Plages IPv4 interdites : [base, masque en bits]. */
const FORBIDDEN_V4_RANGES = [
  ["0.0.0.0", 8],        // « this network »
  ["10.0.0.0", 8],       // RFC1918
  ["100.64.0.0", 10],    // CGNAT (RFC6598) — réseaux d'infra cloud
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local + metadata GCP/AWS (169.254.169.254)
  ["172.16.0.0", 12],    // RFC1918
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.168.0.0", 16],   // RFC1918
  ["198.18.0.0", 15],    // bancs de test réseau
  ["224.0.0.0", 3],      // multicast + réservé (224/4 et 240/4)
].map(([base, bits]) => ({ base: ipv4ToInt(base), bits }));

function isForbiddenIpv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return FORBIDDEN_V4_RANGES.some(({ base, bits }) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

/**
 * isForbiddenIp(addr) -> bool — true si l'adresse (IPv4 ou IPv6) est privée/interne/loopback/
 * link-local/metadata et ne doit JAMAIS être fetchée. IPv6 : loopback (::1), non spécifiée (::),
 * ULA fc00::/7, link-local fe80::/10, et IPv4 mappée (::ffff:a.b.c.d → re-testée comme IPv4).
 */
function isForbiddenIp(addr) {
  const a = String(addr == null ? "" : addr).trim().toLowerCase();
  if (!a) return true; // adresse vide = on refuse
  // IPv4 mappée dans IPv6 (::ffff:10.0.0.1) — déballer et tester en IPv4.
  const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isForbiddenIpv4(mapped[1]);
  if (a.includes(":")) {
    if (a === "::" || a === "::1") return true;
    if (/^f[cd]/.test(a)) return true;              // fc00::/7 (ULA)
    if (/^fe[89ab]/.test(a)) return true;           // fe80::/10 (link-local)
    return false;
  }
  return isForbiddenIpv4(a);
}

/** Hostnames interdits d'office, sans même résoudre (localhost & co, metadata GCP par nom). */
const FORBIDDEN_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);

/**
 * checkPublicHttpUrl(urlString) -> { ok: true, url: URL } | { ok: false, reason }
 * Validation de FORME (pure, sans DNS) : schéma http(s), pas de credentials embarqués,
 * hostname non interdit, et si le hostname est une IP littérale → pas une IP interdite.
 * La résolution DNS des noms de domaine est faite par l'appelant (index.js).
 */
function checkPublicHttpUrl(urlString) {
  let u;
  try { u = new URL(String(urlString)); } catch { return { ok: false, reason: "URL invalide" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: `schéma interdit (${u.protocol})` };
  if (u.username || u.password) return { ok: false, reason: "credentials dans l'URL" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // [::1] → ::1
  if (FORBIDDEN_HOSTNAMES.has(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: `hôte interne interdit (${host})` };
  }
  // IP littérale (v4 ou v6) → test direct, pas besoin de DNS.
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isForbiddenIp(host)) return { ok: false, reason: `adresse IP interne interdite (${host})` };
  }
  return { ok: true, url: u };
}

module.exports = { isForbiddenIp, checkPublicHttpUrl };
