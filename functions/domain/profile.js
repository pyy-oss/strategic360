"use strict";

/**
 * domain/profile.js — PROFIL CLIENT (Phase 0 « produit agnostique »).
 *
 * Objectif : préparer la sortie du savoir-métier codé en dur (aujourd'hui teinté Neurones/ESN CI)
 * vers une CONFIG lisible depuis Firestore, propre à chaque déploiement client. Cette PR pose la
 * FONDATION sans rien câbler : `DEFAULT_PROFILE` est une VUE sur les constantes actuelles (importées,
 * donc aucune dérive possible) et `mergeProfile` fusionne des surcharges Firestore par-dessus. Tant
 * que rien ne surcharge, le profil résolu = exactement le comportement Neurones actuel.
 *
 * PUR : aucune I/O. Le chargement Firestore (`loadClientProfile`) vit dans index.js, comme
 * getCompanyContext. Les futures PR (C/D/E) feront lire ce profil aux prompts et au scoring.
 */

const { COMPANY_CONTEXT, NT_DIFFERENCIATEURS } = require("./companyContext");
const {
  VALID_AXES, VALID_BUS, VALID_SUBTYPES, SUBTYPE_SYNONYMS,
  OFFICIAL_DOMAIN_MARKERS, REPUTABLE_DOMAIN_MARKERS, AGGREGATOR_DOMAIN_MARKERS,
} = require("./classify");
const { SUBTYPE_BUSINESS, AXIS_ALIGN, ANCHOR_REQUIRED_SUBTYPES, UNANCHORED_DECOTE } = require("./scoring");
const { SUBTYPE_OFFER_MARKERS, MANAGED_MARKERS, PLACEHOLDER_BU } = require("./nt360");
const { NT_ROLE } = require("./copilote");

/**
 * DEFAULT_PROFILE — le profil Neurones Technologies, assemblé DEPUIS les constantes existantes
 * (source unique de vérité). C'est le fallback : un déploiement sans docs `config/*` se comporte à
 * l'identique. Les valeurs encore « inline » dans le code (bonus géo, ratings de source, bonus de
 * scoring) sont recopiées ici en attendant que les PR suivantes fassent lire ce profil au code.
 */
const DEFAULT_PROFILE = {
  profile: {
    companyName: "Neurones Technologies",
    legalName: "Neurones Technologies S.A.",
    sector: "Intégrateur IT/Télécoms & ESN",
    geographies: ["ci", "uemoa", "cemac"],
    currency: "XOF",
    timezone: "Africa/Abidjan",
    internalDataEnabled: true, // NT dispose de l'app sœur nt360 (données internes)
    homonyms: [
      "groupe français coté NEURONES (neurones.net)",
      "Neurones Technologies SA de Genève",
      "Neurones IT Asia",
    ],
    differentiators: NT_DIFFERENCIATEURS,
    regulators: ["ANSSI-CI", "ARTCI", "AMF-UMOA", "BCEAO"],
    systemRole: NT_ROLE, // gabarit copilote (interpolation {{…}} viendra en PR D)
  },
  contextText: COMPANY_CONTEXT, // = frameworks/companyContext.text quand présent
  taxonomy: {
    axes: VALID_AXES.map((key) => ({ key, alignWeight: AXIS_ALIGN[key] ?? 0.6 })),
    defaultAxisWeight: 0.6,
    subtypes: [...VALID_SUBTYPES],
    subtypeSynonyms: { ...SUBTYPE_SYNONYMS },
    businessUnits: [...VALID_BUS],
    contextMarkers: ["BUSINESS UNITS", "CONCURRENTS", "HOMONYMIE", "OBJECTIF COMMERCIAL"],
  },
  scoring: {
    subtypeBusiness: { ...SUBTYPE_BUSINESS },
    defaultBusiness: 0.4,
    opportunityBonus: 0.1,
    budgetIdentifiedBonus: 0.1,
    anchorRequiredSubtypes: [...ANCHOR_REQUIRED_SUBTYPES],
    unanchoredDecote: UNANCHORED_DECOTE,
    // Bonus géographique (scoring.js#alignementFactor) — paliers décroissants.
    localGeoMarkers: [
      { markers: ["ci", "ivoire"], bonus: 0.15 },
      { markers: ["uemoa", "afrique"], bonus: 0.08 },
    ],
    // Ancrage local requis pour le plein businessFactor des subtypes techniques (scoring.js#hasLocalAnchor).
    anchorGeoMarkers: ["ci", "ivoire", "uemoa", "afrique"],
  },
  offerMapping: {
    subtypeOfferMarkers: { ...SUBTYPE_OFFER_MARKERS },
    managedMarkers: [...MANAGED_MARKERS],
    placeholderBu: [...PLACEHOLDER_BU],
  },
  sourceAuthority: {
    officialDomains: [...OFFICIAL_DOMAIN_MARKERS],
    reputableDomains: [...REPUTABLE_DOMAIN_MARKERS],
    aggregatorDomains: [...AGGREGATOR_DOMAIN_MARKERS],
    ratings: { official: "A2", reputable: "B2", aggregator: "D3" },
  },
  internalData: {
    mode: "nt360", // "nt360" | "fileImport" | "none" — pilote internalDataEnabled côté produit
  },
};

/** Objet simple = {} non-null, non-tableau. */
function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * mergeProfile(base, override) -> profil fusionné. Fusion PROFONDE mais conservatrice : un objet
 * surcharge récursivement, une valeur scalaire/tableau surcharge en bloc, `undefined`/`null` NE
 * remplace PAS (on garde le défaut). Ne mute jamais les entrées. PUR.
 */
function mergeProfile(base, override) {
  if (!isPlainObject(override)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    if (ov === undefined || ov === null) continue; // ne jamais écraser un défaut par un vide
    if (isPlainObject(ov) && isPlainObject(out[key])) {
      out[key] = mergeProfile(out[key], ov);
    } else {
      out[key] = ov;
    }
  }
  return out;
}

/**
 * buildClientProfile(overrides) -> profil résolu. `overrides` = { profile?, contextText?, taxonomy?,
 * scoring?, offerMapping?, sourceAuthority?, internalData? } lus depuis Firestore (docs `config/*` +
 * frameworks/companyContext). Fusionné par-dessus DEFAULT_PROFILE. PUR (le chargement I/O est ailleurs).
 */
function buildClientProfile(overrides) {
  return mergeProfile(DEFAULT_PROFILE, overrides || {});
}

module.exports = { DEFAULT_PROFILE, mergeProfile, buildClientProfile, isPlainObject };
