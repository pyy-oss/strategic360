import { describe, it, expect } from "vitest";
import { pick, geoFromCountry, wbNoticeUrl, parseWorldBankProcNotices } from "../domain/donorFeeds.js";

describe("donorFeeds — pick", () => {
  it("renvoie la 1ʳᵉ clé non vide", () => {
    expect(pick({ a: "", b: "  x  " }, ["a", "b"])).toBe("x");
    expect(pick({ a: "V" }, ["z", "a"])).toBe("V");
  });
  it("null si rien / entrée non-objet", () => {
    expect(pick({ a: "" }, ["a"])).toBeNull();
    expect(pick(null, ["a"])).toBeNull();
  });
});

describe("donorFeeds — geoFromCountry", () => {
  it("mappe le code ISO-3 UEMOA/CEDEAO", () => {
    expect(geoFromCountry("CIV")).toBe("ci");
    expect(geoFromCountry("SEN")).toBe("sn");
    expect(geoFromCountry("BFA")).toBe("bf");
  });
  it("retombe sur le nom si le code est absent/inconnu", () => {
    expect(geoFromCountry("", "Côte d'Ivoire")).toBe("ci");
    expect(geoFromCountry("XXX", "Republic of Senegal")).toBe("sn");
    expect(geoFromCountry(null, "West Africa")).toBe("afrique_ouest");
  });
  it("null si indéterminable", () => {
    expect(geoFromCountry("", "")).toBeNull();
  });
});

describe("donorFeeds — wbNoticeUrl", () => {
  it("construit une URL d'avis depuis l'id", () => {
    expect(wbNoticeUrl("OP00123")).toBe("https://projects.worldbank.org/en/projects-operations/procurement-detail/OP00123");
  });
  it("null sans id", () => { expect(wbNoticeUrl(null)).toBeNull(); });
});

describe("donorFeeds — parseWorldBankProcNotices", () => {
  const sample = {
    rows: 2,
    procnotices: [
      {
        id: "OP00998877",
        bid_description: "Fourniture d'équipements réseau et cybersécurité — Projet e-gouvernement",
        project_name: "PADSCI",
        countrycode: "CIV",
        project_ctry_name: "Cote d'Ivoire",
        submission_deadline_date: "2026-09-15",
        notice_type: "Request for Bids",
        noticedate: "2026-07-10",
      },
      {
        // avis sans URL déterministe (pas d'id) ET sans champ url → doit être écarté
        bid_description: "Avis sans référence exploitable",
        project_ctry_name: "Mali",
      },
    ],
  };

  it("normalise un avis structuré avec provenance complète", () => {
    const out = parseWorldBankProcNotices(sample);
    expect(out).toHaveLength(1); // le 2e (sans id/url) est écarté
    const n = out[0];
    expect(n.title).toContain("cybersécurité");
    expect(n.url).toBe("https://projects.worldbank.org/en/projects-operations/procurement-detail/OP00998877");
    expect(n.geo).toBe("ci");
    expect(n.deadline).toBe("2026-09-15");
    expect(n.tenderRef).toBe("OP00998877");
  });

  it("accepte la forme {procnotices:{...}} (objet indexé)", () => {
    const out = parseWorldBankProcNotices({ procnotices: { k1: { id: "X1", title: "AO test", country: "Senegal", countrycode: "SEN" } } });
    expect(out).toHaveLength(1);
    expect(out[0].geo).toBe("sn");
    expect(out[0].url).toContain("X1");
  });

  it("respecte maxItems", () => {
    const many = { procnotices: Array.from({ length: 50 }, (_, i) => ({ id: `N${i}`, title: `Avis ${i}`, countrycode: "CIV" })) };
    expect(parseWorldBankProcNotices(many, { maxItems: 5 })).toHaveLength(5);
  });

  it("tolère une entrée inexploitable → []", () => {
    expect(parseWorldBankProcNotices(null)).toEqual([]);
    expect(parseWorldBankProcNotices({ foo: "bar" })).toEqual([]);
    expect(parseWorldBankProcNotices([{ nope: 1 }])).toEqual([]);
  });
});
