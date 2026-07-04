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

/* ------------------------------------------------------------------------------------------- *
 * Rôle système commun (ANNEXE 02 §A · NT_ROLE)
 * ------------------------------------------------------------------------------------------- */
const NT_ROLE =
  "Tu es le copilote commercial de Neurones Technologies, intégrateur IT/télécom/cybersécurité " +
  "et ESN opérant en zone UEMOA/CEMAC (base Abidjan). Tu sers un commercial/DRO. " +
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
  const deals = (Array.isArray(c.deals) ? c.deals : []).map((d) => coerceStr(d && d.titre)).filter(Boolean).slice(0, 6);
  const rec = c.recommendation || {};
  const montant = Number(rec.montantEstime) > 0 ? ` ; panier de référence de cette offre sur le portefeuille ≈ ${xof(rec.montantEstime)} (montant d'ancrage à viser)` : "";
  const reco = rec.offre
    ? `— NEXT BEST OFFER (recommandation data-driven, affinité de cross-sell sur le portefeuille NT) : « ${coerceStr(rec.offre)} »` +
      `${Number(rec.csPct) > 0 ? ` — ${rec.csPct}% des comptes au profil d'achat comparable la détiennent` : ""}${montant}. À prioriser dans la recommandation.`
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

/* ------------------------------------------------------------------------------------------- *
 * §B — PROSPECTION (comptes cibles)
 * ------------------------------------------------------------------------------------------- */
const CHALEURS = ["Chaud", "Tiède", "Froid"];

function buildProspectionPrompt(ctx) {
  const c = ctx || {};
  return `${NT_ROLE}

Propose une liste priorisée de comptes cibles pour le secteur "${coerceStr(c.secteur, "non précisé")}" en Côte d'Ivoire / Afrique de l'Ouest.
Tendances d'achat : ${list(c.tendances)}.
Réglementation : ${coerceStr(c.reglementation, "non précisée")}.
Différenciation NT / concurrence : ${coerceStr(c.concurrence, "non précisée")}.
Signaux de veille exploitables : ${list((c.signaux || []).map((s) => s.titre))}.

Règle anti-invention STRICTE : ne NOMME une entreprise (raison sociale) que si elle est explicitement
citée dans les "Signaux de veille exploitables" ci-dessus. Sinon, décris un PROFIL de compte cible
(secteur précis, taille, critère déclencheur) SANS inventer de raison sociale, de chiffre ni de contact.
Rends 3 à 4 cibles, en priorisant celles adossées à un signal.
Réponds UNIQUEMENT avec un objet JSON valide :
{
  "cibles": [
    { "nom": string, "source": string, "angle": string, "accroche": string, "chaleur": "Chaud" | "Tiède" | "Froid" }
  ]
}
"source" = le signal exact qui justifie cette cible, ou "profil-type (non nommé)" si aucune source ;
"nom" = raison sociale UNIQUEMENT si sourcée, sinon un libellé de profil (ex. « Banque de détail UEMOA, >200 agences ») ;
"angle" = pourquoi maintenant / sur quel besoin ; "accroche" = valeur chiffrable si possible ;
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

Différenciateurs NT mobilisables (à relier chacun à UN enjeu/whitespace/deal NOMMÉ de ce compte, jamais en vrac) :
proximité locale & souveraineté de la donnée, accréditation PASSI (en cours), modèle managé OPEX, montage en groupement solidaire (chef de file).
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

Logique attendue, ancrée sur SES offres réelles : An 1 = sécuriser/renouveler ce qui est déjà vendu + convertir un deal en cours nommé ;
An 2 = ouvrir 1 offre PRÉCISE du whitespace ci-dessus (cross-sell) ; An 3 = contrat-cadre / partenaire de référence.
Les "offres" citées doivent provenir de l'empreinte réelle (déjà vendu / en cours) ou du whitespace — jamais d'offre générique inventée.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "roadmap": [
    { "an": "An 1" | "An 2" | "An 3", "titre": string, "offres": [string], "jalon": string }
  ]
}
Chaque année : "titre" d'intention lié au compte, 1 à 2 "offres" NOMMÉES (whitespace/en-cours/déjà vendu), "jalon" mesurable (montant ou échéance). JSON uniquement.`;
}

function parseTriennalResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.roadmap)) return null;
  const roadmap = raw.roadmap
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      an: coerceEnum(x.an, ANNEES, "An 1"),
      titre: coerceStr(x.titre),
      offres: coerceStrArray(x.offres),
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
  const contacts = (c.contacts || [])
    .filter((x) => x && x.role)
    .map((x) => `${coerceStr(x.role)} (${coerceStr(x.posture, "?")})`);
  return `${NT_ROLE}
${NO_GENERIC}
${HISTO_DIRECTIVE}

Rédige le cœur d'un plan de compte pour CE compte, à partir de ses faits réels :
${factBase(c)}
Décideurs connus : ${list(contacts)}.

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

Exigences : une séquence DATÉE et concrète, pas une liste de bonnes intentions. Chaque action doit :
- porter sur un OBJET nommé (offre déjà vendue à renouveler / offre du whitespace à ouvrir / deal en cours à faire avancer / déclencheur de veille à activer) ;
- être ancrée sur une PREUVE tirée des faits ci-dessus (un montant réel, une année d'achat, un % d'affinité, un signal) ;
- être séquencée dans le temps : ouvrir/renouveler tôt (0–30 j), instruire (30–60 j), converger (60–90 j).
Fais de la NEXT BEST OFFER l'un des fils conducteurs, avec son montant d'ancrage.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "plan": [
    { "quand": "0–30 jours" | "30–60 jours" | "60–90 jours" | "Continu", "action": string, "objet": string, "preuve": string }
  ]
}
4 à 6 actions, ordonnées dans le temps ; "action" = geste commercial précis (RDV, chiffrage, proposition, COPIL, relance) ;
"objet" = l'offre/deal/signal nommé visé ; "preuve" = le fait réel du compte qui la justifie (montant/année/affinité/signal). JSON uniquement.`;
}

function parsePlanActionResponse(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plan)) return null;
  const plan = raw.plan
    .filter((x) => x && typeof x === "object" && coerceStr(x.action))
    .map((x) => ({
      quand: coerceEnum(x.quand, QUANDS, "Continu"),
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
    "Tu aides un commercial à préparer ses RDV, bâtir ses argumentaires et ses plans de compte. " +
    "Français, très concis (max 6 lignes), concret et actionnable. " +
    "Ne fournis AUCUNE donnée client (chiffre, contact, budget, échéance) qui ne figure pas dans le " +
    "contexte ci-dessous : si elle manque, dis-le explicitement au lieu de l'estimer. " +
    "Ancre tes réponses sur les FAITS RÉELS du compte ci-dessous (montants, offres vendues, whitespace, deals) : " +
    "cite-les. Pas de généralités macro ni de copier-coller de veille. " +
    `Contexte : écran « ${coerceStr(c.ecran, "Copilote")} ». `;
  // Réutilise la même fiche de faits que les autres agents (consistance) quand un compte est fourni.
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
      })}`
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
  email: "E-mail : objet obligatoire, structure claire, 120-180 mots, signature neutre.",
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
  return `${NT_ROLE}
Tu rédiges des messages commerciaux prêts à envoyer.

Rédige un message de type "${coerceStr(c.kind, "prise de contact")}" pour le compte ${coerceStr(c.compte, "le compte")}.
Canal — ${CANAL[canal]}
Ton — ${TON[ton]}.
Contexte fourni (à utiliser SANS rien inventer) : ${coerceStr(c.contexte) || "AUCUN — indique clairement ce qu'il manque au lieu d'inventer."}

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "variantes": [ { "label": string, "objet": string, "corps": string } ]
}
Produis 2 "variantes" à STRATÉGIE DIFFÉRENTE (ex. « relance douce / entretenir » vs « créer l'urgence / provoquer la décision »),
chacune avec un "label" court décrivant la stratégie, un "objet" (vide si canal ≠ email), et le "corps". JSON uniquement.`;
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
 * Registre agent → {build, parse} pour un routage unique côté index.js.
 * ------------------------------------------------------------------------------------------- */
const AGENTS = {
  prospection: { build: buildProspectionPrompt, parse: parseProspectionResponse },
  cvp: { build: buildCvpPrompt, parse: parseCvpResponse },
  triennal: { build: buildTriennalPrompt, parse: parseTriennalResponse },
  planCompte: { build: buildPlanComptePrompt, parse: parsePlanCompteResponse },
  planAction: { build: buildPlanActionPrompt, parse: parsePlanActionResponse },
  redaction: { build: buildRedactionPrompt, parse: parseRedactionResponse },
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
};
