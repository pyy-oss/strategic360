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
  const pestel = (c.pestel || [])
    .filter((p) => p && (p.axe || p.texte))
    .map((p) => `- ${coerceStr(p.axe, "?")} : ${coerceStr(p.texte)}`)
    .join("\n");
  return `${NT_ROLE}

Construis la proposition de valeur de Neurones Technologies pour ${coerceStr(c.compte, "le compte")} (${coerceStr(c.secteur, "secteur non précisé")}).
Enjeux client : ${list(c.enjeux)}.
Whitespace (offres non encore vendues) : ${list(c.whitespace)}.
${empreinteChiffree(c)}
Opportunités réelles en cours sur ce compte : ${list((c.signaux || []).map((s) => s.titre))}.
Contexte PESTEL (déjà établi par la veille, à EXPLOITER, pas à réécrire) :
${pestel || "- (aucun PESTEL disponible)"}
Preuves / références NT mobilisables : ${list(c.preuves)}.
Différenciateurs NT à valoriser : proximité locale, accréditation PASSI (en cours), modèle managé OPEX,
montages en groupement solidaire (chef de file).

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "message": string,                       // 2 phrases nommant le compte et son enjeu prioritaire
  "differenciateurs": [string]             // 3 différenciateurs concrets reliés aux enjeux
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
  const histo = (c.historique || [])
    .filter((h) => h && h.offre)
    .map((h) => `${coerceStr(h.offre)} (${coerceStr(h.statut, "?")})`);
  return `${NT_ROLE}

Bâtis un plan de croissance à 3 ans pour le compte ${coerceStr(c.compte, "le compte")} (${coerceStr(c.secteur, "secteur")}) chez Neurones Technologies.
Empreinte actuelle (offres déjà vendues) : ${list(histo)}.
${empreinteChiffree(c)}
Travaux en cours : ${list(c.enCours)}.
Whitespace à conquérir : ${list(c.whitespace)}.
Logique attendue : An 1 = consolider/sécuriser la base + un premier cross-sell ; An 2 = étendre le périmètre
(ouvrir une nouvelle ligne d'offre depuis le whitespace) ; An 3 = devenir partenaire de référence (contrat-cadre).

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "roadmap": [
    { "an": "An 1" | "An 2" | "An 3", "titre": string, "offres": [string], "jalon": string }
  ]
}
Pour chaque année : un "titre" d'intention, 1 à 2 "offres" concrètes issues du whitespace/en-cours, et un "jalon" mesurable. JSON uniquement.`;
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

Rédige le cœur d'un plan de compte pour ${coerceStr(c.compte, "le compte")} (${coerceStr(c.secteur, "secteur")}, compte ${coerceStr(c.tier, "?")}) chez Neurones Technologies.
Enjeux : ${list(c.enjeux)}.
${empreinteChiffree(c)}
Actions déjà en cours : ${list(c.enCours)}.
Whitespace : ${list(c.whitespace)}.
Décideurs connus : ${list(contacts)}.
Signaux & opportunités en cours : ${list((c.signaux || []).map((s) => s.titre))}.

Réponds UNIQUEMENT avec un objet JSON valide :
{
  "actions": [ { "libelle": string, "horizon": "Court terme" | "Moyen terme" | "Continu" } ],
  "risques": [ { "r": string, "m": string, "niv": "Élevé" | "Moyen" | "Faible" } ]
}
4 "actions" priorisées (dont au moins une d'ouverture sur le whitespace et une de gouvernance/COPIL) ;
3 "risques" (r) avec mitigation (m) et niveau (niv), ancrés sur la réalité du compte. JSON uniquement.`;
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
    `Contexte : écran « ${coerceStr(c.ecran, "Copilote")} ». `;
  const histoOffres = (Array.isArray(c.compte && c.compte.historique) ? c.compte.historique : [])
    .filter((h) => h && typeof h === "object" && h.offre)
    .map((h) => h.offre);
  const compte = c.compte
    ? `Compte en cours : ${coerceStr(c.compte.nom)} (${coerceStr(c.compte.secteur, "?")}, ${coerceStr(c.compte.tier, "?")}). ` +
      `Enjeux : ${list(c.compte.enjeux)}. ` +
      `Offres déjà vendues : ${list(histoOffres)}. ` +
      `Whitespace : ${list(c.compte.whitespace)}. ` +
      `${empreinteChiffree(c.compte)} ` +
      `Opportunités en cours : ${list((c.compte.signaux || []).map((s) => s.titre))}.`
    : "Aucun compte précis sélectionné : réponds au niveau méthode/portefeuille.";
  return base + compte;
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
  redaction: { build: buildRedactionPrompt, parse: parseRedactionResponse },
};

module.exports = {
  NT_ROLE,
  AGENTS,
  buildProspectionPrompt, parseProspectionResponse,
  buildCvpPrompt, parseCvpResponse,
  buildTriennalPrompt, parseTriennalResponse,
  buildPlanComptePrompt, parsePlanCompteResponse,
  buildChatSystem, buildChatPrompt, parseChatResponse,
  buildRedactionPrompt, parseRedactionResponse,
};
