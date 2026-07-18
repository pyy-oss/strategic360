"use strict";

/**
 * domain/copilote.js — Copilote Commercial (add-on DELTA 02 / 02B).
 *
 * MÊME PATTERN que domain/classify.js et domain/enrich.js : builders de prompt PURS + parsers
 * (aucun appel réseau ici — l'orchestration/IA vit dans index.js via generateJson). On RÉUTILISE
 * le moteur IA serveur (functions/domain/vertex.js#generateJson, gemini-3.5-flash) : pas de 2ᵉ pile
 * IA, pas de dépendance ajoutée. Les gabarits reprennent l'ANNEXE 02 §B–§G, adaptés à la sortie
 * « JSON only » déjà utilisée partout dans ce repo (les parsers coercent/valident, jamais d'undefined).
 */

// Source unique des différenciateurs de marque (audit 2026-07) — partagée avec les cadres (enrich.js).
const { NT_DIFFERENCIATEURS } = require("./companyContext");
// Validation calendaire réutilisée du classifieur (audit final pré-prod 2026-07) — une échéance ISO
// impossible (2026-02-30) ne doit jamais être propagée dans le plan d'action.
const { isValidCalendarDate } = require("./classify");

/* ------------------------------------------------------------------------------------------- *
 * Rôle système commun (ANNEXE 02 §A · NT_ROLE)
 * ------------------------------------------------------------------------------------------- */
const NT_ROLE =
  "Tu es le copilote commercial de Neurones Technologies S.A. (raison sociale complète — intégrateur " +
  "IT/télécom/cybersécurité et ESN, siège Abidjan Cocody II Plateaux, zone UEMOA/CEMAC), à NE JAMAIS " +
  "confondre avec les homonymes : le groupe français coté NEURONES, Neurones Technologies SA de Genève " +
  "ou Neurones IT Asia. Tu sers un commercial/DRO. " +
  "Français, concis, concret, orienté action. Aucune donnée client inventée : " +
  "si une information manque, écris-le explicitement plutôt que de l'estimer. " +
  "Réponds UNIQUEMENT avec un objet JSON valide conforme au schéma demandé, sans texte ni balises autour.";

// Directive anti-générique (2026-07, retour terrain : « les outputs sont génériques, on dirait un
// copier-coller de la veille »). Force l'ancrage sur les FAITS PROPRES au compte.
const NO_GENERIC =
  "EXIGENCE DE CONSISTANCE (impérative) : chaque phrase doit s'appuyer sur un FAIT PROPRE À CE COMPTE — " +
  "un montant réel (CA déjà réalisé, montant d'un deal en cours), une offre DÉJÀ vendue, ou une offre du " +
  "whitespace (jamais vendue à ce compte). Nomme les offres et cite les montants. " +
  "INTERDIT : généralités macro-économiques, copier-coller du contexte de veille/PESTEL, phrases " +
  "passe-partout applicables à n'importe quelle entreprise, jargon creux. Si la matière manque sur ce " +
  "compte, dis-le franchement et propose une action de QUALIFICATION plutôt que d'inventer ou de meubler. " +
  "RÉFÉRENCES INTERDITES SANS PREUVE : n'affirme JAMAIS une référence client, un partenariat, une " +
  "certification ou une proximité institutionnelle (BCEAO, banque centrale, régulateurs, opérateurs, " +
  "bailleurs…) qui ne figure pas explicitement dans « Preuves / références NT ». Si cette liste est " +
  "« aucun », NE REVENDIQUE AUCUNE référence — propose plutôt d'en constituer une. " +
  "OFFRES RÉELLES UNIQUEMENT : ne construis JAMAIS une recommandation, un cross-sell ou un chiffrage sur un " +
  "libellé fourre-tout (« AUTRE », « DIVERS », « N/A » ou toute catégorie technique) — même s'il apparaît " +
  "dans l'historique. Nomme une offre concrète et vendable ; à défaut, propose de préciser l'offre.";

// Persona STRATÈGE (retour terrain « c'est superficiel, générique, zéro analyse, juste un rappel des
// données internes »). Le copilote n'est pas un restituteur de données : c'est un stratège de vente et
// de développement de compte. Il INTERPRÈTE, TRANCHE, et livre un coup d'avance.
const STRATEGE =
  "TU ES UN STRATÈGE DE VENTE ET DE DÉVELOPPEMENT DE COMPTE (senior). Le commercial connaît déjà ses " +
  "chiffres : NE LES LUI RÉCITE PAS. Ton travail est de produire l'ANALYSE qu'il n'a pas faite : " +
  "repérer le SCHÉMA (tendance, cadence, corrélation), l'ANOMALIE (deal au point mort, offre dormante, " +
  "concentration risquée), le RISQUE CACHÉ et l'ASYMÉTRIE exploitable. Pose UNE thèse claire, TRANCHE " +
  "(ne liste pas 6 options équivalentes — désigne LE mouvement prioritaire), et donne son IMPACT attendu " +
  "chiffré. Chaque affirmation = une déduction (donnée → implication → action), pas un constat.";

// Anti-verbiage (impératif) : bannit la théorie, la banalité et le remplissage.
const ANTI_VERBIAGE =
  "INTERDIT ABSOLU : théorie de vente générique, banalités (« il faut fidéliser le client », « comprendre " +
  "ses besoins »), phrases applicables à n'importe quel compte, remplissage, reformulation d'une donnée " +
  "déjà fournie sans y ajouter d'interprétation. Si une phrase ne contient PAS une déduction non triviale " +
  "propre à CE compte, supprime-la. Densité maximale : chaque mot doit peser. Ton d'expert direct, jamais " +
  "de langue de bois. " +
  "SENS DES PROPORTIONS (impératif) : calibre TOUJOURS la gravité à l'échelle du compte — exprime une " +
  "exposition/un montant en % du CA réalisé avant de le qualifier. N'appelle pas « critique » ou " +
  "« paralysie » une somme qui pèse < 5% du CA. MOTS BANNIS (n'en emploie AUCUN) : « critique », « urgence " +
  "absolue », « tarissement », « paralysie », « dossier(s) fantôme(s) », « en souffrance », « assainir », " +
  "« cheval de Troie », « bombe à retardement », « alarmant ». Dis le fait et sa conséquence, sobrement. " +
  "MATÉRIALITÉ : ne bâtis JAMAIS la recommandation centrale sur une ligne marginale (< 2% du CA réalisé) — " +
  "une offre dormante minuscule ou un micro-deal mort sont des ACCESSOIRES (à mentionner comme nettoyage/" +
  "détail), jamais le cœur de la stratégie. Le cœur = la plus grosse réserve de valeur adressable.";

// Valeur ajoutée COMMERCIALE (retour terrain « zéro valeur ajoutée, historique mal exploité ») :
// impose d'exploiter l'historique chiffré et de bâtir sur la next-best-offer data-driven.
const HISTO_DIRECTIVE =
  "EXPLOITE L'HISTORIQUE D'ACHAT (obligatoire) : appuie-toi sur les offres déjà vendues et leurs CAS/années — " +
  "cite la plus grosse ligne et son montant comme référence d'ancrage, repère une ligne ancienne (année la plus " +
  "éloignée) à faire renouveler, et fais de la NEXT BEST OFFER indiquée la recommandation centrale. CHIFFRE-la : " +
  "dimensionne-la au panier de référence fourni pour cette offre (ou, à défaut, au CAS d'une ligne comparable du " +
  "compte) et donne ce montant d'ancrage. Si un déclencheur de veille est détecté sur ce compte, sers-t'en comme " +
  "accroche/timing. Le commercial doit y voir une analyse qu'il n'aurait pas faite seul.";

/* ------------------------------------------------------------------------------------------- *
 * Helpers de coercition (miroir de enrich.js — jamais d'undefined vers Firestore)
 * ------------------------------------------------------------------------------------------- */
function coerceStr(v, fallback = "") {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function coerceStrArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
}
function coerceEnum(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}
function list(arr) {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "aucun";
}
// Formatage d'un montant avec la DEVISE du client (audit multi-tenant 2026-07, B10). Défaut « XOF »
// (identique pour Neurones) ; un client onboardé en EUR/USD/… voit ses montants dans SA devise.
function xof(n, currency = "XOF") {
  return Number.isFinite(Number(n)) && Number(n) > 0 ? `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(n)))} ${currency}` : "n.c.";
}
/** Devise à utiliser pour formater les montants d'un contexte compte (ctx.currency, défaut XOF). */
function currencyOf(c) {
  return c && typeof c.currency === "string" && c.currency.trim() ? c.currency.trim() : "XOF";
}
/**
 * marketOf(c) — libellé lisible du MARCHÉ géographique du client, injecté dans le corps des prompts
 * (prospection/contenu) au lieu d'une géo Neurones codée en dur (audit multi-tenant 2026-07, B3).
 * ctx.geographies (profil onboardé) joint, sinon défaut « Côte d'Ivoire / UEMOA ». PUR.
 */
function marketOf(c) {
  const g = c && Array.isArray(c.geographies) ? c.geographies.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  return g.length ? g.join(" / ") : "Côte d'Ivoire / UEMOA";
}
/** Bloc d'empreinte chiffrée réelle (nt360) — matière NON inventable à citer par les agents compte. */
function empreinteChiffree(c) {
  const cur = currencyOf(c);
  return (
    `Empreinte chiffrée réelle (pipeline nt360, à citer telle quelle, ne jamais arrondir ni inventer) : ` +
    `CA total déjà réalisé avec ce compte : ${xof(c.casTotal, cur)} ; ` +
    `pipeline pondéré en cours : ${xof(c.pipelinePondere, cur)} ; ` +
    `affaires déjà gagnées : ${Number(c.wins) > 0 ? c.wins : "n.c."}.`
  );
}

/**
 * Fiche de faits RÉELS du compte (ancrage commun à tous les agents compte, pour la consistance) :
 * offres vendues / en cours / whitespace + empreinte chiffrée + deals nommés. `deals` = opportunités
 * RÉELLES du compte (pas les leads de veille génériques).
 */
