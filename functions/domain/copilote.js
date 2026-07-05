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
  "compte, dis-le franchement et propose une action de QUALIFICATION plutôt que d'inventer ou de meubler.";

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
function xof(n) {
  return Number.isFinite(Number(n)) && Number(n) > 0 ? `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(n)))} XOF` : "n.c.";
}
/** Bloc d'empreinte chiffrée réelle (nt360) — matière NON inventable à citer par les agents compte. */
function empreinteChiffree(c) {
  return (
    `Empreinte chiffrée réelle (pipeline nt360, à citer telle quelle, ne jamais arrondir ni inventer) : ` +
    `CA total déjà réalisé avec ce compte : ${xof(c.casTotal)} ; ` +
    `pipeline pondéré en cours : ${xof(c.pipelinePondere)} ; ` +
    `affaires déjà gagnées : ${Number(c.wins) > 0 ? c.wins : "n.c."}.`
  );
}

/**
 * Fiche de faits RÉELS du compte (ancrage commun à tous les agents compte, pour la consistance) :
 * offres vendues / en cours / whitespace + empreinte chiffrée + deals nommés. `deals` = opportunités
 * RÉELLES du compte (pas les leads de veille génériques).
 */
function factBase(c) {
  // Historique EXPLOITABLE : chaque offre vendue avec son CAS réalisé et sa plage d'années (récence).
  const vendues = (Array.isArray(c.historique) ? c.historique : [])
    .filter((h) => h && h.offre)
    .map((h) => {
      const cas = Number(h.cas) > 0 ? ` — ${xof(h.cas)} réalisés` : "";
      const yrs = h.firstYear ? ` [${h.firstYear === h.lastYear ? h.firstYear : `${h.firstYear}–${h.lastYear}`}]` : "";
      return `${coerceStr(h.offre)}${cas}${yrs}`;
    });
  // Deals enrichis (audit profondeur) : montant + étape + probabilité + date de closing réelle quand
  // disponibles → l'IA peut prioriser et dater. Repli sur le `titre` compact pour les entrées pauvres.
  const deals = (Array.isArray(c.deals) ? c.deals : []).map((d) => {
    if (!d || typeof d !== "object") return "";
    if (d.nom) {
      const parts = [coerceStr(d.nom)];
      if (Number(d.montant) > 0) parts.push(xof(d.montant));
      if (d.etape) parts.push(`stade ${coerceStr(d.etape)}`);
      if (Number(d.probability) > 0) parts.push(`prob. ${Math.round(Number(d.probability) * (Number(d.probability) <= 1 ? 100 : 1))}%`);
      if (d.closingDate) parts.push(`closing ${coerceStr(d.closingDate)}`);
      return parts.join(" · ");
    }
    return coerceStr(d.titre);
  }).filter(Boolean).slice(0, 6);
  const rec = c.recommendation || {};
  const montant = Number(rec.montantEstime) > 0 ? ` ; panier de référence de cette offre sur le portefeuille ≈ ${xof(rec.montantEstime)} (montant d'ancrage à viser)` : "";
  // Cold start (audit 2026-07) : quand l'affinité de cross-sell ne fonde PAS l'offre (csPct=0, ex.
  // compte sans historique ou portefeuille sans co-occurrence), on ne prétend plus « data-driven / à
  // prioriser » — on la présente honnêtement comme une piste à qualifier.
  const reco = rec.offre
    ? (Number(rec.csPct) > 0
        ? `— NEXT BEST OFFER (recommandation data-driven, affinité de cross-sell sur le portefeuille NT) : « ${coerceStr(rec.offre)} » — ${rec.csPct}% des comptes au profil d'achat comparable la détiennent${montant}. À prioriser dans la recommandation.`
        : `— PISTE DE QUALIFICATION (whitespace non encore étayé par l'affinité portefeuille — aucune donnée de cross-sell exploitable sur ce compte, à confirmer avant d'en faire une priorité) : « ${coerceStr(rec.offre)} »${montant}.`)
    : "";
  // Déclencheurs de veille RATTACHÉS à ce compte (signaux qui le nomment) — timing/accroche commerciale.
  const signauxCompte = (Array.isArray(c.signauxCompte) ? c.signauxCompte : [])
    .map((s) => coerceStr(s && (s.titre || s.name))).filter(Boolean).slice(0, 5);
  return [
    `— Compte : ${coerceStr(c.compte, "(non nommé)")}${c.secteur ? ` — secteur ${coerceStr(c.secteur)}` : ""}${c.tier ? `, compte ${coerceStr(c.tier)}` : ""}.`,
    `— ${empreinteChiffree(c)}`,
    `— Offres NT DÉJÀ vendues (offre — CAS réalisé [années]) : ${list(vendues)}.`,
    `— Travaux / consultations EN COURS : ${list(c.enCours)}.`,
    `— Whitespace = offres NT JAMAIS vendues à ce compte, classées par affinité de cross-sell décroissante : ${list(c.whitespace)}.`,
    reco,
    signauxCompte.length ? `— Déclencheurs de veille détectés sur CE compte (à exploiter comme accroche/timing, ne pas inventer au-delà) : ${list(signauxCompte)}.` : "",
    `— Opportunités réelles en cours (à nommer avec leur montant exact) : ${list(deals)}.`,
    (Array.isArray(c.enjeux) && c.enjeux.length) ? `— Enjeux saisis par le commercial : ${list(c.enjeux)}.` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Intelligence concurrentielle RÉELLE (battlecards) — bloc partagé injecté dans les agents qui en
 * ont besoin (deal analysis, plan de compte, prospection). Vide si aucune battlecard rattachée.
 */
function competitorBlock(c) {
  const bc = Array.isArray(c.battlecards) ? c.battlecards : [];
  if (!bc.length) return "";
  const lines = bc.slice(0, 4).map((b) => {
    const seg = [`• ${coerceStr(b.competitor)}`];
    if (b.positioning) seg.push(`positionnement : ${coerceStr(b.positioning)}`);
    if (Array.isArray(b.strengths) && b.strengths.length) seg.push(`forces : ${list(b.strengths)}`);
    if (Array.isArray(b.weaknesses) && b.weaknesses.length) seg.push(`faiblesses à exploiter : ${list(b.weaknesses)}`);
    if (Array.isArray(b.ourWinThemes) && b.ourWinThemes.length) seg.push(`nos axes de victoire : ${list(b.ourWinThemes)}`);
    if (Array.isArray(b.objectionHandling) && b.objectionHandling.length) seg.push(`réponses aux objections : ${list(b.objectionHandling)}`);
    return seg.join(" — ");
  });
  return `INTELLIGENCE CONCURRENTIELLE (battlecards réelles, à mobiliser — ne pas inventer d'autre concurrent) :\n${lines.join("\n")}`;
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
  const parts = [`CA déjà réalisé : ${xof(v.casTotal)} ; pipeline pondéré : ${xof(v.pipelinePondere)}.`];
  if (v.nextOffer && v.nextOffer.montant > 0) parts.push(`Next best offer « ${coerceStr(v.nextOffer.offre)} » ≈ ${xof(v.nextOffer.montant)} (panier de référence réel).`);
  if (Array.isArray(v.whitespaceValue) && v.whitespaceValue.length) {
    parts.push(`Potentiel cross-sell chiffré (panier de référence par offre) : ${v.whitespaceValue.map((x) => `${coerceStr(x.offre)} ≈ ${xof(x.montant)}`).join(" ; ")} → potentiel total ≈ ${xof(v.whitespacePotential)}.`);
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
  return `${NT_ROLE}
${anchor}
Propose une liste priorisée de comptes cibles pour le secteur "${coerceStr(c.secteur, "non précisé")}" en Côte d'Ivoire / Afrique de l'Ouest.
Tendances d'achat : ${list(c.tendances)}.
Réglementation : ${coerceStr(c.reglementation, "non précisée")}.
Différenciation NT / concurrence : ${coerceStr(c.concurrence, "non précisée")}.
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
"nom" = raison sociale UNIQUEMENT si sourcée, sinon un libellé de profil (ex. « Banque de détail UEMOA, >200 agences ») ;
"angle" = pourquoi maintenant / sur quel besoin ; "accroche" = valeur chiffrable si possible ;
"offre" = l'offre NT à mettre en avant (issue de ce qui marche sur le compte de référence si fourni) ;
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
  return `${NT_ROLE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Construis la proposition de valeur de Neurones Technologies pour CE compte, en t'appuyant STRICTEMENT sur ses faits réels :
${factBase(c)}

Différenciateurs NT mobilisables (source unique — à relier chacun à UN enjeu/whitespace/deal NOMMÉ de ce compte, jamais en vrac ; Neurones Academy est un levier de cross-sell/ancrage à ne pas oublier) :
${NT_DIFFERENCIATEURS}.
ANGLE MÉTIER (lentille innovation) : quand le secteur du compte et son whitespace/ses signaux le permettent, formule la valeur au niveau de la TRANSFORMATION MÉTIER du client (data/IA, RPA, open banking/mobile money & fintech, e-gov/GovTech, IoT/edge, verticaux insurtech/agritech…) et positionne cloud/souveraineté/cybersécurité comme ENABLERS, pas comme finalité — sans inventer de besoin non étayé par les faits.
Preuves / références NT : ${list(c.preuves)}.${pestel ? `\nAngle de marché (à n'utiliser QUE s'il éclaire un besoin concret de ce compte) : ${pestel}` : ""}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "message": string,                       // 2 phrases : cite le compte + un chiffre réel (CA réalisé OU un deal en cours) + l'offre whitespace à ouvrir
  "differenciateurs": [string]             // 3 : chacun relie UN différenciateur NT à UN enjeu/whitespace/deal nommé de CE compte (aucun différenciateur générique)
}
JSON uniquement.`;
}

function parseCvpResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const message = coerceStr(raw.message);
  const differenciateurs = coerceStrArray(raw.differenciateurs);
  if (!message && !differenciateurs.length) return null;
  return { message, differenciateurs };
}

/* ------------------------------------------------------------------------------------------- *
 * §D — PLAN TRIENNAL
 * ------------------------------------------------------------------------------------------- */
const ANNEES = ["An 1", "An 2", "An 3"];

function buildTriennalPrompt(ctx) {
  const c = ctx || {};
  return `${NT_ROLE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Bâtis un plan de croissance à 3 ans pour CE compte, à partir de ses faits réels :
${factBase(c)}
${valueModelBlock(c)}

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
  return `${NT_ROLE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Rédige le cœur d'un plan de compte pour CE compte, à partir de ses faits réels :
${factBase(c)}
${contactsBlock(c)}
${competitorBlock(c)}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "actions": [ { "libelle": string, "horizon": "Court terme" | "Moyen terme" | "Continu" } ],
  "risques": [ { "r": string, "m": string, "niv": "Élevé" | "Moyen" | "Faible" } ]
}
4 "actions" priorisées et SPÉCIFIQUES à ce compte : chacune cite une offre (déjà vendue / en cours / whitespace) ou un deal nommé ;
au moins une action d'OUVERTURE sur une offre PRÉCISE du whitespace, et une de gouvernance/COPIL sur le compte.
3 "risques" (r) réels du compte avec mitigation (m) et niveau (niv) — pas de risque générique ("concurrence", "budget") sans lien nommé au compte. JSON uniquement.`;
}

function parsePlanCompteResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.libelle))
    .map((x) => ({ libelle: coerceStr(x.libelle), horizon: coerceEnum(x.horizon, HORIZONS, "Continu") }))
    .slice(0, 6);
  const risques = (Array.isArray(raw.risques) ? raw.risques : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.r))
    .map((x) => ({ r: coerceStr(x.r), m: coerceStr(x.m), niv: coerceEnum(x.niv, NIVEAUX, "Moyen") }))
    .slice(0, 5);
  if (!actions.length && !risques.length) return null;
  return { actions, risques };
}

