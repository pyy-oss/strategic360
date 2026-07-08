"use strict";

/** Tests de la garde anti-SSRF (audit pré-lancement 2026-07, B1). PUR — aucune I/O réseau. */

import { describe, it, expect } from "vitest";
import { isForbiddenIp, checkPublicHttpUrl } from "../domain/netguard.js";

describe("netguard — isForbiddenIp", () => {
  it.each([
    "127.0.0.1", "127.255.255.255",      // loopback
    "10.0.0.1", "10.255.0.9",            // RFC1918
    "172.16.0.1", "172.31.255.254",      // RFC1918
    "192.168.1.1",                       // RFC1918
    "169.254.169.254", "169.254.0.1",    // link-local + metadata GCP
    "100.64.0.1",                        // CGNAT
    "0.0.0.0",                           // this-network
    "198.18.0.1",                        // bancs de test
    "224.0.0.1", "255.255.255.255",      // multicast / broadcast
    "::1", "::",                         // IPv6 loopback / unspecified
    "fc00::1", "fd12:3456::1",           // ULA
    "fe80::1",                           // link-local v6
    "::ffff:10.0.0.1", "::ffff:127.0.0.1", // IPv4 mappée
  ])("refuse %s", (ip) => {
    expect(isForbiddenIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8", "1.1.1.1", "41.207.200.10", // publiques (dont CI)
    "172.15.0.1", "172.32.0.1",            // hors 172.16/12
    "192.167.1.1", "11.0.0.1",             // hors plages privées
    "2001:4860:4860::8888",                // IPv6 publique
    "::ffff:8.8.8.8",                      // IPv4 publique mappée
  ])("accepte %s", (ip) => {
    expect(isForbiddenIp(ip)).toBe(false);
  });

  it("refuse une adresse vide/nulle (défaut sûr)", () => {
    expect(isForbiddenIp("")).toBe(true);
    expect(isForbiddenIp(null)).toBe(true);
  });
});

describe("netguard — checkPublicHttpUrl", () => {
  it("accepte une URL https publique", () => {
    const r = checkPublicHttpUrl("https://www.artci.ci/actualites");
    expect(r.ok).toBe(true);
    expect(r.url.hostname).toBe("www.artci.ci");
  });

  it.each([
    ["ftp://example.com/x", "schéma"],
    ["file:///etc/passwd", "schéma"],
    ["gopher://example.com", "schéma"],
    ["http://user:pass@example.com/", "credentials"],
    ["http://localhost/admin", "interne"],
    ["http://metadata.google.internal/computeMetadata/v1/", "interne"],
    ["http://foo.internal/x", "interne"],
    ["http://printer.local/x", "interne"],
    ["http://127.0.0.1:8080/", "IP interne"],
    ["http://169.254.169.254/computeMetadata/v1/", "IP interne"],
    ["http://10.1.2.3/", "IP interne"],
    ["http://[::1]/", "IP interne"],
    ["http://[fd00::1]/", "IP interne"],
    ["pas-une-url", "URL invalide"],
  ])("refuse %s (%s)", (url) => {
    expect(checkPublicHttpUrl(url).ok).toBe(false);
  });

  it("laisse passer un domaine public (le DNS est vérifié par l'appelant)", () => {
    expect(checkPublicHttpUrl("http://example.com/page").ok).toBe(true);
  });
});