function factBase(c) {
  const cur = currencyOf(c);
  // Historique EXPLOITABLE : chaque offre vendue avec son CAS réalisé et sa plage d'années (récence).
  const vendues = (Array.isArray(c.historique) ? c.historique : [])
    .filter((h) => h && h.offre)
    .map((h) => {
      const cas = Number(h.cas) > 0 ? ` — ${xof(h.cas, cur)} réalisés` : "";
      const yrs = h.firstYear ? ` [${h.firstYear === h.lastYear ? h.firstYear : `${h.firstYear}–${h.lastYear}`}]` : "";
      return `${coerceStr(h.offre)}${cas}${yrs}`;
    });
  // Deals enrichis (audit profondeur) : montant + étape + probabilité + date de closing réelle quand
  // disponibles → l'IA peut prioriser et dater. Repli sur le `titre` compact pour les entrées pauvres.
  // Tri par montant décroissant AVANT de borner à 6 : sur un compte à >6 opportunités, un slice non
  // trié pourrait tronquer le plus gros deal avant l'IA — et la stratégie se bâtirait sur le mauvais
  // deal (audit doubler-CA, levier VICTOIRE). On garde donc les 6 plus gros, dans l'ordre.
  const deals = (Array.isArray(c.deals) ? c.deals : [])
    .filter((d) => d && typeof d === "object")
    .slice()
    .sort((a, b) => (Number(b.montant) || 0) - (Number(a.montant) || 0))
    .map((d) => {
      if (d.nom) {
        const parts = [coerceStr(d.nom)];
        if (Number(d.montant) > 0) parts.push(xof(d.montant, cur));
        if (d.etape) parts.push(`stade ${coerceStr(d.etape)}`);
        if (Number(d.probability) > 0) parts.push(`prob. ${Math.round(Number(d.probability) * (Number(d.probability) <= 1 ? 100 : 1))}%`);
        if (d.closingDate) parts.push(`closing ${coerceStr(d.closingDate)}`);
        return parts.join(" · ");
      }
      return coerceStr(d.titre);
    }).filter(Boolean).slice(0, 6);
  const rec = c.recommendation || {};
  const montant = Number(rec.montantEstime) > 0
    ? ` ; panier de référence de cette offre ≈ ${xof(rec.montantEstime, cur)} (montant d'ancrage à viser${rec.anchorCapped ? `, plafonné à l'échelle de ce compte — médiane portefeuille brute ${xof(rec.montantReference, cur)}, à ne pas afficher tel quel` : ""})`
    : "";
  // Cold start (audit 2026-07) : quand l'affinité de cross-sell ne fonde PAS l'offre (csPct=0, ex.
  // compte sans historique ou portefeuille sans co-occurrence), on ne prétend plus « data-driven / à
  // prioriser » — on la présente honnêtement comme une piste à qualifier.
  // Priorité au DÉCLENCHEUR DE VEILLE (passe finale 2026-07) : quand la next best offer est portée par
  // un événement (offre rendue opportune par un signal — EOL, réglementaire, AO), on l'annonce comme
  // pilotée par la demande réelle, pas seulement par l'affinité statistique.
  const reco = rec.offre
    ? (rec.triggeredBy
        ? `— NEXT BEST OFFER PILOTÉE PAR LA VEILLE (offre rendue opportune par un événement de marché — timing à exploiter) : « ${coerceStr(rec.offre)} » — déclenchée par « ${coerceStr(rec.triggeredBy)} »${montant}. À prioriser (fenêtre ouverte).`
        : Number(rec.csPct) > 0
          ? `— NEXT BEST OFFER (recommandation data-driven, affinité de cross-sell sur le portefeuille NT) : « ${coerceStr(rec.offre)} » — ${rec.csPct}% des comptes au profil d'achat comparable la détiennent${montant}. À prioriser dans la recommandation.`
          : `— PISTE DE QUALIFICATION (whitespace non encore étayé par l'affinité portefeuille — aucune donnée de cross-sell exploitable sur ce compte, à confirmer avant d'en faire une priorité) : « ${coerceStr(rec.offre)} »${montant}.`)
    : "";
  // Déclencheurs de veille RATTACHÉS à ce compte (signaux qui le nomment) — timing/accroche commerciale.
  // On rend la MATIÈRE TEMPORELLE (date), le SO-WHAT et l'OFFRE DÉCLENCHÉE quand ils existent : sans
  // eux l'IA ne pouvait produire ni timing ni accroche (audit pertinence 2026-07).
  const renderSignal = (s) => {
    if (!s || typeof s !== "object") return "";
    const titre = coerceStr(s.titre || s.name);
    if (!titre) return "";
    const meta = [];
    if (s.date) meta.push(coerceStr(s.date));
    if (s.prox) meta.push(coerceStr(s.prox));
    const head = meta.length ? `${titre} (${meta.join(" · ")})` : titre;
    const tail = [];
    if (s.soWhat) tail.push(`so-what : ${coerceStr(s.soWhat)}`);
    if (s.offreLiee) tail.push(`offre à activer : ${coerceStr(s.offreLiee)}`);
    return tail.length ? `${head} — ${tail.join(" ; ")}` : head;
  };
  const signauxCompte = (Array.isArray(c.signauxCompte) ? c.signauxCompte : []).map(renderSignal).filter(Boolean).slice(0, 5);
  // Signaux SECTORIELS (passe finale 2026-07) : la demande du marché du secteur du compte (AO, budgets,
  // réglementaire, EOL, fintech, e-gov) ne nomme pas toujours le compte, mais fonde l'accroche métier
  // et l'offre à pousser. Elle etait deja dans le ctx (c.signaux) mais n'etait servie qu'a la prospection
  // et au contenu — pas au plan d'action / CVP / dossier de rentabilite. On l'expose (dédupliquée du
  // rattaché-compte) pour rebrancher signal->action datee la ou ca vend.
  const compteTitres = new Set((Array.isArray(c.signauxCompte) ? c.signauxCompte : []).map((s) => coerceStr(s && (s.titre || s.name))));
  const signauxSecteur = (Array.isArray(c.signaux) ? c.signaux : [])
    .filter((s) => s && !compteTitres.has(coerceStr(s.titre || s.name)))
    .map(renderSignal).filter(Boolean).slice(0, 4);
  return [
    `— Compte : ${coerceStr(c.compte, "(non nommé)")}${c.secteur ? ` — secteur ${coerceStr(c.secteur)}` : ""}${c.tier ? `, compte ${coerceStr(c.tier)}` : ""}.`,
    `— ${empreinteChiffree(c)}`,
    `— Offres NT DÉJÀ vendues (offre — CAS réalisé [années]) : ${list(vendues)}.`,
    `— Travaux / consultations EN COURS : ${list(c.enCours)}.`,
    `— Whitespace = offres NT JAMAIS vendues à ce compte, classées par affinité de cross-sell décroissante : ${list(c.whitespace)}.`,
    reco,
    signauxCompte.length ? `— Déclencheurs de veille détectés sur CE compte (à exploiter comme accroche/timing, ne pas inventer au-delà) : ${list(signauxCompte)}.` : "",
    signauxSecteur.length ? `— Signaux SECTORIELS du marché (demande du secteur, pas encore rattachée à ce compte — à relier à une offre NT si pertinent, sans présumer que le compte est concerné) : ${list(signauxSecteur)}.` : "",
    `— Opportunités réelles en cours (à nommer avec leur montant exact) : ${list(deals)}.`,
    (Array.isArray(c.enjeux) && c.enjeux.length) ? `— Enjeux saisis par le commercial : ${list(c.enjeux)}.` : "",
    magnitudeBlock(c),
  ].filter(Boolean).join("\n");
}

/**
 * Bloc APPRÉCIATION RELATIVE des montants (2026-07) — pré-calculé (domain/magnitude), partagé par TOUS
 * les agents pour garantir la COHÉRENCE des labels et le SENS DES PROPORTIONS (un même montant ne peut
 * pas être « majeur » chez un agent et « dérisoire » chez un autre). L'IA doit REPRENDRE ces labels,
 * jamais les recalculer. Vide si aucune appréciation disponible (compte sans CA réalisé).
 */
function magnitudeBlock(c) {
  const m = c && c.magnitude && typeof c.magnitude === "object" ? c.magnitude : null;
  if (!m) return "";
  const lignes = (Array.isArray(m.montants) ? m.montants : [])
    .filter((x) => x && x.libelle && x.phrase)
    .map((x) => `   · ${coerceStr(x.libelle)} : ${coerceStr(x.phrase)}`);
  const note = m.echelleCompte && m.echelleCompte.note ? coerceStr(m.echelleCompte.note) : "";
  if (!lignes.length && !note) return "";
  return [
    "— APPRÉCIATION RELATIVE DES MONTANTS (pré-calculée — REPRENDS ces qualificatifs tels quels, ne les recalcule pas ; ne présente jamais comme « majeur » un montant étiqueté « dérisoire/modeste », ni l'inverse) :",
    note ? `   · Échelle du compte : ${note}` : "",
    ...lignes,
  ].filter(Boolean).join("\n");
}

/**
 * Le DEAL CIBLE = la plus grosse opportunité en cours (montant décroissant). Injecté explicitement
 * dans les agents mono-deal (dealAnalysis, MEDDIC) pour qu'ils ne bâtissent pas la stratégie sur un
 * deal secondaire quand le compte en a plusieurs (audit doubler-CA, levier VICTOIRE).
 */
function targetDealLine(c) {
  const deals = (Array.isArray(c && c.deals) ? c.deals : []).filter((d) => d && typeof d === "object" && d.nom);
  if (!deals.length) return "";
  const top = deals.slice().sort((a, b) => (Number(b.montant) || 0) - (Number(a.montant) || 0))[0];
  const parts = [coerceStr(top.nom)];
  if (Number(top.montant) > 0) parts.push(xof(top.montant, currencyOf(c)));
  if (top.etape) parts.push(`stade ${coerceStr(top.etape)}`);
  if (top.closingDate) parts.push(`closing ${coerceStr(top.closingDate)}`);
  return `DEAL CIBLE (l'opportunité en cours la plus importante — c'est ELLE que tu analyses/qualifies, sauf faits contraires explicites) : ${parts.join(" · ")}.`;
}

/**
 * Intelligence concurrentielle RÉELLE (battlecards) — bloc partagé injecté dans les agents qui en
 * ont besoin (deal analysis, plan de compte, prospection). Vide si aucune battlecard rattachée.
 */
function competitorBlock(c) {
  const fmtCard = (b) => {
    const seg = [`• ${coerceStr(b.competitor)}`];
    if (b.positioning) seg.push(`positionnement : ${coerceStr(b.positioning)}`);
    if (Array.isArray(b.strengths) && b.strengths.length) seg.push(`forces : ${list(b.strengths)}`);
    if (Array.isArray(b.weaknesses) && b.weaknesses.length) seg.push(`faiblesses à exploiter : ${list(b.weaknesses)}`);
    if (Array.isArray(b.ourWinThemes) && b.ourWinThemes.length) seg.push(`nos axes de victoire : ${list(b.ourWinThemes)}`);
    if (Array.isArray(b.objectionHandling) && b.objectionHandling.length) seg.push(`réponses aux objections : ${list(b.objectionHandling)}`);
    return seg.join(" — ");
  };
  const matched = (Array.isArray(c.battlecards) ? c.battlecards : []).slice(0, 4);
  const market = (Array.isArray(c.battlecardsMarket) ? c.battlecardsMarket : []).slice(0, 3);
  if (!matched.length && !market.length) return "";
  const blocks = [];
  // Confirmés sur le compte : SEULS ceux-ci peuvent être présentés comme « le concurrent en place ».
  if (matched.length) {
    blocks.push(
      `INTELLIGENCE CONCURRENTIELLE — CONCURRENTS CONFIRMÉS SUR CE COMPTE (à mobiliser ; ne pas inventer d'autre concurrent) :\n${matched.map(fmtCard).join("\n")}`
    );
  }
  // Complément marché : concurrents fréquents (loss-rank global) NON confirmés ici — contexte, pas
  // « concurrent en place ». On interdit explicitement à l'IA de les présumer présents sur le deal.
  if (market.length) {
    blocks.push(
      `CONCURRENTS FRÉQUENTS DU MARCHÉ (NON confirmés sur ce compte — contexte uniquement ; ne PAS les présenter comme le concurrent en place ni bâtir de parade en supposant leur présence) :\n${market.map(fmtCard).join("\n")}`
    );
  }
  return blocks.join("\n\n");
}