/* ------------------------------------------------------------------------------------------- *
 * §E-bis — PLAN D'ACTION DATÉ (prochains 90 jours). Transforme l'analyse en séquence exécutable :
 * quoi faire, quand, sur quelle offre/deal, appuyé sur quel fait réel. Ancré sur la next best offer,
 * l'historique chiffré et les déclencheurs de veille du compte.
 * ------------------------------------------------------------------------------------------- */
const QUANDS = ["0–30 jours", "30–60 jours", "60–90 jours", "Continu"];

function buildPlanActionPrompt(ctx) {
  const c = ctx || {};
  return `${NT_ROLE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Bâtis le PLAN D'ACTION COMMERCIAL des 90 prochains jours pour CE compte, à partir de ses faits réels :
${factBase(c)}
${winStatsBlock(c)}
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

function parsePlanActionResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plan)) return null;
  const plan = raw.plan
    .filter((x) => x && typeof x === "object" && coerceStr(x.action))
    .map((x) => ({
      quand: coerceEnum(x.quand, QUANDS, "Continu"),
      echeance: coerceStr(x.echeance),
      action: coerceStr(x.action),
      objet: coerceStr(x.objet),
      preuve: coerceStr(x.preuve),
    }))
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
    "Tu es le copilote commercial de Neurones Technologies (intégrateur IT/télécom/cyber, zone UEMOA/CEMAC). " +
    "Tu aides un commercial à préparer ses RDV, bâtir ses argumentaires, ses plans de compte, qualifier ses deals " +
    "et contrer ses concurrents. Français, concret et actionnable, structuré (puces si utile), 10 lignes max. " +
    "Va au bout du raisonnement : quand on te demande une analyse, cite les chiffres réels, nomme l'offre/le deal/" +
    "le concurrent concerné et termine par la PROCHAINE ACTION précise. " +
    "Ne fournis AUCUNE donnée client (chiffre, contact, budget, échéance) qui ne figure pas dans le " +
    "contexte ci-dessous : si elle manque, dis-le explicitement au lieu de l'estimer. " +
    "Ancre tes réponses sur les FAITS RÉELS du compte ci-dessous (montants, offres vendues, whitespace, deals, " +
    "concurrents, taux de victoire) : cite-les. Pas de généralités macro ni de copier-coller de veille. " +
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
      })}\n${competitorBlock(c.compte)}\n${winStatsBlock(c.compte)}\n${valueModelBlock(c.compte)}`
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
  email: "E-mail : objet obligatoire, structure claire, 120-180 mots ; en PREMIER contact, signe avec la raison sociale complète « Neurones Technologies S.A. » et l'ancrage géographique (Abidjan, Côte d'Ivoire / UEMOA) pour lever toute confusion avec les homonymes.",
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
  return `${NT_ROLE}
Tu rédiges des messages commerciaux prêts à envoyer.
${faits}
Rédige un message de type "${coerceStr(c.kind, "prise de contact")}" pour le compte ${coerceStr(c.compte, "le compte")}.
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
 * §H — QUALIFICATION MEDDIC/BANT (deal). Structure la qualification sur les faits réels du compte
 * et pointe les TROUS à combler + les prochaines actions. Aucun champ inventé : si l'info manque,
 * le champ le dit et devient une action de qualification.
 * ------------------------------------------------------------------------------------------- */
function buildMeddicPrompt(ctx) {
  const c = ctx || {};
  return `${NT_ROLE}
${NO_GENERIC}

Qualifie l'opportunité principale de CE compte selon MEDDIC (+ note de confiance), à partir de ses faits réels :
${factBase(c)}
${contactsBlock(c)}
${winStatsBlock(c)}

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
  "trous": [string],            // informations manquantes à combler (2-5)
  "prochainesActions": [string] // 2-4 actions de qualification concrètes et datables
}
JSON uniquement.`;
}
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
  return `${NT_ROLE}
