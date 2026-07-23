import { describe, it, expect, afterEach } from "vitest";
import { generateJson, createRateLimiter } from "../domain/vertex.js";

// Barrière 6 (audit coûts GCP 2026-07) : coupe-circuit VERTEX_DISABLED + plafond de débit.

describe("VERTEX_DISABLED (coupe-circuit environnements de test)", () => {
  afterEach(() => {
    delete process.env.VERTEX_DISABLED;
  });

  it.each(["1", "true", "TRUE", "yes"])("refuse tout appel quand VERTEX_DISABLED=%s", async (v) => {
    process.env.VERTEX_DISABLED = v;
    await expect(generateJson("prompt de test")).rejects.toThrow(/VERTEX_DISABLED/);
  });

  it("ne bloque pas quand la variable est absente ou 0 (l'appel échoue plus loin, sur le client)", async () => {
    process.env.VERTEX_DISABLED = "0";
    // Sans GCLOUD_PROJECT, l'échec attendu est celui du client — PAS le coupe-circuit.
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    await expect(generateJson("prompt de test")).rejects.toThrow(/GCLOUD_PROJECT/);
  });

  it("valide toujours le prompt avant tout (comportement inchangé)", async () => {
    process.env.VERTEX_DISABLED = "1";
    await expect(generateJson("")).rejects.toThrow(/prompt/);
  });
});

describe("createRateLimiter (fenêtre glissante 60 s)", () => {
  const makeClock = () => {
    let t = 1_000_000;
    const waits = [];
    return {
      now: () => t,
      advance: (ms) => {
        t += ms;
      },
      sleep: async (ms) => {
        waits.push(ms);
        t += ms; // le temps passe pendant l'attente
      },
      waits,
    };
  };

  it("laisse passer maxPerWindow appels sans attendre", async () => {
    const clock = makeClock();
    const acquire = createRateLimiter({ maxPerWindow: 3, now: clock.now, sleep: clock.sleep });
    await acquire();
    await acquire();
    await acquire();
    expect(clock.waits).toEqual([]);
  });

  it("fait attendre le (max+1)e appel jusqu'à libération d'un créneau", async () => {
    const clock = makeClock();
    const acquire = createRateLimiter({ maxPerWindow: 2, now: clock.now, sleep: clock.sleep });
    await acquire();
    clock.advance(10_000);
    await acquire();
    await acquire(); // plafond atteint → doit dormir jusqu'à expiration du 1er créneau (60 s - 10 s)
    expect(clock.waits).toEqual([50_000]);
  });

  it("libère les créneaux après la fenêtre de 60 s", async () => {
    const clock = makeClock();
    const acquire = createRateLimiter({ maxPerWindow: 1, now: clock.now, sleep: clock.sleep });
    await acquire();
    clock.advance(60_001);
    await acquire();
    expect(clock.waits).toEqual([]);
  });

  it("plancher à 1 même avec une config invalide (jamais de blocage total)", async () => {
    const clock = makeClock();
    const acquire = createRateLimiter({ maxPerWindow: 0, now: clock.now, sleep: clock.sleep });
    await acquire(); // ne doit pas bloquer indéfiniment
    expect(clock.waits).toEqual([]);
  });
});