/** Statistiques de victoire RÉELLES (winLoss) — bloc partagé pour contextualiser probabilité/win-themes. */
function winStatsBlock(c) {
  const w = c.winStats;
  if (!w || (w.global == null && (!Array.isArray(w.byCompetitor) || !w.byCompetitor.length))) return "";
  const parts = [];
  if (w.global != null) parts.push(`Taux de victoire global NT : ${w.global}% (${w.dealsTotal} deals tracés).`);
  if (Array.isArray(w.byCompetitor) && w.byCompetitor.length) {
    parts.push(`Par concurrent : ${w.byCompetitor.map((x) => `${x.competitor} ${x.winPct}% (${x.deals})`).join(" ; ")}.`);
  }
  if (Array.isArray(w.lessons) && w.lessons.length) {
    parts.push(`Leçons récentes gagné/perdu : ${w.lessons.map((l) => `[${l.result}${l.competitor ? "/" + l.competitor : ""}] ${l.lesson}`).join(" ; ")}.`);
  }
  return `HISTORIQUE DE VICTOIRE (winLoss réel, à utiliser pour calibrer la probabilité et les win-themes) :\n${parts.join(" ")}`;
}

/** Modèle de valeur CHIFFRÉ en amont (paniers de référence réels) — pour le business case et le triennal. */
function valueModelBlock(c) {
  const v = c.valueModel;
  if (!v) return "";
  const cur = currencyOf(c);
  const parts = [`CA déjà réalisé : ${xof(v.casTotal, cur)} ; pipeline pondéré : ${xof(v.pipelinePondere, cur)}.`];
  if (v.nextOffer && v.nextOffer.montant > 0) parts.push(`Next best offer « ${coerceStr(v.nextOffer.offre)} » ≈ ${xof(v.nextOffer.montant, cur)} (panier de référence réel).`);
  if (Array.isArray(v.whitespaceValue) && v.whitespaceValue.length) {
    parts.push(`Potentiel cross-sell chiffré (panier de référence par offre) : ${v.whitespaceValue.map((x) => `${coerceStr(x.offre)} ≈ ${xof(x.montant, cur)}`).join(" ; ")} → potentiel total ≈ ${xof(v.whitespacePotential, cur)}.`);
  }
  return `MODÈLE DE VALEUR CHIFFRÉ (montants RÉELS calculés en amont — À CITER TELS QUELS, ne jamais inventer d'autres montants) :\n${parts.join(" ")}`;
}

/** Décideurs / parties prenantes saisis (rôle + posture) — bloc partagé (stakeholder mapping). */
function contactsBlock(c) {
  const contacts = (Array.isArray(c.contacts) ? c.contacts : [])
    .filter((x) => x && (x.nom || x.role))
    .map((x) => `${coerceStr(x.nom || x.role)}${x.role && x.nom ? ` (${coerceStr(x.role)})` : ""}${x.posture ? ` — posture ${coerceStr(x.posture)}` : ""}`);
  return contacts.length ? `Parties prenantes connues : ${list(contacts)}.` : "Parties prenantes : aucune saisie — recommander de les cartographier.";
}

/**
 * Moteur d'analyse PRÉ-CALCULÉE (audit « zéro analyse ») — transforme les données brutes du compte en
 * DIAGNOSTICS interprétés (concentration, dormance/churn, santé des deals, réserve de valeur), que les
 * agents doivent DÉPASSER (pas répéter). PUR : dérivé des faits déjà présents dans le contexte.
 */
function computeAnalytics(c) {
  const histo = (Array.isArray(c.historique) ? c.historique : []).filter((h) => h && h.offre);
  const casTotal = Number(c.casTotal) || histo.reduce((s, h) => s + (Number(h.cas) || 0), 0);
  const out = { concentration: null, topOffre: "", dormantes: [], deals: [], reserve: 0, monoOffre: false };
  if (histo.length && casTotal > 0) {
    const top = histo.slice().sort((a, b) => (Number(b.cas) || 0) - (Number(a.cas) || 0))[0];
    out.topOffre = coerceStr(top.offre);
    out.concentration = Math.round(((Number(top.cas) || 0) / casTotal) * 100);
    out.monoOffre = histo.filter((h) => Number(h.cas) > 0).length <= 1;
  }
  const year = Number(String(c.today || "").slice(0, 4)) || null;
  if (year) {
    // On annote chaque dormante de sa PART de CA → distingue une dormance MATÉRIELLE d'une marginale
    // (ex. FORMATION 1,9 M = 0,07% → accessoire, ne doit pas devenir le cœur de la stratégie).
    out.dormantes = histo
      .filter((h) => Number(h.lastYear) && year - Number(h.lastYear) >= 2)
      .map((h) => {
        const share = casTotal > 0 ? (Number(h.cas) || 0) / casTotal * 100 : 0;
        const tag = share < 2 ? " — marginale, accessoire" : `${share >= 1 ? ` ≈ ${Math.round(share)}% du CA` : ""}`;
        return `${coerceStr(h.offre)} (dernier achat ${h.lastYear}${tag})`;
      });
  }
  const deals = Array.isArray(c.deals) ? c.deals : [];
  // Exposition = somme des deals en cours, exprimée en % du CA réalisé → donne l'échelle (anti-dramatisation).
  const exposition = deals.reduce((s, d) => s + (Number(d && d.montant) > 0 ? Number(d.montant) : 0), 0);
  out.exposition = Math.round(exposition);
  out.expositionPct = casTotal > 0 ? Math.round((exposition / casTotal) * 100) : null;
  out.deals = deals.map((d) => {
    if (!d || typeof d !== "object") return "";
    const nom = coerceStr(d.nom, "deal");
    const p = Number(d.probability);
    const prob = p > 1 ? p / 100 : p;
    if (d.closingDate && c.today && d.closingDate < c.today) return `${nom} : clôture ${d.closingDate} DÉPASSÉE → deal fantôme, à requalifier ou sortir du pipeline`;
    if (Number.isFinite(prob) && prob > 0 && prob < 0.2) return `${nom} : probabilité ${Math.round(prob * 100)}% → au point mort, ne pas y mettre d'énergie sans électrochoc`;
    return "";
  }).filter(Boolean);
  out.reserve = Number(c.valueModel?.whitespacePotential) || 0;
  return out;
}

/** Bloc DIAGNOSTIC pré-calculé injecté dans les agents stratégiques (socle d'analyse à dépasser). */
function analyticsBlock(c) {
  const a = computeAnalytics(c);
  const cur = currencyOf(c);
  const lines = [];
  if (a.concentration != null && a.concentration >= 55) {
    lines.push(`• Concentration : ${a.concentration}% du CA sur « ${a.topOffre} »${a.monoOffre ? " (compte mono-offre)" : ""} → dépendance à interpréter (risque si churn, mais tête de pont pour cross-seller).`);
  }
  if (a.dormantes.length) lines.push(`• Offres DORMANTES (aucun réachat ≥ 2 ans) : ${list(a.dormantes)} → churn silencieux ou fenêtre de relance.`);
  if (a.expositionPct != null && a.exposition > 0) lines.push(`• Exposition pipeline en cours : ${xof(a.exposition, cur)} = ${a.expositionPct}% du CA réalisé → CALIBRE la gravité là-dessus (ne dramatise pas une part < 5%).`);
  if (a.deals.length) lines.push(`• Santé des deals : ${a.deals.join(" ; ")}.`);
  if (a.reserve > 0) lines.push(`• Réserve de valeur non adressée (cross-sell chiffré) : ${xof(a.reserve, cur)}.`);
  if (!lines.length) return "";
  return `DIAGNOSTIC PRÉ-CALCULÉ (données DÉJÀ interprétées — sers-t'en comme socle, va PLUS LOIN, ne le répète pas mot pour mot) :\n${lines.join("\n")}`;
}

/**
 * roleOf(c) — rôle système à injecter dans les prompts copilote : celui du profil client (Phase 0
 * produit, `ctx.systemRole`) s'il est fourni, sinon le défaut Neurones (`NT_ROLE`). Garantie de
 * non-régression : sans surcharge, tous les prompts restent identiques.
 */
function roleOf(c) {
  return c && typeof c.systemRole === "string" && c.systemRole.trim() ? c.systemRole : NT_ROLE;
}

/**
 * differenciateursOf(c) — différenciateurs de marque à injecter dans la CVP / les angles marketing :
 * ceux du PROFIL CLIENT (`ctx.differenciateurs`, produits par l'onboarding depuis le site du client)
 * s'ils sont fournis, sinon le défaut Neurones (`NT_DIFFERENCIATEURS`). MÊME patron que roleOf —
 * rend les générateurs tenant-agnostiques (un client onboardé s'appuie sur SES différenciateurs, plus
 * sur ceux de Neurones codés en dur). Non-régression : sans surcharge, identique pour Neurones.
 */
function differenciateursOf(c) {
  return c && typeof c.differenciateurs === "string" && c.differenciateurs.trim() ? c.differenciateurs : NT_DIFFERENCIATEURS;
}

/**
 * companyNameOf(c) — nom de l'entreprise à écrire dans le CORPS des prompts client-facing (CVP,
 * marketing) : celui du profil client (`ctx.companyName`, onboarding) s'il est fourni, sinon
 * « Neurones Technologies ». MÊME patron que roleOf/differenciateursOf — dernier reliquat du nom en
 * dur, pour qu'un client onboardé n'ait AUCUNE trace de Neurones dans ses livrables. Le rôle système
 * (identité complète + homonymes) reste géré par roleOf(systemRole).
 */
function companyNameOf(c) {
  return c && typeof c.companyName === "string" && c.companyName.trim() ? c.companyName.trim() : "Neurones Technologies";
}

/**
 * buildSystemRole(p) — GÉNÈRE un rôle système à partir d'un profil client (companyName/legalName/
 * sector/geographies/homonyms). Utilisé par l'onboarding / l'auteur d'une config `config/profile`
 * pour produire `profile.systemRole`. PUR. (Ne reproduit pas NT_ROLE mot pour mot : NT garde son
 * NT_ROLE rédigé à la main comme défaut.)
 */
function buildSystemRole(p) {
  const o = p && typeof p === "object" ? p : {};
  const name = coerceStr(o.legalName) || coerceStr(o.companyName) || "l'entreprise";
  const sector = coerceStr(o.sector);
  const geos = Array.isArray(o.geographies) && o.geographies.length ? o.geographies.join("/") : "";
  const homonyms = Array.isArray(o.homonyms) && o.homonyms.length ? o.homonyms.join(", ") : "";
  return (
    `Tu es le copilote commercial de ${name}` +
    (sector ? ` (${sector}` : "") + (geos ? `${sector ? ", " : " ("}zone ${geos}` : "") + (sector || geos ? ")" : "") +
    (homonyms ? `, à NE JAMAIS confondre avec les homonymes : ${homonyms}` : "") +
    ". Tu sers un commercial/DRO. Français, concis, concret, orienté action. Aucune donnée client " +
    "inventée : si une information manque, écris-le explicitement plutôt que de l'estimer. Réponds " +
    "UNIQUEMENT avec un objet JSON valide conforme au schéma demandé, sans texte ni balises autour."
  );
}