${NO_GENERIC}

Prépare une NOTE DE BRIEF avant un rendez-vous commercial pour CE compte, à partir de ses faits réels :
${factBase(c)}
${contactsBlock(c)}
${competitorBlock(c)}
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
  return `${NT_ROLE}
${NO_GENERIC}

Analyse l'opportunité en cours la plus importante de CE compte et propose une STRATÉGIE DE GAIN, à partir des faits réels :
${factBase(c)}
${competitorBlock(c)}
${winStatsBlock(c)}
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
  return `${NT_ROLE}
${NO_GENERIC}

Construis un BUSINESS CASE chiffré pour développer CE compte, à partir de ses faits réels :
${factBase(c)}
${valueModelBlock(c)}

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
function parseBusinessCaseResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const gains = (Array.isArray(raw.gains) ? raw.gains : [])
    .filter((x) => x && typeof x === "object" && coerceStr(x.levier))
    .map((x) => ({ levier: coerceStr(x.levier), montant: coerceStr(x.montant), base: coerceStr(x.base) })).slice(0, 5);
  const out = {
    synthese: coerceStr(raw.synthese),
    hypotheses: coerceStrArray(raw.hypotheses).slice(0, 4),
    gains,
    potentielTotal: coerceStr(raw.potentielTotal),
    risques: coerceStrArray(raw.risques).slice(0, 4),
    recommandation: coerceStr(raw.recommandation),
  };
  return (out.synthese || gains.length) ? out : null;
}

