import { describe, it, expect } from "vitest";
import { listCitations, stripInvalidCitations, hasInvalidCitations } from "../domain/citations.js";

describe("citations — vérification des [n] (fiabilité des sorties IA)", () => {
  it("listCitations extrait les nombres cités dans l'ordre (doublons inclus)", () => {
    expect(listCitations("fait A [2], fait B [10], rappel [2]")).toEqual([2, 10, 2]);
    expect(listCitations("aucune citation ici")).toEqual([]);
    expect(listCitations("")).toEqual([]);
    expect(listCitations(null)).toEqual([]);
  });

  it("stripInvalidCitations retire les citations hors plage [1..maxN] et nettoie l'espace", () => {
    // 4 signaux : [2] valide, [7] et [0] invalides -> retirés, ponctuation conservée.
    expect(stripInvalidCitations("Programme BAD [2] confirme la demande [7].", 4)).toBe("Programme BAD [2] confirme la demande.");
    expect(stripInvalidCitations("Rien de sourcé [9] ici [0].", 4)).toBe("Rien de sourcé ici.");
    // Toutes valides -> texte inchangé.
    expect(stripInvalidCitations("A [1] B [3].", 4)).toBe("A [1] B [3].");
  });

  it("maxN <= 0 (aucun signal source) retire TOUTES les citations", () => {
    expect(stripInvalidCitations("affirmation [1] non étayée [2].", 0)).toBe("affirmation non étayée.");
  });

  it("n'altère jamais le texte hors citations", () => {
    expect(stripInvalidCitations("Prix: 1 200 000 XOF, marge 21%.", 3)).toBe("Prix: 1 200 000 XOF, marge 21%.");
  });

  it("hasInvalidCitations signale une citation hors plage sans modifier le texte", () => {
    expect(hasInvalidCitations("A [2] B [5]", 4)).toBe(true);
    expect(hasInvalidCitations("A [2] B [3]", 4)).toBe(false);
    expect(hasInvalidCitations("aucune", 4)).toBe(false);
  });
});
