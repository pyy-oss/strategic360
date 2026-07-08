# Configuration d'un déploiement client (« veille agnostique »)

Ce document décrit les **documents de configuration Firestore** qui rendent l'outil paramétrable par
client (Phase 0 « produit »). Un déploiement se fait **par client**, sur son propre projet Firebase :
tout le savoir-métier est lu depuis ces docs, avec **repli sur les valeurs Neurones** par défaut.

> Règle d'or : tant qu'aucun doc `config/*` n'existe, l'instance se comporte **exactement** comme
> l'app Neurones (prouvé par les tests de non-régression). On ne crée que les docs qu'on veut
> surcharger — les champs absents retombent sur le défaut.

Le profil est assemblé par `loadClientProfile(db)` (cache 10 min) et fusionné par-dessus
`DEFAULT_PROFILE` (`functions/domain/profile.js`). Chaque doc porte aussi `{ updatedBy, updatedAt }`.

---

## `config/profile` — identité & cadrage

| Champ | Type | Rôle |
|---|---|---|
| `companyName` / `legalName` | string | Nom (raison sociale) de l'entreprise |
| `sector` | string | Secteur d'activité |
| `geographies` | string[] | Zones cibles (ex. `["fr","be"]`) |
| `currency` | string | Devise (ex. `"EUR"`) |
| `timezone` | string | Fuseau — **aussi** via l'env `TENANT_TIMEZONE` (schedulers) |
| `internalDataEnabled` | boolean | `false` = mode « veille seule » (masque Copilote/quanti) |
| `homonyms` | string[] | Entités homonymes à ignorer |
| `differentiators` | string | Différenciateurs de marque (copilote) |
| `regulators` | string[] | Régulateurs de référence |
| `systemRole` | string | Rôle système du copilote (généré par `buildSystemRole` ou rédigé) |

## `frameworks/companyContext` — contexte entreprise
`{ content: { text: string } }` — le grand texte de contexte injecté dans tous les prompts IA.

## `config/veilleTaxonomy` — vocabulaire de veille
| Champ | Type | Rôle |
|---|---|---|
| `axes` | `{key, alignWeight, guetGuidance?}[]` | Axes de veille + poids d'alignement |
| `subtypes` | string[] | Vocabulaire des sous-types de signaux |
| `subtypeSynonyms` | Record<string,string> | Synonymes → forme canonique |
| `businessUnits` | string[] | BU/lignes d'offre |
| `homonymyRule` | string | **Bloc de prompt** : règle d'homonymie |
| `classifierGuidance` | string | **Bloc de prompt** : axes de guet + pertinence géo |

## `config/scoring` — pondérations
`subtypeBusiness` (map subtype→0..1), `defaultBusiness`, `opportunityBonus`, `budgetIdentifiedBonus`,
`anchorRequiredSubtypes` (string[]), `unanchoredDecote`, `anchorGeoMarkers` (string[]),
`localGeoMarkers` (`{markers[],bonus}[]`). Les poids d'axe viennent de `veilleTaxonomy.axes[].alignWeight`.

## `config/offerMapping` — boucle veille → offre
`subtypeOfferMarkers` (map subtype→marqueurs de libellé d'offre), `managedMarkers` (string[]),
`placeholderBu` (string[] à exclure).

## `config/sourceAuthority` — notation des sources par domaine
`officialDomains[]`, `reputableDomains[]`, `aggregatorDomains[]`, `ratings: {official, reputable, aggregator}`.

## `config/internalData` *(Palier 2)*
`mode: "nt360" | "fileImport" | "none"`, `stageMapping` (étapes pipeline → libellés). En Palier 1
(veille seule), mettre `mode: "none"` et `profile.internalDataEnabled: false`.

---

## Exemple minimal — cabinet d'avocats d'affaires (France)

```jsonc
// config/profile
{
  "companyName": "Dupont & Associés",
  "legalName": "Dupont & Associés SELAS",
  "sector": "cabinet d'avocats d'affaires",
  "geographies": ["fr"],
  "currency": "EUR",
  "timezone": "Europe/Paris",
  "internalDataEnabled": false,
  "homonyms": ["Dupont Legal Inc. (USA)"],
  "differentiators": "expertise M&A ; réseau international ; équipe contentieux dédiée",
  "regulators": ["AMF", "CNIL", "Autorité de la concurrence"],
  "systemRole": "Tu es le copilote commercial de Dupont & Associés SELAS (cabinet d'avocats d'affaires, zone fr). Tu sers un associé. Français, concis, orienté action. Aucune donnée client inventée. Réponds UNIQUEMENT avec un objet JSON valide."
}
```
```jsonc
// config/veilleTaxonomy
{
  "axes": [
    { "key": "clients", "alignWeight": 0.9, "guetGuidance": "levée de fonds, M&A, litige d'un client/prospect → besoin conseil" },
    { "key": "concurrents", "alignWeight": 0.6 },
    { "key": "reglementaire", "alignWeight": 0.85 },
    { "key": "marche", "alignWeight": 0.5 }
  ],
  "subtypes": ["ma", "litige", "levee_fonds", "reglementation", "nomination"],
  "businessUnits": ["Conseil", "Contentieux"],
  "homonymyRule": "RÈGLE D'HOMONYMIE : ignorer Dupont Legal Inc. (USA), sans lien avec le cabinet.",
  "classifierGuidance": "AXES DE GUET : opérations M&A, levées de fonds, litiges d'affaires, nouvelles jurisprudences et réglementations (AMF, CNIL, concurrence) créant un besoin de conseil juridique."
}
```

Après avoir écrit ces docs, lancer `syncSourcesNow` puis `enrichNow` (ou attendre les schedulers) pour
peupler la première cartographie. La **Phase 1 (onboarding auto)** générera ces docs automatiquement à
partir du site web + des documents corporate du client.
