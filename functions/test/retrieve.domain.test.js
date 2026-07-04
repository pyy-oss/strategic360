"use strict";

/** Pure-function tests for functions/domain/retrieve.js (récupération légère — Vague D). */

import { describe, it, expect } from "vitest";
import { usefulTerms, relevanceScore, rankByRelevance, pickRelevant } from "../domain/retrieve.js";

const NOW = Date.parse("2026-07-02T00:00:00Z");

describe("retrieve — récupération légère par pertinence", () => {
  it("usefulTerms : garde les jetons ≥4 distinctifs, jette les génériques/courts", () => {
    expect(usefulTerms(["Banque Atlantique CI", "SOC"]).sort()).toEqual(["atlantique"]);
  });

  it("relevanceScore : axe ciblé + terme trouvé + récence font monter le score", () => {
    const onTopic = { axis: "concurrents", title: "Talentys gagne un SOC à la CNPS", date: "2026-07-01", priorityScore: 80 };
    const offTopic = { axis: "tech", title: "Nouveau framework JS", date: "2024-01-01", priorityScore: 80 };
    const s1 = relevanceScore(onTopic, { axes: ["concurrents"], terms: ["Talentys"], now: NOW });
    const s2 = relevanceScore(offTopic, { axes: ["concurrents"], terms: ["Talentys"], now: NOW });
    expect(s1).toBeGreaterThan(s2);
    expect(s1).toBeGreaterThan(3 + 2); // au moins axe(3) + 1 terme(2)
  });

  it("rankByRelevance : tri stable — à pertinence égale, l'ordre d'entrée (priorité) est préservé", () => {
    const a = { axis: "tech", title: "A", date: "2026-07-01", priorityScore: 90 };
    const b = { axis: "tech", title: "B", date: "2026-07-01", priorityScore: 10 };
    // aucun terme/axe ciblé → scores dominés par récence+priorité égales de date : ordre d'entrée gardé
    const out = rankByRelevance([a, b], { now: NOW });
    expect(out[0].title).toBe("A");
    expect(out[1].title).toBe("B");
  });

  it("pickRelevant : remonte le signal on-topic même s'il est plus loin dans la liste, borne à n", () => {
    const signals = [
      { axis: "tech", title: "Sujet A", date: "2026-06-01" },
      { axis: "tech", title: "Sujet B", date: "2026-06-01" },
      { axis: "concurrents", title: "Talentys attaque la BRVM", ent: "Talentys", date: "2026-06-20" },
    ];
    const top = pickRelevant(signals, { axes: ["concurrents"], terms: ["Talentys"], now: NOW }, 2);
    expect(top).toHaveLength(2);
    expect(top[0].title).toBe("Talentys attaque la BRVM"); // on-topic remonte en tête
  });

  it("classe aussi les leads business (name/client), tolère une liste vide", () => {
    const leads = [
      { name: "Refonte SI — secteur assurance" },
      { name: "AO cloud souverain banque" },
    ];
    const top = pickRelevant(leads, { terms: ["assurance"] }, 1);
    expect(top[0].name).toContain("assurance");
    expect(pickRelevant([], { terms: ["x"] }, 5)).toEqual([]);
  });
});
