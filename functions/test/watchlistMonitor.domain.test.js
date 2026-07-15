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

  it("entityMonitorSourceId : id déterministe préfixé, slug ASCII", () => {
    expect(entityMonitorSourceId("N'SOCITECH")).toBe(MONITOR_SOURCE_PREFIX + "n-socitech");
    expect(entityMonitorSourceId("  ")).toBeNull();
  });

  it("isMonitored : Haute/Moyenne active seulement", () => {
    expect(isMonitored({ name: "X", priority: "Haute", active: true })).toBe(true);
    expect(isMonitored({ name: "X", priority: "Moyenne" })).toBe(true); // active défaut = surveillé
    expect(isMonitored({ name: "X", priority: "Basse", active: true })).toBe(false);
    expect(isMonitored({ name: "X", priority: "Haute", active: false })).toBe(false);
    expect(isMonitored({ name: "", priority: "Haute", active: true })).toBe(false);
  });

  it("buildEntityMonitorSource : mappe type→axe, kind rss, tague l'entité", () => {
    const s = buildEntityMonitorSource({ name: "CBI Côte d'Ivoire", type: "concurrent", geo: "UEMOA", priority: "Haute", active: true });
    expect(s.kind).toBe("rss");
    expect(s.axis).toBe("concurrents");
    expect(s.watchlistEntity).toBe("CBI Côte d'Ivoire");
    expect(s.id).toBe(MONITOR_SOURCE_PREFIX + "cbi-cote-d-ivoire");
    expect(s.name).toBe("Veille entité — CBI Côte d'Ivoire");
    // Non éligible → null
    expect(buildEntityMonitorSource({ name: "Y", priority: "Basse" })).toBeNull();
  });

  it("planWatchlistMonitors : upserts pour les éligibles, désactive les monitors orphelins, dédoublonne", () => {
    const entities = [
      { name: "Talentys", type: "concurrent", priority: "Haute", active: true },
      { name: "SNDI", type: "concurrent", priority: "Moyenne", active: true },
      { name: "Petit", type: "concurrent", priority: "Basse", active: true }, // exclu
      { name: "Talentys", type: "concurrent", priority: "Haute", active: true }, // doublon d'id → ignoré
    ];
    // Un monitor existant "wlmon-ancien" dont l'entité n'existe plus → à désactiver.
    const plan = planWatchlistMonitors(entities, ["wlmon-talentys", "wlmon-ancien"]);
    expect(plan.upserts.map((s) => s.id).sort()).toEqual(["wlmon-sndi", "wlmon-talentys"]);
    expect(plan.deactivateIds).toEqual(["wlmon-ancien"]);
  });
});