/* ------------------------------------------------------------------------------------------- *
 * §B — PROSPECTION (comptes cibles)
 * ------------------------------------------------------------------------------------------- */
const CHALEURS = ["Chaud", "Tiède", "Froid"];

function buildProspectionPrompt(ctx) {
  const c = ctx || {};
  // Ancrage sur le PORTEFEUILLE réel (audit profondeur) : la prospection n'est plus « secteur générique ».
  // Quand un compte est sélectionné, on adosse les cibles à son empreinte réelle (comptes-jumeaux :
  // même secteur, même profil d'achat) et on mobilise l'intelligence concurrentielle.
  const anchor = c.compte
    ? `\nCompte de référence (chercher des JUMEAUX — même secteur / profil d'achat comparable) :\n${factBase(c)}\n${competitorBlock(c)}\n${winStatsBlock(c)}\n`
    : "";
  return `${roleOf(c)}
${anchor}
Propose une liste priorisée de comptes cibles pour le secteur "${coerceStr(c.secteur, "non précisé")}" sur le marché : ${marketOf(c)}.
Tendances d'achat : ${list(c.tendances)}.
Réglementation : ${coerceStr(c.reglementation, "non précisée")}.
Différenciation ${companyNameOf(c)} / concurrence : ${coerceStr(c.concurrence, "non précisée")}.
Signaux de veille exploitables : ${list((c.signaux || []).map((s) => s.titre))}.

Règle anti-invention STRICTE : ne NOMME une entreprise (raison sociale) que si elle est explicitement
citée dans les "Signaux de veille exploitables" ci-dessus. Sinon, décris un PROFIL de compte cible
(secteur précis, taille, critère déclencheur) SANS inventer de raison sociale, de chiffre ni de contact.
Quand un compte de référence est fourni : dimensionne l'accroche et l'offre à proposer sur ce qui a
RÉELLEMENT fonctionné (offres vendues, next best offer, taux de victoire par concurrent), et vise des
comptes au profil comparable. Rends 3 à 4 cibles, en priorisant celles adossées à un signal.
Réponds UNIQUEMENT avec un objet JSON valide :
{
  "cibles": [
    { "nom": string, "source": string, "angle": string, "accroche": string, "offre": string, "chaleur": "Chaud" | "Tiède" | "Froid" }
  ]
}
"source" = le signal exact qui justifie cette cible, ou "profil-type (non nommé)" si aucune source ;
"nom" = raison sociale UNIQUEMENT si sourcée, sinon un libellé de profil (ex. « Banque de détail régionale, >200 agences ») ;
"angle" = pourquoi maintenant / sur quel besoin ; "accroche" = valeur chiffrable si possible ;
"offre" = l'offre ${companyNameOf(c)} à mettre en avant (issue de ce qui marche sur le compte de référence si fourni) ;
"chaleur" = Chaud seulement si un signal/historique le justifie, sinon Tiède/Froid. JSON uniquement.`;
}

function parseProspectionResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.cibles)) return null;
  const cibles = raw.cibles
    .filter((x) => x && typeof x === "object" && coerceStr(x.nom))
    .slice(0, 4)
    .map((x) => {
      const source = coerceStr(x.source);
      return {
        nom: coerceStr(x.nom),
        source,
        angle: coerceStr(x.angle),
        accroche: coerceStr(x.accroche),
        offre: coerceStr(x.offre),
        // Pas de source explicite → on ne laisse pas passer un « Chaud » : une cible non sourcée est froide.
        chaleur: source ? coerceEnum(x.chaleur, CHALEURS, "Froid") : "Froid",
      };
    });
  return cibles.length ? { cibles } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §C — CVP (proposition de valeur) — RÉUTILISE le PESTEL de la veille (ne le régénère pas)
 * ------------------------------------------------------------------------------------------- */
function buildCvpPrompt(ctx) {
  const c = ctx || {};
  // PESTEL réduit à 1 angle : simple garniture facultative, jamais le cœur du message (sinon « copié de la veille »).
  const pestel = (c.pestel || [])
    .filter((p) => p && (p.axe || p.texte))
    .slice(0, 1)
    .map((p) => `${coerceStr(p.axe, "?")} : ${coerceStr(p.texte)}`)
    .join("");
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Rédige la PROPOSITION DE VALEUR de ${companyNameOf(c)} POUR CE CLIENT — un texte destiné à être PRÉSENTÉ AU CLIENT (${coerceStr(c.compte, "le compte")}), pas un mémo interne.
POINT DE VUE CLIENT (impératif) : parle du BÉNÉFICE MÉTIER pour le client, jamais de NOTRE pipeline / NOTRE hygiène commerciale.
INTERDIT dans le message : « notre CA », « notre pipe/pipeline », « deals en souffrance », « dossiers fantômes », « solder/assainir/nettoyer », « diversifier nos points d'ancrage », « urgence absolue », « tarissement », « critique ». Ce sont des considérations INTERNES — elles n'ont pas leur place dans une proposition de valeur.
Les faits réels ci-dessous NOURRISSENT ton angle (ils prouvent que tu connais le client), mais le message reste tourné vers CE QUE TU APPORTES au client :
${factBase(c)}
${valueModelBlock(c)}
Quand tu proposes d'ouvrir une offre, CHIFFRE-la au panier de référence réel ci-dessus (jamais un montant inventé ; « à chiffrer » si absent).

Différenciateurs mobilisables (source unique — à relier chacun à UN enjeu/whitespace/deal NOMMÉ de ce compte, jamais en vrac) :
${differenciateursOf(c)}.
ADAPTATION AU COMPTE (impératif — anti-fixation) : choisis les différenciateurs qui répondent au SECTEUR
et au besoin RÉEL de CE compte, étayés par ses faits/signaux/whitespace. NE mets PAS en avant par défaut
un même partenaire ou produit mono-éditeur si l'enjeu du compte ne l'appelle pas explicitement : une
expertise éditeur n'a sa place que si un besoin nommé la justifie. Varie les angles selon les comptes ;
à défaut de besoin technique nommé, appuie-toi sur les différenciateurs transverses (proximité,
souveraineté de la donnée, modèle managé/récurrent, formation certifiante, références, proximité régulateurs).
ANGLE MÉTIER (lentille innovation) : quand le secteur du compte et son whitespace/ses signaux le permettent, formule la valeur au niveau de la TRANSFORMATION MÉTIER du client (data/IA, RPA, open banking/mobile money & fintech, e-gov/GovTech, IoT/edge, verticaux insurtech/agritech…) et positionne cloud/souveraineté/cybersécurité comme ENABLERS, pas comme finalité — sans inventer de besoin non étayé par les faits.
Preuves / références ${companyNameOf(c)} : ${list(c.preuves)}.${pestel ? `\nAngle de marché (à n'utiliser QUE s'il éclaire un besoin concret de ce compte) : ${pestel}` : ""}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "message": string,                       // 2 phrases ADRESSÉES AU CLIENT : le bénéfice métier concret que ${companyNameOf(c)} lui apporte, avec un angle qui prouve qu'on connaît son contexte (une offre déjà livrée, un enjeu réel) — SANS parler de notre pipeline. Ni slogan creux, ni diagnostic interne.
  "differenciateurs": [string],            // 3 : chacun = un différenciateur ADAPTÉ AU BESOIN DE CE COMPTE, CHOISI dans la liste « Différenciateurs mobilisables » ci-dessus (une expertise éditeur/technique UNIQUEMENT si l'enjeu du compte l'appelle), traduit en BÉNÉFICE pour le client sur un besoin PRÉCIS, chiffré au panier réel si une offre est visée. Formulé côté valeur client. Ne répète pas le même partenaire par défaut d'un compte à l'autre.
  "prochaineEtape": string                 // LA prochaine action commerciale concrète pour matérialiser cette valeur (RDV de cadrage, chiffrage d'une offre nommée, atelier…) — courte, actionnable.
}
JSON uniquement.`;
}

// NO_GENERIC déterministe sur les MONTANTS (audit pertinence 2026-07, étendu audit intégral) :
// l'anti-invention des chiffres XOF ne reposait que sur le texte du prompt. Ici on extrait les
// montants cités et on ANNOTE ceux qui ne correspondent à AUCUN montant réel injecté dans le prompt
// — un montant halluciné est marqué « (chiffre à vérifier) ». L'ensemble autorisé couvre TOUS les
// chiffres réellement placés dans la matière (valueModel MAIS AUSSI deals, historique, recommandation),
// pour ne pas faux-positiver un vrai montant de deal cité. PUR, conservateur (tolérance ±2 %).
function allowedAmountSet(ctx) {
  const s = new Set();
  const add = (n) => { const v = Math.round(Number(n) || 0); if (v > 0) s.add(v); };
  const c = ctx || {};
  // Empreinte chiffrée directe du compte (injectée par empreinteChiffree/factBase).
  add(c.casTotal); add(c.pipelinePondere);
  // Modèle de valeur chiffré (business case / triennal).
  const v = c.valueModel || {};
  add(v.casTotal); add(v.pipelinePondere); add(v.whitespacePotential);
  if (v.nextOffer) add(v.nextOffer.montant);
  for (const w of Array.isArray(v.whitespaceValue) ? v.whitespaceValue : []) add(w.montant);
  // Deals réels nommés avec leur montant exact (factBase les demande « avec leur montant exact »).
  for (const d of Array.isArray(c.deals) ? c.deals : []) if (d && typeof d === "object") add(d.montant);
  // Historique : CAS réalisés par offre vendue.
  for (const h of Array.isArray(c.historique) ? c.historique : []) if (h && typeof h === "object") add(h.cas);
  // Recommandation : panier de référence + médiane portefeuille brute.
  const rec = c.recommendation || {};
  add(rec.montantEstime); add(rec.montantReference);
  return s;
}
// Multiplicateurs textuels d'échelle (« 45 M », « 250 millions », « 1,2 Md ») pour dériver la valeur
// réelle d'un montant abrégé et le comparer à l'ensemble autorisé (audit intégral 2026-07).
const AMOUNT_SCALE = [
  { re: /^(?:milliards?|md|mds)$/i, mult: 1e9 },
  { re: /^(?:millions?|m)$/i, mult: 1e6 },
  { re: /^(?:k)$/i, mult: 1e3 },
];
function scaleOf(unitWord) {
  const u = String(unitWord || "").trim();
  const hit = AMOUNT_SCALE.find((x) => x.re.test(u));
  return hit ? hit.mult : 1;
}
// Parse un montant ecrit a la francaise : la virgule est le separateur DECIMAL (« 1,2 milliard »,
// « 45,5 M »), tandis que l'espace (normal/insecable/fin) et le point sont des separateurs de
// MILLIERS. Sans virgule, on conserve le comportement historique (point/espaces = milliers).
// Renvoie NaN si la chaine est vide. Corrige l'angle mort ou « 1,2 milliard FCFA » etait lu « 2e9 »
// (la partie « 1, » ignoree) et pouvait echapper au flag « (chiffre a verifier) ». PUR.
function parseFrAmount(numStr) {
  const s = String(numStr == null ? "" : numStr).trim();
  if (!s) return NaN;
  if (s.indexOf(",") !== -1) {
    return Number(s.replace(/[ .\xa0 ]/g, "").replace(",", "."));
  }
  return Number(s.replace(/[ .\xa0 ]/g, ""));
}
function annotateStrayAmounts(text, allowed) {
  if (typeof text !== "string" || !text || !allowed || !allowed.size) return text;
  const inAllowed = (val) => [...allowed].some((a) => Math.abs(a - val) <= Math.max(1, a * 0.02));
  // 1) Nombre (virgule decimale FR incluse) + multiplicateur d'echelle optionnel (M / millions / Md /
  //    k) + marqueur monetaire (XOF / FCFA / F CFA / €/EUR / $/USD). Ex. « 1,2 milliard FCFA », « 45,5 M FCFA ».
  let out = text.replace(/(\d[\d .,\xa0 ]*\d|\d)\s*(milliards?|mds?|millions?|m|k)?\s*(?:XOF|FCFA|F\s?CFA|€|EUR|\$|USD)/gi, (m, num, scaleWord) => {
    if (/à vérifier/i.test(m)) return m;
    const val = parseFrAmount(num);
    if (!Number.isFinite(val) || val <= 0) return m;
    const scaled = val * scaleOf(scaleWord);
    return inAllowed(scaled) ? m : `${m} (chiffre à vérifier)`;
  });
  // 2) Nombre + mot d'echelle monetaire (millions/milliards) SANS symbole de devise (« un potentiel de
  //    250 millions ») : contexte fortement monetaire — on flague s'il ne correspond a aucun montant reel.
  out = out.replace(/(\d[\d.,\xa0  ]*\d|\d)\s*(milliards?|mds?|millions?)\b(?!\s*(?:XOF|FCFA|F\s?CFA|€|EUR|\$|USD))/gi, (mm, num2, scaleWord2) => {
    if (/à vérifier/i.test(mm)) return mm;
    const base2 = parseFrAmount(num2);
    if (!Number.isFinite(base2) || base2 <= 0) return mm;
    const scaled2 = base2 * scaleOf(scaleWord2);
    return inAllowed(scaled2) ? mm : `${mm} (chiffre à vérifier)`;
  });
  return out;
}

function parseCvpResponse(raw, ctx) {
  if (!raw || typeof raw !== "object") return null;
  const allowed = allowedAmountSet(ctx);
  const message = annotateStrayAmounts(coerceStr(raw.message), allowed);
  const differenciateurs = coerceStrArray(raw.differenciateurs).map((d) => annotateStrayAmounts(d, allowed));
  const prochaineEtape = annotateStrayAmounts(coerceStr(raw.prochaineEtape), allowed);
  if (!message && !differenciateurs.length) return null;
  return { message, differenciateurs, prochaineEtape };
}

/* ------------------------------------------------------------------------------------------- *
 * §D — PLAN TRIENNAL
 * ------------------------------------------------------------------------------------------- */
const ANNEES = ["An 1", "An 2", "An 3"];

function buildTriennalPrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Bâtis un plan de croissance à 3 ans pour CE compte, à partir de ses faits réels :
${factBase(c)}
${valueModelBlock(c)}
${analyticsBlock(c)}
La trajectoire doit RÉPONDRE au diagnostic (réduire une concentration risquée, réactiver une offre dormante, sécuriser un deal fragile), pas dérouler un plan passe-partout An1/An2/An3.

Logique attendue, ancrée sur SES offres réelles : An 1 = sécuriser/renouveler ce qui est déjà vendu + convertir un deal en cours nommé ;
An 2 = ouvrir 1 offre PRÉCISE du whitespace ci-dessus (cross-sell) ; An 3 = contrat-cadre / partenaire de référence.
Les "offres" citées doivent provenir de l'empreinte réelle (déjà vendu / en cours) ou du whitespace — jamais d'offre générique inventée.
Le "caCible" de chaque année DOIT être cohérent avec le modèle de valeur chiffré ci-dessus (paniers de référence réels) — n'invente aucun autre montant.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "roadmap": [
    { "an": "An 1" | "An 2" | "An 3", "titre": string, "offres": [string], "caCible": string, "jalon": string }
  ]
}
Chaque année : "titre" d'intention lié au compte, 1 à 2 "offres" NOMMÉES (whitespace/en-cours/déjà vendu),
"caCible" = objectif de CA chiffré depuis le modèle de valeur (ex. « ≈ 45 000 000 XOF »), "jalon" mesurable (échéance/preuve). JSON uniquement.`;
}

function parseTriennalResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.roadmap)) return null;
  const roadmap = raw.roadmap
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      an: coerceEnum(x.an, ANNEES, "An 1"),
      titre: coerceStr(x.titre),
      offres: coerceStrArray(x.offres),
      caCible: coerceStr(x.caCible),
      jalon: coerceStr(x.jalon),
    }))
    .filter((x) => x.titre || x.offres.length)
    .slice(0, 3); // An 1/2/3 : jamais plus de 3 lignes
  return roadmap.length ? { roadmap } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §E — PLAN DE COMPTE
 * ------------------------------------------------------------------------------------------- */
const HORIZONS = ["Court terme", "Moyen terme", "Continu"];
const NIVEAUX = ["Élevé", "Moyen", "Faible"];

function buildPlanComptePrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Élabore la STRATÉGIE DE DÉVELOPPEMENT de CE compte (pas une to-do list) à partir de ses faits réels :
${factBase(c)}
${contactsBlock(c)}
${competitorBlock(c)}
${analyticsBlock(c)}
${valueModelBlock(c)}
L'"impact" de chaque mouvement DOIT être chiffré au panier de référence réel ci-dessus (montant XOF), jamais inventé.

Tu es le stratège du compte. Livre une lecture, une thèse et des mouvements tranchés — pas un catalogue d'actions équilibrées.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "diagnostic": string,     // LA lecture stratégique du compte en 1-2 phrases : le schéma/anomalie/asymétrie décisif (ex. « 78% du CA sur ICT, aucun réachat CLOUD depuis 2022 → compte capté mais sous-pénétré, exposé si l'ICT churne »). Interdit : résumé des chiffres.
  "these": string,          // LA thèse de développement : le seul angle qui fait vraiment grandir ce compte dans les 12 mois, et pourquoi lui plutôt qu'un autre.
  "mouvements": [ { "titre": string, "pourquoi": string, "impact": string, "horizon": "Court terme" | "Moyen terme" | "Continu" } ],
  "risquesCaches": [ { "r": string, "m": string, "niv": "Élevé" | "Moyen" | "Faible" } ]
}
"mouvements" = 3 mouvements PRIORITAIRES et tranchés (le 1er = LE coup à jouer maintenant) ; "pourquoi" = la déduction qui le justifie (donnée → implication) ; "impact" = le gain attendu CHIFFRÉ (montant du modèle de valeur / deal débloqué).
"risquesCaches" = 2-3 risques NON évidents propres au compte (concentration, mono-contact, deal fantôme, dormance), avec mitigation (m) et niveau (niv). Zéro risque générique. JSON uniquement.`;
}

function parsePlanCompteResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mouvements = (Array.isArray(raw.mouvements) ? raw.mouvements : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.titre))
    .map((x) => ({ titre: coerceStr(x.titre), pourquoi: coerceStr(x.pourquoi), impact: coerceStr(x.impact), horizon: coerceEnum(x.horizon, HORIZONS, "Continu") }))
    .slice(0, 4);
  const risquesCaches = (Array.isArray(raw.risquesCaches) ? raw.risquesCaches : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.r))
    .map((x) => ({ r: coerceStr(x.r), m: coerceStr(x.m), niv: coerceEnum(x.niv, NIVEAUX, "Moyen") }))
    .slice(0, 4);
  const diagnostic = coerceStr(raw.diagnostic);
  const these = coerceStr(raw.these);
  if (!diagnostic && !these && !mouvements.length) return null;
  return { diagnostic, these, mouvements, risquesCaches };
}

/* ------------------------------------------------------------------------------------------- *
 * §E-bis — PLAN D'ACTION DATÉ (prochains 90 jours). Transforme l'analyse en séquence exécutable :
 * quoi faire, quand, sur quelle offre/deal, appuyé sur quel fait réel. Ancré sur la next best offer,
 * l'historique chiffré et les déclencheurs de veille du compte.
 * ------------------------------------------------------------------------------------------- */
const QUANDS = ["0–30 jours", "30–60 jours", "60–90 jours", "Continu"];

function buildPlanActionPrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Bâtis le PLAN D'ACTION COMMERCIAL des 90 prochains jours pour CE compte, à partir de ses faits réels :
${factBase(c)}
${winStatsBlock(c)}
${analyticsBlock(c)}
Chaque action doit trancher un point du diagnostic (réactiver une dormance, électrochoquer ou sortir un deal au point mort, ouvrir la réserve de cross-sell) — pas des gestes commerciaux passe-partout.
Date du jour : ${coerceStr(c.today, "aujourd'hui")}. Aligne les échéances des actions sur les DATES DE CLOSING réelles des deals ci-dessus quand elles existent (ne pas planifier après une closing).

Exigences : une séquence DATÉE et concrète, pas une liste de bonnes intentions. Chaque action doit :
- porter sur un OBJET nommé (offre déjà vendue à renouveler / offre du whitespace à ouvrir / deal en cours à faire avancer / déclencheur de veille à activer) ;
- être ancrée sur une PREUVE tirée des faits ci-dessus (un montant réel, une année d'achat, un % d'affinité, un signal, une probabilité de deal) ;
- porter une ÉCHÉANCE datée réaliste (semaine ou date calendaire à partir de la date du jour), cohérente avec la closing du deal visé ;
- être séquencée dans le temps : ouvrir/renouveler tôt (0–30 j), instruire (30–60 j), converger (60–90 j).
Fais de la NEXT BEST OFFER l'un des fils conducteurs, avec son montant d'ancrage.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "plan": [
    { "quand": "0–30 jours" | "30–60 jours" | "60–90 jours" | "Continu", "echeance": string, "action": string, "objet": string, "preuve": string }
  ]
}
4 à 6 actions, ordonnées dans le temps ; "echeance" = date ou semaine cible (ex. « S+2 » ou « 2026-08-15 ») ;
"action" = geste commercial précis (RDV, chiffrage, proposition, COPIL, relance) ;
"objet" = l'offre/deal/signal nommé visé ; "preuve" = le fait réel du compte qui la justifie (montant/année/affinité/signal). JSON uniquement.`;
}