/* ------------------------------------------------------------------------------------------- *
 * §L — SÉQUENCE DE PROSPECTION MULTI-TOUCH DATÉE. Cadence datée depuis aujourd'hui, message par canal.
 * ------------------------------------------------------------------------------------------- */
const SEQ_CANAUX = ["E-mail", "WhatsApp", "LinkedIn", "Appel", "RDV"];
function buildSequencePrompt(ctx) {
  const c = ctx || {};
  return `${NT_ROLE}
${NO_GENERIC}

Bâtis une SÉQUENCE DE PROSPECTION MULTI-TOUCH datée (cadence 4 à 6 points de contact sur ~3 semaines) pour CE compte, à partir de ses faits réels :
${factBase(c)}
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
  return `${NT_ROLE}
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
  meddic: { build: buildMeddicPrompt, parse: parseMeddicResponse },
  brief: { build: buildBriefPrompt, parse: parseBriefResponse },
  dealAnalysis: { build: buildDealAnalysisPrompt, parse: parseDealAnalysisResponse },
  businessCase: { build: buildBusinessCasePrompt, parse: parseBusinessCaseResponse },
  sequence: { build: buildSequencePrompt, parse: parseSequenceResponse },
  stakeholders: { build: buildStakeholdersPrompt, parse: parseStakeholdersResponse },
};

module.exports = {
  NT_ROLE,
  AGENTS,
  buildProspectionPrompt, parseProspectionResponse,
  buildCvpPrompt, parseCvpResponse,
  buildTriennalPrompt, parseTriennalResponse,
  buildPlanComptePrompt, parsePlanCompteResponse,
  buildPlanActionPrompt, parsePlanActionResponse,
  buildChatSystem, buildChatPrompt, parseChatResponse,
  buildRedactionPrompt, parseRedactionResponse,
  buildMeddicPrompt, parseMeddicResponse,
  buildBriefPrompt, parseBriefResponse,
  buildDealAnalysisPrompt, parseDealAnalysisResponse,
  buildBusinessCasePrompt, parseBusinessCaseResponse,
  buildSequencePrompt, parseSequenceResponse,
  buildStakeholdersPrompt, parseStakeholdersResponse,
};
