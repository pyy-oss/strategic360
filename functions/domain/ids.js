"use strict";

/**
 * Deterministic ID scheme shared between client and server (BUILD_KIT.md §10 "Idempotence : IDs
 * déterministes (`intelItems/{hash(url|title+date)}`)").
 *
 * This is a byte-for-byte port of the djb2-XOR hash + composition logic in
 * `web/src/modules/veille/lib/intel.ts` (`djb2Hex` / `intelItemId`) so that `syncSources`
 * (server-side ingestion) computes THE SAME `intelItems/{id}` as the client would for the same
 * `{url, title, date}` — required for idempotent re-ingestion (same signal fetched twice never
 * creates a duplicate doc), matching the same scheme whether the item originates from a human
 * "Nouvelle fiche de veille" submission or an automated `syncSources` run.
 */

/**
 * Small dependency-free string hash (djb2 XOR variant), hex-encoded. Not cryptographic — just
 * needs to be deterministic and low-collision enough for idempotent Firestore doc IDs.
 * MUST match `djb2Hex` in web/src/modules/veille/lib/intel.ts exactly.
 */
function djb2Hex(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // Force unsigned 32-bit, hex-encode, left-pad to 8 chars.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * `intelItems/{hash(url|title+date)}` per BUILD_KIT.md §10.
 * MUST match `intelItemId` in web/src/modules/veille/lib/intel.ts exactly.
 * @param {{url?: string, title: string, date: string}} input
 * @returns {string}
 */
function intelItemId(input) {
  const basis = input.url && input.url.trim() ? input.url.trim() : `${input.title}|${input.date}`;
  return `item_${djb2Hex(basis)}`;
}

module.exports = { djb2Hex, intelItemId };