// Un plan « daté » ne l'était pas vraiment : « echeance » était une chaîne libre (« S+2 »,
// « semaine prochaine ») qui, à l'ajout au plan suivi, était remplacée par "" côté front → l'action
// devenait « à cadrer ». On NORMALISE l'échéance en date calendaire ISO quand c'est possible (audit
// pertinence 2026-07). PUR.
function normalizeEcheance(raw, todayIso) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  const iso = s.match(/\d{4}-\d{2}-\d{2}/);
  // Date ISO présente MAIS validée : une date calendaire impossible (2026-02-30, 2026-13-40) est
  // rejetée plutôt que propagée dans plan[].echeance (audit final pré-prod 2026-07).
  if (iso) return isValidCalendarDate(iso[0]) ? iso[0] : "";
  const base = Date.parse(typeof todayIso === "string" ? todayIso : "");
  if (Number.isNaN(base)) return "";
  const addDays = (n) => new Date(base + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const wk = s.match(/s\s*\+\s*(\d+)/i); // « S+2 » = 2 semaines
  if (wk) return addDays(Number(wk[1]) * 7);
  const dj = s.match(/j\s*\+\s*(\d+)/i); // « J+10 » = 10 jours
  if (dj) return addDays(Number(dj[1]));
  return ""; // non normalisable → échéance à cadrer (pas de fausse date)
}

// Bucket « quand » dérivé d'une échéance ISO (cohérence avec l'échéance réelle plutôt que le label IA).
function quandFromEcheance(echeanceIso, todayIso) {
  const t = Date.parse(echeanceIso);
  const base = Date.parse(typeof todayIso === "string" ? todayIso : "");
  if (Number.isNaN(t) || Number.isNaN(base)) return null;
  const days = (t - base) / (24 * 60 * 60 * 1000);
  if (days < 30) return "0–30 jours";
  if (days < 60) return "30–60 jours";
  if (days < 90) return "60–90 jours";
  return "Continu";
}

function parsePlanActionResponse(raw, ctx) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plan)) return null;
  const todayIso = ctx && typeof ctx.today === "string" ? ctx.today : "";
  const plan = raw.plan
    .filter((x) => x && typeof x === "object" && coerceStr(x.action))
    .map((x) => {
      const echeance = normalizeEcheance(x.echeance, todayIso);
      // Quand une échéance datée existe, le bucket en découle (sinon on garde le label IA / « Continu »).
      const quand = echeance ? (quandFromEcheance(echeance, todayIso) || coerceEnum(x.quand, QUANDS, "Continu")) : coerceEnum(x.quand, QUANDS, "Continu");
      return {
        quand,
        echeance, // ISO YYYY-MM-DD ou "" (à cadrer — plus jamais « S+2 » non exploitable)
        action: coerceStr(x.action),
        objet: coerceStr(x.objet),
        preuve: coerceStr(x.preuve),
      };
    })
    .slice(0, 6);
  return plan.length ? { plan } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §F — CHAT (multi-turn). Notre moteur ne produit que du JSON → on encapsule la réponse dans
 * { "reply": string } pour rester sur generateJson (aucune nouvelle fonction moteur).
 * ------------------------------------------------------------------------------------------- */
function buildChatSystem(ctx) {
  const c = ctx || {};
  const base =
    // Identité dérivée du profil client (audit multi-tenant 2026-07, B2) — plus de « Neurones/UEMOA/CEMAC »
    // codé en dur : companyNameOf lit ctx.companyName (onboarding), défaut « Neurones Technologies ».
    `Tu es le copilote commercial de ${companyNameOf(c)}. ` +
    "Tu es un STRATÈGE de vente et de développement de compte : tu n'égrènes pas les données (le commercial les a), " +
    "tu les INTERPRÈTES — schéma, anomalie, risque caché — tu poses une thèse, tu tranches et tu donnes le prochain coup. " +
    "Zéro théorie, zéro banalité, zéro remplissage : si une phrase ne contient pas une déduction propre à CE compte, ne l'écris pas. " +
    "Français, dense et actionnable, structuré (puces si utile), 10 lignes max. " +
    "Va au bout du raisonnement : quand on te demande une analyse, cite les chiffres réels, nomme l'offre/le deal/" +
    "le concurrent concerné et termine par la PROCHAINE ACTION précise. " +
    "Ne fournis AUCUNE donnée client (chiffre, contact, budget, échéance) qui ne figure pas dans le " +
    "contexte ci-dessous : si elle manque, dis-le explicitement au lieu de l'estimer. " +
    "Ancre tes réponses sur les FAITS RÉELS du compte ci-dessous (montants, offres vendues, whitespace, deals, " +
    "concurrents, taux de victoire) : cite-les. Pas de généralités macro ni de copier-coller de veille. " +
    "GARDE-FOUS (impératifs) : (1) n'invente AUCUNE référence/partenariat/proximité institutionnelle " +
    "(régulateurs, institutions financières…) absente du contexte ; (2) calibre la gravité à l'échelle — exprime une exposition en % du CA, " +
    "ne dramatise pas une part < 5%, pas de métaphores ; (3) ne recommande jamais une offre fourre-tout (AUTRE, " +
    "DIVERS) : nomme une offre réelle. " +
    `Contexte : écran « ${coerceStr(c.ecran, "Copilote")} ». `;
  // Réutilise la même fiche de faits + l'intelligence concurrentielle/valeur que les autres agents.
  const compte = c.compte
    ? `Faits réels du compte en cours :\n${factBase({
        compte: c.compte.nom,
        secteur: c.compte.secteur,
        tier: c.compte.tier,
        enjeux: c.compte.enjeux,
        historique: c.compte.historique,
        enCours: c.compte.enCours,
        whitespace: c.compte.whitespace,
        casTotal: c.compte.casTotal,
        pipelinePondere: c.compte.pipelinePondere,
        wins: c.compte.wins,
        deals: c.compte.deals || c.compte.signaux,
        recommendation: c.compte.recommendation,
        signauxCompte: c.compte.signauxCompte,
        magnitude: c.compte.magnitude,
      })}\n${competitorBlock(c.compte)}\n${winStatsBlock(c.compte)}\n${valueModelBlock(c.compte)}\n${analyticsBlock(c.compte)}`
    : "Aucun compte précis sélectionné : réponds au niveau méthode/portefeuille, sans inventer de compte.";
  return `${base}\n${compte}`;
}

/** Sérialise l'historique multi-turn en un seul prompt JSON-only (reuse generateJson). */
function buildChatPrompt(ctx, messages) {
  const transcript = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m.content === "string")
    .map((m) => `${m.role === "assistant" ? "Copilote" : "Commercial"} : ${m.content.trim()}`)
    .join("\n");
  return `${buildChatSystem(ctx)}

Conversation jusqu'ici :
${transcript || "(début de conversation)"}

Réponds au dernier message du commercial. Réponds UNIQUEMENT avec un objet JSON valide :
{ "reply": string }
JSON uniquement.`;
}

function parseChatResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const reply = coerceStr(raw.reply);
  return reply ? { reply } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §G — RÉDACTION (email / whatsapp / linkedin, 2 variantes)
 * ------------------------------------------------------------------------------------------- */
const CANAL = {
  email: "E-mail : objet obligatoire, structure claire, 120-180 mots ; en PREMIER contact, signe avec la raison sociale complète de l'entreprise (celle du rôle système ci-dessus) et son ancrage géographique pour lever toute confusion avec d'éventuels homonymes.",
  whatsapp: "WhatsApp : très bref (40-70 mots), 1 idée, appel à l'action simple, pas d'objet.",
  linkedin: "LinkedIn : accroche personnalisée (60-100 mots), ton professionnel, pas d'objet.",
};
const TON = {
  Direct: "ton direct et factuel",
  Institutionnel: "ton institutionnel et posé",
  Chaleureux: "ton chaleureux et relationnel",
};

function buildRedactionPrompt(ctx) {
  const c = ctx || {};
  const canal = CANAL[c.canal] ? c.canal : "email";
  const ton = TON[c.ton] ? c.ton : "Direct";
  // Ancrage sur les faits RÉELS du compte (audit 2026-07) : la Rédaction est le seul contenu envoyé
  // au prospect, elle ne doit pas rester le dernier livrable générique. Dès qu'il y a de la matière,
  // on injecte NO_GENERIC + la même fiche de faits que les autres agents (HISTO_DIRECTIVE volontairement
  // omise : un e-mail/WhatsApp court n'a pas à dérouler l'analyse historique complète).
  const hasCompte =
    coerceStr(c.compte) ||
    (Array.isArray(c.historique) && c.historique.length) ||
    (Array.isArray(c.deals) && c.deals.length) ||
    Number(c.casTotal) > 0;
  const faits = hasCompte
    ? `${NO_GENERIC}\n\nFaits réels du compte (ancrer l'accroche sur UN chiffre réel — CA réalisé / deal en cours — une offre du whitespace, ou un déclencheur de veille rattaché ; ne rien inventer au-delà) :\n${factBase(c)}\n`
    : "";
  // Destinataire nominatif (audit doublement CA) : un message adressé au bon décideur, calé sur la douleur
  // de son rôle, convertit un multiple d'un message générique. La donnée contact est déjà en base.
  const dest = coerceStr(c.destinataire);
  const destBlock = dest
    ? `Destinataire : ${dest}. Ouvre par une salutation NOMINATIVE et cale l'accroche sur la douleur de son rôle (DSI → continuité/sécurité/dette technique ; DAF → coût/ROI/cash ; Achats → conditions/TCO ; DG → impact métier/risque).`
    : `${contactsBlock(c)} Si un décideur est connu ci-dessus, adresse-lui le message nominativement et cale l'angle sur son rôle ; sinon reste au niveau compte sans inventer de nom.`;
  return `${roleOf(c)}
Tu rédiges des messages commerciaux prêts à envoyer.
${faits}
Rédige un message de type "${coerceStr(c.kind, "prise de contact")}" pour le compte ${coerceStr(c.compte, "le compte")}.
${destBlock}
Canal — ${CANAL[canal]}
Ton — ${TON[ton]}.
Contexte fourni (à utiliser SANS rien inventer) : ${coerceStr(c.contexte) || (hasCompte ? "aucun contexte libre — appuie-toi sur les faits réels du compte ci-dessus." : "AUCUN — indique clairement ce qu'il manque au lieu d'inventer.")}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "variantes": [ { "label": string, "objet": string, "corps": string } ]
}
Produis 2 "variantes" à STRATÉGIE DIFFÉRENTE (ex. « relance douce / entretenir » vs « créer l'urgence / provoquer la décision »),
chacune avec un "label" court décrivant la stratégie, un "objet" (vide si canal ≠ email), et le "corps"${hasCompte ? " ; chaque corps doit citer AU MOINS un fait réel du compte (montant, offre vendue, whitespace ou signal)" : ""}. JSON uniquement.`;
}

