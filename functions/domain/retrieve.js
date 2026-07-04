"use strict";

/**
 * Récupération légère (Vague D, 2026-07) — « RAG light » SANS infra vectorielle. L'audit a montré
 * que le vrai goulot n'était pas la recherche sémantique mais des sélections de signaux ARBITRAIRES
 * (slice(0,10), top-60 identique pour tous les générateurs, indépendant du sujet). Ce module classe
 * une liste de signaux par PERTINENCE au sujet demandé (axes + termes) tout en respectant la
 * priorité et la récence — de façon déterministe, pure et testable. Décision « pas de RAG vectoriel
 * maintenant » (ADR) : on capte l'essentiel de la valeur à coût quasi nul dans le domaine pur.
 */

function normalize(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Termes trop génériques pour discriminer la pertinence (évite de tout « matcher »).
const TERM_STOP = new Set([
  "de", "la", "le", "les", "des", "du", "et", "en", "un", "une", "pour", "sur", "au", "aux", "dans",
  "the", "of", "a", "to", "in", "and", "with", "banque", "groupe", "afrique", "cote", "ivoire",
]);

function usefulTerms(terms) {
  const out = new Set();
  for (const raw of Array.isArray(terms) ? terms : []) {
    for (const w of normalize(raw).split(/\s+/)) {
      if (w.length >= 4 && !TERM_STOP.has(w)) out.add(w);
    }
  }
  return [...out];
}

/**
 * relevanceScore(signal, {axes, terms, now}) -> number — score de pertinence d'un signal :
 *   +3 par appartenance à un axe ciblé, +2 par terme distinctif trouvé (titre/résumé/entité/soWhat),
 *   + petit bonus de récence (0..1 sur ~365 j), + petit apport de la priorité déjà calculée.
 * PUR. `now` injectable pour des tests déterministes.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
function relevanceScore(signal, opts = {}) {
  const s = signal || {};
  const axes = Array.isArray(opts.axes) ? opts.axes : [];
  const terms = usefulTerms(opts.terms);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();

  let score = 0;
  if (axes.length && s.axis && axes.includes(s.axis)) score += 3;

  if (terms.length) {
    const hay = " " + normalize([s.title, s.name, s.summary, s.ent, s.client, s.offering, s.soWhat, s.subtype].filter(Boolean).join(" ")) + " ";
    let hits = 0;
    // Ancrage au DÉBUT de mot ("hay" est bordé d'espaces et normalisé) : matche le terme comme mot
    // entier ou préfixe (banque→banques) mais JAMAIS en milieu de mot (cima ≠ décimale). Le repli
    // sous-chaîne précédent annulait ce garde-fou de frontière (audit 2026-07).
    for (const t of terms) if (hay.includes(" " + t)) hits++;
    score += 2 * hits;
  }

  // Récence : 1.0 aujourd'hui → 0 à ≥365 j (les signaux périmés remontent moins).
  const t = s.date ? Date.parse(s.date) : NaN;
  if (!Number.isNaN(t)) {
    const days = Math.max((now - t) / DAY_MS, 0);
    score += Math.max(0, 1 - days / 365);
  }

  // Apport léger de la priorité déjà calculée (0..1) pour départager sans l'emporter sur le sujet.
  if (Number.isFinite(s.priorityScore)) score += Math.min(1, Math.max(0, s.priorityScore / 100));

  return score;
}

/**
 * rankByRelevance(signals, opts) -> signals triés par pertinence décroissante (tri STABLE : à score
 * égal l'ordre d'entrée — donc la priorité pré-triée — est préservé). PUR, ne mute pas l'entrée.
 */
function rankByRelevance(signals, opts = {}) {
  const list = Array.isArray(signals) ? signals.slice() : [];
  return list
    .map((s, i) => ({ s, i, score: relevanceScore(s, opts) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}

/** pickRelevant(signals, opts, n) -> les n signaux les plus pertinents (classés). PUR. */
function pickRelevant(signals, opts = {}, n = 10) {
  return rankByRelevance(signals, opts).slice(0, Math.max(0, n));
}

module.exports = { normalize, usefulTerms, relevanceScore, rankByRelevance, pickRelevant };
