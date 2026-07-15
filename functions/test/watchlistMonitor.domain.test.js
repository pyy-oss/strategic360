"use strict";

/** Tests unitaires de la surveillance active des entités watchlist (Google News RSS). PURS. */

import { describe, it, expect } from "vitest";
import {
  entityMonitorSourceId, entityNewsSourceUrl, isMonitored,
  buildEntityMonitorSource, planWatchlistMonitors, MONITOR_SOURCE_PREFIX,
} from "../domain/watchlistMonitor.js";

describe("watchlistMonitor — surveillance active des entités", () => {
  it("entityNewsSourceUrl : recherche Google News, nom entre guillemets + géo dans la requête, hl=fr", () => {
    const u = entityNewsSourceUrl("Talentys", "Côte d'Ivoire");
    expect(u.startsWith("https://news.google.com/rss/search?q=")).toBe(true);
    expect(u).toContain("hl=fr");
    // "Talentys" et la géo sont encodés dans q
    const q = decodeURIComponent(u.split("q=")[1].split("&")[0]);
    expect(q).toBe('"Talentys" Côte d\'Ivoire');
    // Sans géo : juste le nom entre guillemets
    expect(decodeURIComponent(entityNewsSourceUrl("SNDI").split("q=")[1].split("&")[0])).toBe('"SNDI"');
  });

  it("entityMonitorSourceId : id déterministe préfixé, slug ASCII, sans géo", () => {
    expect(entityMonitorSourceId("N'SOCITECH")).toBe(MONITOR_SOURCE_PREFIX + "n-socitech");
    expect(entityMonitorSourceId("  ")).toBeNull();
  });

  it("entityMonitorSourceId : la géo est incluse → pas de collision entre homonymes", () => {
    const a = entityMonitorSourceId("Orange", "Côte d'Ivoire");
    const b = entityMonitorSourceId("Orange", "Sénégal");
    expect(a).toBe(MONITOR_SOURCE_PREFIX + "orange-cote-d-ivoire");
    expect(b).toBe(MONITOR_SOURCE_PREFIX + "orange-senegal");
    expect(a).not.toBe(b);
  });

  it("isMonitored : Haute/Moyenne active seulement", () => {
    expect(isMonitored({ name: "X", priority: "Haute", active: true })).toBe(true);
    expect(isMonitored({ name: "X", priority: "Moyenne" })).toBe(true); // active défaut = surveillé
    expect(isMonitored({ name: "X", priority: "Basse", active: true })).toBe(false);
    expect(isMonitored({ name: "X", priority: "Haute", active: false })).toBe(false);
    expect(isMonitored({ name: "", priority: "Haute", active: true })).toBe(false);
  });

  it("buildEntityMonitorSource : mappe type→axe, kind rss, tague l'entité, id inclut la géo", () => {
    const s = buildEntityMonitorSource({ name: "CBI Côte d'Ivoire", type: "concurrent", geo: "UEMOA", priority: "Haute", active: true });
    expect(s.kind).toBe("rss");
    expect(s.axis).toBe("concurrents");
    expect(s.watchlistEntity).toBe("CBI Côte d'Ivoire");
    expect(s.id).toBe(MONITOR_SOURCE_PREFIX + "cbi-cote-d-ivoire-uemoa");
    expect(s.name).toBe("Veille entité — CBI Côte d'Ivoire");
    // Non éligible → null
    expect(buildEntityMonitorSource({ name: "Y", priority: "Basse" })).toBeNull();
  });

  it("planWatchlistMonitors : crée les nouveaux, laisse en phase les existants identiques, désactive les orphelins", () => {
    const entities = [
      { name: "Talentys", type: "concurrent", priority: "Haute", active: true },
      { name: "SNDI", type: "concurrent", priority: "Moyenne", active: true },
      { name: "Petit", type: "concurrent", priority: "Basse", active: true }, // exclu
      { name: "Talentys", type: "concurrent", priority: "Haute", active: true }, // doublon d'id → ignoré
    ];
    const talentys = buildEntityMonitorSource(entities[0]);
    const existingById = {
      // déjà en phase (contenu identique, active) → AUCUNE écriture (anti-churn)
      [talentys.id]: { active: true, url: talentys.url, name: talentys.name, axis: talentys.axis },
      // monitor orphelin encore actif (entité disparue) → à désactiver
      "wlmon-ancien": { active: true },
    };
    const plan = planWatchlistMonitors(entities, existingById, { failureThreshold: 5 });
    expect(plan.upserts.map((s) => s.id)).toEqual(["wlmon-sndi"]);
    expect(plan.upserts[0].activate).toBe(true);
    expect(plan.deactivateIds).toEqual(["wlmon-ancien"]);
  });

  it("planWatchlistMonitors : ne RESSUSCITE PAS une source auto-désactivée pour échecs (auto-cicatrisation préservée)", () => {
    const entities = [{ name: "MortRSS", type: "concurrent", priority: "Haute", active: true }];
    const src = buildEntityMonitorSource(entities[0]);
    const existingById = {
      [src.id]: { active: false, consecutiveFailures: 6, url: src.url, name: src.name, axis: src.axis },
    };
    const plan = planWatchlistMonitors(entities, existingById, { failureThreshold: 5 });
    // Contenu identique + désactivée pour échecs → aucune réactivation, aucun upsert.
    expect(plan.upserts).toEqual([]);
    expect(plan.deactivateIds).toEqual([]);
  });

  it("planWatchlistMonitors : RÉACTIVE une source désactivée pour SORTIE de watchlist redevenue éligible", () => {
    const entities = [{ name: "Revient", type: "concurrent", priority: "Haute", active: true }];
    const src = buildEntityMonitorSource(entities[0]);
    const existingById = {
      // désactivée mais SANS échecs (donc désactivée par sortie de watchlist) → réactivation légitime.
      [src.id]: { active: false, consecutiveFailures: 0, url: src.url, name: src.name, axis: src.axis },
    };
    const plan = planWatchlistMonitors(entities, existingById, { failureThreshold: 5 });
    expect(plan.upserts.map((s) => s.id)).toEqual([src.id]);
    expect(plan.upserts[0].activate).toBe(true);
    expect(plan.deactivateIds).toEqual([]);
  });

  it("planWatchlistMonitors : réécrit (sans réactiver) une source active dont l'URL a changé", () => {
    const entities = [{ name: "MajURL", type: "concurrent", priority: "Haute", active: true }];
    const src = buildEntityMonitorSource(entities[0]);
    const existingById = {
      [src.id]: { active: true, url: "https://news.google.com/rss/search?q=old", name: src.name, axis: src.axis },
    };
    const plan = planWatchlistMonitors(entities, existingById, { failureThreshold: 5 });
    expect(plan.upserts.map((s) => s.id)).toEqual([src.id]);
    // active inchangé (déjà active) → activate=false : on ne repose pas le champ active.
    expect(plan.upserts[0].activate).toBe(false);
    expect(plan.upserts[0].url).toBe(src.url);
  });
});