function parseRedactionResponse(raw, ctx) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.variantes)) return null;
  // WhatsApp/LinkedIn n'ont pas d'objet : on force `objet` à vide hors e-mail (le prompt le demande,
  // le parser le garantit). Et on borne à 2 variantes comme spécifié.
  const isEmail = !ctx || ctx.canal == null || ctx.canal === "email";
  const variantes = raw.variantes
    .filter((x) => x && typeof x === "object" && coerceStr(x.corps))
    .map((x) => ({ label: coerceStr(x.label, "Variante"), objet: isEmail ? coerceStr(x.objet) : "", corps: coerceStr(x.corps) }))
    .slice(0, 2);
  return variantes.length ? { variantes } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §G-bis — CONTENU MARKETING (levier « waouh » n°2 : servir le Directeur Marketing). À partir des
 * signaux de veille + des différenciateurs NT + du secteur, produit des ANGLES DE CONTENU 1:N
 * (posts LinkedIn, tribune) ancrés sur un signal RÉEL et un différenciateur RÉEL — pas du sales 1:1.
 * ------------------------------------------------------------------------------------------- */
function marketSignalsBlock(c) {
  const items = [
    ...(Array.isArray(c.signauxCompte) ? c.signauxCompte : []),
    ...(Array.isArray(c.signaux) ? c.signaux : []),
  ].filter((s) => s && (s.titre || s.title)).slice(0, 8);
  if (!items.length) return "(aucun signal de veille exploitable — dis-le et propose un angle générique prudent, sans inventer d'actualité)";
  return items.map((s) => `- ${coerceStr(s.titre || s.title)}${s.soWhat ? ` — ${coerceStr(s.soWhat)}` : ""}`).join("\n");
}

function buildContenuPrompt(ctx) {
  const c = ctx || {};
  const pestel = (c.pestel || []).filter((p) => p && (p.axe || p.texte)).slice(0, 2)
    .map((p) => `${coerceStr(p.axe, "?")} : ${coerceStr(p.texte)}`).join(" · ");
  return `${roleOf(c)}
Tu es aussi le bras droit du MARKETING de ${companyNameOf(c)}. Tu produis du CONTENU de marque à
diffusion large (1:N), pas un message de vente à un client précis.
${ANTI_VERBIAGE}
${NO_GENERIC}

OBJECTIF : proposer 3 ANGLES DE CONTENU (post LinkedIn ou tribune) qui positionnent ${companyNameOf(c)}
en référence sur son marché (${marketOf(c)}), CHACUN ancré sur (a) un SIGNAL DE
VEILLE réel ci-dessous et (b) UN différenciateur réel. Ton expert, utile, non promotionnel : on
éduque le marché, on ne vend pas frontalement. Interdits : superlatifs creux, « leader incontesté »,
promesses non étayées, chiffres inventés.

Secteur d'éclairage : ${coerceStr(c.secteur, "IT/cyber/cloud, tous secteurs")}.
Signaux de veille (matière — n'invente aucune actualité au-delà de cette liste) :
${marketSignalsBlock(c)}
Différenciateurs mobilisables (relier chaque angle à UN d'entre eux) :
${differenciateursOf(c)}.
${pestel ? `Toile de fond marché (optionnel) : ${pestel}.` : ""}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "angles": [
    {
      "format": "LinkedIn" | "Tribune",
      "titre": string,               // accroche / titre éditorial percutant
      "accroche": string,            // 1re phrase qui arrête le scroll (le "hook")
      "corps": string,               // 4-8 lignes : le propos, l'insight, la valeur — ancré sur le signal + le différenciateur, jamais un argumentaire de vente
      "differenciateur": string,     // LE différenciateur mis en avant, CHOISI dans la liste « Différenciateurs mobilisables » ci-dessus, adapté au signal et au secteur (une expertise éditeur/technique seulement si le signal l'appelle — pas un partenaire par défaut)
      "signalSource": string,        // le signal de veille sur lequel l'angle s'appuie (repris de la liste)
      "cta": string,                 // appel à l'action doux et non commercial (« échangeons », « notre point de vue en commentaire »…)
      "hashtags": [string]           // 3-5 hashtags pertinents
    }
  ]
}
Exactement 3 angles, à ANGLES DIFFÉRENTS (ex. cyber-souveraineté, transformation métier, montée en compétences). JSON uniquement.`;
}

function parseContenuResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.angles)) return null;
  const angles = raw.angles
    .filter((a) => a && typeof a === "object" && coerceStr(a.corps))
    .map((a) => ({
      format: a.format === "Tribune" ? "Tribune" : "LinkedIn",
      titre: coerceStr(a.titre),
      accroche: coerceStr(a.accroche),
      corps: coerceStr(a.corps),
      differenciateur: coerceStr(a.differenciateur),
      signalSource: coerceStr(a.signalSource),
      cta: coerceStr(a.cta),
      hashtags: coerceStrArray(a.hashtags).slice(0, 6),
    }))
    .slice(0, 3);
  return angles.length ? { angles } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §H — QUALIFICATION MEDDIC/BANT (deal). Structure la qualification sur les faits réels du compte
 * et pointe les TROUS à combler + les prochaines actions. Aucun champ inventé : si l'info manque,
 * le champ le dit et devient une action de qualification.
 * ------------------------------------------------------------------------------------------- */
function buildMeddicPrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}

Qualifie l'opportunité principale de CE compte selon MEDDIC (+ note de confiance), à partir de ses faits réels :
${factBase(c)}
${targetDealLine(c)}
${contactsBlock(c)}
${winStatsBlock(c)}
${analyticsBlock(c)}

Règle : chaque critère MEDDIC s'appuie sur un FAIT réel du compte (montant, deal nommé, contact, offre). Si l'information
n'existe pas dans les faits, écris « à qualifier » (jamais d'invention) et ajoute-la dans "trous" + "prochainesActions".

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "metrics": string,            // gains chiffrés visés par le client (ancrés sur un montant/offre réel), ou « à qualifier »
  "economicBuyer": string,      // décideur budgétaire (contact réel) ou « à identifier »
  "decisionCriteria": string,   // critères de choix connus ou « à qualifier »
  "decisionProcess": string,    // processus/échéance (closing réelle si connue) ou « à qualifier »
  "identifiedPain": string,     // douleur/enjeu réel du compte
  "champion": string,           // relais interne (contact réel) ou « à identifier »
  "competition": string,        // concurrent en place (battlecard) ou « inconnu »
  "score": number,              // 0-100 : maturité de qualification
  "verdict": "poursuivre" | "requalifier" | "désengager",  // recommandation TRANCHÉE en croisant le score MEDDIC ET la probabilité/étape réelle du deal
  "blocageCritique": string,    // LE seul critère dont la fermeture fait le plus avancer le deal (le prochain jalon débloquant)
  "trous": [string],            // informations manquantes à combler (2-5)
  "prochainesActions": [string] // 2-4 actions de qualification concrètes et datables
}
JSON uniquement.`;
}
const MEDDIC_VERDICTS = ["poursuivre", "requalifier", "désengager"];
function parseMeddicResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const s = Number(raw.score);
  const out = {
    metrics: coerceStr(raw.metrics, "à qualifier"),
    economicBuyer: coerceStr(raw.economicBuyer, "à identifier"),
    decisionCriteria: coerceStr(raw.decisionCriteria, "à qualifier"),
    decisionProcess: coerceStr(raw.decisionProcess, "à qualifier"),
    identifiedPain: coerceStr(raw.identifiedPain, "à qualifier"),
    champion: coerceStr(raw.champion, "à identifier"),
    competition: coerceStr(raw.competition, "inconnu"),
    score: Number.isFinite(s) ? Math.max(0, Math.min(100, Math.round(s))) : 0,
    verdict: coerceEnum(raw.verdict, MEDDIC_VERDICTS, "requalifier"),
    blocageCritique: coerceStr(raw.blocageCritique),
    trous: coerceStrArray(raw.trous).slice(0, 6),
    prochainesActions: coerceStrArray(raw.prochainesActions).slice(0, 5),
  };
  return (out.metrics || out.identifiedPain || out.prochainesActions.length) ? out : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §I — BRIEF DE RDV. Note de préparation avant rendez-vous : snapshot, deals, objectifs, questions
 * à poser, objections probables + parades (battlecards), prochaines étapes.
 * ------------------------------------------------------------------------------------------- */
function buildBriefPrompt(ctx) {
  const c = ctx || {};
  const objectif = coerceStr(c.contexte) || coerceStr(c.objectif);
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}

Prépare une NOTE DE BRIEF avant un rendez-vous commercial pour CE compte, à partir de ses faits réels :
${factBase(c)}
${contactsBlock(c)}
${competitorBlock(c)}
${analyticsBlock(c)}
Objectif du rendez-vous (si fourni) : ${objectif || "non précisé — proposer l'objectif le plus utile au vu du pipeline"}.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "snapshot": string,               // 2 phrases : où en est la relation (CA réalisé, deals, dernier achat)
  "objectifs": [string],            // 2-3 objectifs concrets du RDV
  "questions": [string],            // 4-6 questions à poser (découverte/qualification), ancrées sur les faits
  "objections": [ { "objection": string, "reponse": string } ], // 2-3, parades issues des battlecards si concurrent connu
  "aValoriser": [string],           // 2-3 preuves/offres/atouts à mettre en avant (offres vendues, next best offer chiffrée)
  "prochainesEtapes": [string]      // 2-3 next steps à obtenir en sortie de RDV
}
JSON uniquement.`;
}
function parseBriefResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const objections = (Array.isArray(raw.objections) ? raw.objections : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.objection))
    .map((x) => ({ objection: coerceStr(x.objection), reponse: coerceStr(x.reponse) }))
    .slice(0, 4);
  const out = {
    snapshot: coerceStr(raw.snapshot),
    objectifs: coerceStrArray(raw.objectifs).slice(0, 4),
    questions: coerceStrArray(raw.questions).slice(0, 7),
    objections,
    aValoriser: coerceStrArray(raw.aValoriser).slice(0, 4),
    prochainesEtapes: coerceStrArray(raw.prochainesEtapes).slice(0, 4),
  };
  return (out.snapshot || out.questions.length) ? out : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §J — ANALYSE DE DEAL & STRATÉGIE DE GAIN. Concurrent en place (battlecard), win-themes (winLoss),
 * probabilité, plan de closing daté sur la closing réelle, objections chiffrées.
 * ------------------------------------------------------------------------------------------- */
const PROBAS = ["Élevée", "Moyenne", "Faible"];
function buildDealAnalysisPrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}

Analyse l'opportunité en cours la plus importante de CE compte et propose une STRATÉGIE DE GAIN, à partir des faits réels :
${factBase(c)}
${targetDealLine(c)}
${competitorBlock(c)}
${winStatsBlock(c)}
${analyticsBlock(c)}
Date du jour : ${coerceStr(c.today, "aujourd'hui")}.

Règle : identifie le deal réel visé (nom + montant). Le "concurrent" doit provenir des battlecards/faits, sinon « inconnu — à qualifier ».
Les "winThemes" s'appuient sur nos axes de victoire réels et les leçons winLoss. Le "planClosing" est daté et cohérent avec la closing réelle.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "deal": string,               // nom + montant du deal visé
  "concurrent": string,         // concurrent en place (battlecard) ou « inconnu — à qualifier »
  "forcesConcurrent": [string], // 1-3 forces adverses à neutraliser
  "parades": [string],          // 2-4 parades concrètes (faiblesses adverses + nos atouts)
  "winThemes": [string],        // 2-4 axes de victoire ancrés (offres vendues, references, winLoss)
  "objections": [ { "objection": string, "reponse": string } ], // 2-3
  "probabilite": "Élevée" | "Moyenne" | "Faible",
  "planClosing": [ { "quand": string, "action": string } ] // 3-5 étapes datées jusqu'à la signature
}
JSON uniquement.`;
}
function parseDealAnalysisResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const objections = (Array.isArray(raw.objections) ? raw.objections : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.objection))
    .map((x) => ({ objection: coerceStr(x.objection), reponse: coerceStr(x.reponse) })).slice(0, 4);
  const planClosing = (Array.isArray(raw.planClosing) ? raw.planClosing : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.action))
    .map((x) => ({ quand: coerceStr(x.quand), action: coerceStr(x.action) })).slice(0, 6);
  const out = {
    deal: coerceStr(raw.deal),
    concurrent: coerceStr(raw.concurrent, "inconnu — à qualifier"),
    forcesConcurrent: coerceStrArray(raw.forcesConcurrent).slice(0, 4),
    parades: coerceStrArray(raw.parades).slice(0, 5),
    winThemes: coerceStrArray(raw.winThemes).slice(0, 5),
    objections,
    probabilite: coerceEnum(raw.probabilite, PROBAS, "Moyenne"),
    planClosing,
  };
  return (out.deal || out.winThemes.length || planClosing.length) ? out : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §K — BUSINESS CASE CHIFFRÉ (ROI). Les montants viennent du MODÈLE DE VALEUR calculé en amont
 * (paniers de référence réels) — l'IA structure le récit, jamais les chiffres.
 * ------------------------------------------------------------------------------------------- */
function buildBusinessCasePrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}

Construis un BUSINESS CASE chiffré pour développer CE compte, à partir de ses faits réels :
${factBase(c)}
${valueModelBlock(c)}
${analyticsBlock(c)}

RÈGLE ABSOLUE SUR LES MONTANTS : n'utilise QUE les montants du "modèle de valeur chiffré" ci-dessus (CA réalisé, next best offer,
paniers de référence par offre, potentiel cross-sell). N'invente AUCUN autre chiffre. Chaque "gain" doit référencer une offre nommée
et son montant de référence. Si le modèle est vide, dis-le et propose une action de qualification chiffrable.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "synthese": string,           // 2 phrases : la valeur en jeu pour ce compte, chiffrée
  "hypotheses": [string],       // 2-3 hypothèses explicites (base de calcul : paniers de référence, cadence de réachat)
  "gains": [ { "levier": string, "montant": string, "base": string } ], // 2-4 : levier=offre nommée, montant=du modèle, base=d'où vient le chiffre
  "potentielTotal": string,     // somme chiffrée du potentiel adressable (du modèle)
  "risques": [string],          // 1-3 risques/conditions de réalisation
  "recommandation": string      // la 1re action pour enclencher la valeur
}
JSON uniquement.`;
}
function parseBusinessCaseResponse(raw, ctx) {
  if (!raw || typeof raw !== "object") return null;
  const allowed = allowedAmountSet(ctx);
  const gains = (Array.isArray(raw.gains) ? raw.gains : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.levier))
    .map((x) => ({ levier: coerceStr(x.levier), montant: annotateStrayAmounts(coerceStr(x.montant), allowed), base: coerceStr(x.base) })).slice(0, 5);
  const out = {
    synthese: annotateStrayAmounts(coerceStr(raw.synthese), allowed),
    hypotheses: coerceStrArray(raw.hypotheses).slice(0, 4),
    gains,
    potentielTotal: annotateStrayAmounts(coerceStr(raw.potentielTotal), allowed),
    risques: coerceStrArray(raw.risques).slice(0, 4),
    recommandation: annotateStrayAmounts(coerceStr(raw.recommandation), allowed),
  };
  return (out.synthese || gains.length) ? out : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §L — SÉQUENCE DE PROSPECTION MULTI-TOUCH DATÉE. Cadence datée depuis aujourd'hui, message par canal.
 * ------------------------------------------------------------------------------------------- */
const SEQ_CANAUX = ["E-mail", "WhatsApp", "LinkedIn", "Appel", "RDV"];
function buildSequencePrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}

Bâtis une SÉQUENCE DE PROSPECTION MULTI-TOUCH datée (cadence 4 à 6 points de contact sur ~3 semaines) pour CE compte, à partir de ses faits réels :
${factBase(c)}
${coerceStr(c.destinataire) ? `Destinataire : ${coerceStr(c.destinataire)} — chaque touche s'adresse nominativement à lui, angle calé sur son rôle.` : contactsBlock(c)}
Date du jour : ${coerceStr(c.today, "aujourd'hui")}. Date chaque touche en jours à partir d'aujourd'hui (J0, J+3, J+7…).

Règle : alterne les canaux, chaque touche a un OBJECTIF distinct (accroche → valeur → preuve → relance → alternative → rupture), et un
message court ANCRÉ sur un fait réel (offre vendue, next best offer chiffrée, signal de veille). Pas de relance vide « je reviens vers vous ».

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "touches": [
    { "jour": string, "canal": "E-mail" | "WhatsApp" | "LinkedIn" | "Appel" | "RDV", "objectif": string, "message": string }
  ]
}
4 à 6 touches. "jour" = ex. « J0 », « J+3 ». "message" = 1-3 phrases prêtes, citant un fait réel. JSON uniquement.`;
}
function parseSequenceResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.touches)) return null;
  const touches = raw.touches
    .filter((x) => x && typeof x === "object" && coerceStr(x.message))
    .map((x) => ({
      jour: coerceStr(x.jour, "J0"),
      canal: coerceEnum(x.canal, SEQ_CANAUX, "E-mail"),
      objectif: coerceStr(x.objectif),
      message: coerceStr(x.message),
    }))
    .slice(0, 6);
  return touches.length ? { touches } : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §M — CARTOGRAPHIE DES PARTIES PRENANTES (stakeholder map) & stratégie multi-thread.
 * ------------------------------------------------------------------------------------------- */
const POUVOIRS = ["Élevé", "Moyen", "Faible"];
const POSTURES = ["Champion", "Favorable", "Neutre", "Sceptique", "Détracteur", "Inconnu"];
function buildStakeholdersPrompt(ctx) {
  const c = ctx || {};
  return `${roleOf(c)}
${STRATEGE}
${ANTI_VERBIAGE}
${NO_GENERIC}

Cartographie les PARTIES PRENANTES de CE compte et propose une stratégie multi-thread, à partir des faits réels :
${factBase(c)}
${contactsBlock(c)}

Règle : ne crée PAS de personne fictive. Repars des contacts saisis ; s'il en manque, liste les RÔLES-CIBLES à identifier
(ex. « DSI — à identifier », « Directeur financier — à identifier ») sans inventer de nom. Qualifie pouvoir et posture.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "parties": [ { "nom": string, "role": string, "pouvoir": "Élevé" | "Moyen" | "Faible", "posture": "Champion" | "Favorable" | "Neutre" | "Sceptique" | "Détracteur" | "Inconnu", "strategie": string } ],
  "champion": string,        // qui cultiver comme relais (ou « à identifier »)
  "risqueRelationnel": string, // le principal risque politique (détracteur, mono-contact…)
  "multiThread": [string]    // 2-3 actions pour élargir la couverture des décideurs
}
3 à 6 "parties". "strategie" = comment engager cette personne/ce rôle. JSON uniquement.`;
}
function parseStakeholdersResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const parties = (Array.isArray(raw.parties) ? raw.parties : [])
    .filter((x) => x && typeof x === "object" && (coerceStr(x.nom) || coerceStr(x.role)))
    .map((x) => ({
      nom: coerceStr(x.nom, coerceStr(x.role, "Partie prenante")),
      role: coerceStr(x.role),
      pouvoir: coerceEnum(x.pouvoir, POUVOIRS, "Moyen"),
      posture: coerceEnum(x.posture, POSTURES, "Inconnu"),
      strategie: coerceStr(x.strategie),
    }))
    .slice(0, 6);
  const out = {
    parties,
    champion: coerceStr(raw.champion, "à identifier"),
    risqueRelationnel: coerceStr(raw.risqueRelationnel),
    multiThread: coerceStrArray(raw.multiThread).slice(0, 4),
  };
  return parties.length ? out : null;
}

/* ------------------------------------------------------------------------------------------- *
 * Registre agent → {build, parse} pour un routage unique côté index.js.
 * ------------------------------------------------------------------------------------------- */
const AGENTS = {
  prospection: { build: buildProspectionPrompt, parse: parseProspectionResponse },
  cvp: { build: buildCvpPrompt, parse: parseCvpResponse },
  triennal: { build: buildTriennalPrompt, parse: parseTriennalResponse },
  planCompte: { build: buildPlanComptePrompt, parse: parsePlanCompteResponse },
  planAction: { build: buildPlanActionPrompt, parse: parsePlanActionResponse },
  redaction: { build: buildRedactionPrompt, parse: parseRedactionResponse },
  contenu: { build: buildContenuPrompt, parse: parseContenuResponse, accountOptional: true },
  // `requiresDeal` : agents MONO-DEAL — sans opportunité ouverte, ils ne produisent qu'une coquille
  // « à qualifier » partout (score 0), qui décrédibilise l'outil. L'appelant les court-circuite avec
  // un message clair au lieu de générer du vide (audit pertinence 2026-07).
  meddic: { build: buildMeddicPrompt, parse: parseMeddicResponse, requiresDeal: true },
  brief: { build: buildBriefPrompt, parse: parseBriefResponse },
  dealAnalysis: { build: buildDealAnalysisPrompt, parse: parseDealAnalysisResponse, requiresDeal: true },
  businessCase: { build: buildBusinessCasePrompt, parse: parseBusinessCaseResponse },
  sequence: { build: buildSequencePrompt, parse: parseSequenceResponse },
  stakeholders: { build: buildStakeholdersPrompt, parse: parseStakeholdersResponse },
};

module.exports = {
  NT_ROLE,
  buildSystemRole,
  AGENTS,
  buildProspectionPrompt, parseProspectionResponse,
  buildCvpPrompt, parseCvpResponse,
  buildTriennalPrompt, parseTriennalResponse,
  buildPlanComptePrompt, parsePlanCompteResponse,
  buildPlanActionPrompt, parsePlanActionResponse,
  buildChatSystem, buildChatPrompt, parseChatResponse,
  buildRedactionPrompt, parseRedactionResponse,
  buildContenuPrompt, parseContenuResponse,
  buildMeddicPrompt, parseMeddicResponse,
  buildBriefPrompt, parseBriefResponse,
  buildDealAnalysisPrompt, parseDealAnalysisResponse,
  buildBusinessCasePrompt, parseBusinessCaseResponse,
  buildSequencePrompt, parseSequenceResponse,
  buildStakeholdersPrompt, parseStakeholdersResponse,
};
