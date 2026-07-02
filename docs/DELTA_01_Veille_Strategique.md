# DELTA 01 — Module « Veille Stratégique »
### Ajout au cockpit Pilote Revenu NT CI · conforme au KIT FINAL Firebase
### Méthode : delta module par module — on ajoute/renforce, on ne retire rien.

> **Type de delta** : nouveau module (spec détaillée). **Cible** : kit/spec Firebase (+ front React à venir). **Niveau** : spécification prête à implémenter, avec cadres stratégiques pré-remplis (premier jet à valider).
>
> **Nature particulière** : contrairement aux 12 modules existants (alimentés par P&L / Facturation DF / LIVE / fiche affaire), la Veille est nourrie par des **sources externes** (actualité, veille marché) + **saisie analyste** + **automatisation optionnelle** (RSS + IA Vertex/Gemini). Elle **ne dépend pas** de la clé N° FP, mais s'y **raccroche** via des passerelles (opportunités, fournisseurs, clients).

---

## 1. Objectif & valeur pour une ESN

Centraliser l'intelligence externe pour **éclairer le commercial, les opérations et le sourcing** de Neurones Technologies CI. La signature DRO reste le **lien avec l'aval** : une news « fin de vie produit » ou « pénurie » chez un distributeur alimente l'alerte **sourcing / lignes de crédit** ; une news « financement » ou « appel d'offres » chez un client alimente le **pipeline**. La veille n'est pas un fil d'actualité passif : c'est un **radar qui déclenche des actions**.

---

## 2. Périmètre — 4 axes (enrichis pour une ESN)

**Axe 1 — Partenaires (éditeurs · constructeurs · distributeurs)**
- Éditeurs/constructeurs : Cisco, Palo Alto, Fortinet, HPE/Aruba, Microsoft, VMware, Dell, Huawei, Veeam, Wallix, LogRhythm, Darktrace…
- Distributeurs : Westcon-Comstor, Hiperdist, Exclusive Networks, HDF, EXN, Ingram, Itancia, AITEK, Polaris…
- Signaux suivis : **lancements produits, fin de vie (EOL/EOS), pénuries & délais d'appro, changements de programme partenaire (niveaux, rebates, certifications), évolutions tarifaires, M&A, politique canal**. → *impact direct sur marge, sourcing et lignes de crédit.*

**Axe 2 — Concurrents**
- Intégrateurs/ESN régionaux, telcos B2B (Orange Business, MTN Business), pure players cloud/cyber, nouveaux entrants low-cost.
- Signaux : **contrats/AO gagnés, nouveaux partenariats éditeurs, recrutements clés, ouvertures/implantations, levées de fonds, offres nouvelles, prix**.

**Axe 3 — Clients & prospects potentiels**
- Clients : banques (SGCI, Coris, BCEAO, DIAMA…), télécoms (Orange, MTN), institutions/bailleurs (BAD, PAM, État), grands comptes.
- Signaux : **budgets & projets IT, appels d'offres (AO) publics/privés, financements (BAD, Banque Mondiale, UE), changements de direction/DSI, fusions, expansions régionales**. → *alimente le pipeline.*
- Prospects : cartographie des comptes cibles non encore clients.

**Axe 4 — Tendances & opportunités technologiques**
- Cybersécurité & souveraineté, cloud (public/souverain), IA, datacenters régionaux, réseaux (SD-WAN, MPLS-TP, fibre/5G), managed services, FinOps, IoT.

**Enrichissements spécifiques ESN (ajoutés au périmètre) :**
- **Veille appels d'offres** (UEMOA/CEMAC, BAD, Banque Mondiale, marchés publics CI) — la source #1 de pipeline régional.
- **Veille réglementaire** : ARTCI (protection des données), exigences sectorielles BCEAO (banques), **PASSI/accréditation cyber**, souveraineté & localisation des données, fiscalité douanière (impact coût du matériel importé).
- **Veille programmes éditeurs & certifications** (impacts statut partenaire, marges, rebates).
- **Veille supply-chain** (EOL, lead-times, allocations) — reliée au module Crédit Fournisseurs.
- **Veille financements & bailleurs** (programmes de digitalisation qui financent les projets).
- **Veille talents/compétences** (marché des ingénieurs cyber/cloud, salaires).
- **Veille macro/FX** (XOF, inflation, énergie) — impact sur les coûts et la trésorerie fournisseurs.

---

## 3. Sources & sourcing

| Mode | Description | Phase |
|------|-------------|-------|
| **Saisie analyste** | Un contributeur crée une fiche de veille (titre, résumé, lien, axe, entité, impact, opportunité/menace, tags). Passe par les Security Rules. | F1 |
| **Sources RSS/web** | `intelSources` (flux éditeurs, presse tech africaine, portails AO, ARTCI, bailleurs). | F2 |
| **Automatisation IA** | Cloud Function planifiée : récupère les flux → **Vertex AI / Gemini** résume, **classe** (axe, sous-type, impact, posture, entité liée) → crée des items `status:new` à valider par un humain. *(Cohérent avec ton stack Vertex AI.)* | F2 |

> Note technique : l'appel réseau sortant (RSS/web/Vertex) se fait **depuis les Cloud Functions** (jamais le client). Revue humaine avant publication (statut `new → reviewed`).

---

## 3 bis. Plan d'alimentation des données réelles

Le module tire sa force du **croisement de deux familles de sources** : les données **internes** du cockpit (qui *quantifient*) et la veille **externe** (qui *détecte*), enrichies par l'**IA** et complétées par la **saisie humaine** pour ce qui n'a pas de flux.

### A. Sources internes (déjà cartographiées dans le kit) — elles quantifient
| Source interne | Collection | Ce qu'elle alimente dans la Veille |
|----------------|-----------|-----------------------------------|
| Feuille **P&L** | `orders` (CAS, RAF, MB, BU, AM, Frns1-10) | BCG/GE-9box (croissance & poids par BU), Porter *pouvoir clients*, pont de valeur, marge du simulateur |
| **Facturation DF / Odoo `account.move`** | `invoices` | Réalisé, rythme mensuel, délai commande→facturation |
| Feuille **LIVE** | `opportunities` (montant, étape, IdC, D Prev, MB%) | Pipeline pondéré, win rate (6 vs 7), value-at-stake, KRIs de conversion, AO actifs |
| **Fiche affaire** | `projectSheets`, `bcLines` | Coûts par fournisseur/type, exposition |
| **Lignes de crédit** (saisie DF) | `creditLines` | Porter *pouvoir fournisseurs*, KRI saturation, tension trésorerie du simulateur |
| **Objectifs** (saisie) | `objectives` | Atterrissage, score stratégique |

### B. Sources externes par axe — elles détectent
| Axe | Sources (CI / UEMOA / Afrique) | Mode d'acquisition |
|-----|-------------------------------|--------------------|
| **Appels d'offres & financements** | Marchés publics CI (SIGMAP/DGMP, ARMP), portails **BAD**, **Banque Mondiale** (UNDB), UE, UEMOA | RSS/portail + scraping + saisie |
| **Réglementaire** | **ARTCI**, **BCEAO**, autorité cyber, journaux officiels, DGI/Douanes | RSS/web + saisie |
| **Partenaires (éditeurs/constructeurs)** | Pages **EOL/EOS** (Cisco, HPE, Fortinet, Microsoft Lifecycle), programmes partenaires, newsletters distributeurs (Westcon, Hiperdist, Exclusive) | RSS/web + newsletters |
| **Concurrents** | Sites web, **LinkedIn** (recrutements, annonces), presse éco (Jeune Afrique, Financial Afrik, Sika Finance, Abidjan.net, APA) | Web/LinkedIn + saisie |
| **Clients & prospects** | Presse financière, rapports annuels, **BRVM** (cotées), registres du commerce (implantations), LinkedIn | Web + saisie |
| **Tendances techno** | Analystes (Gartner/IDC — payant), blogs éditeurs, conférences | Web + saisie |
| **Macro / FX / risque pays** | **BCEAO** (stats, taux), FMI, Banque Mondiale, agences de notation, actualité régionale | RSS/web |

### C. Couche IA (Vertex AI / Gemini)
Cloud Function planifiée : récupère les flux → **résume, classe** (axe, type d'événement, imminence, impact, posture), **rapproche des entités** de la watchlist, **détecte les signaux faibles**, propose un « so-what » + une action. **Aucune publication sans revue humaine** (`new → reviewed`).

### D. Saisie humaine (pas de flux automatique)
Cadres stratégiques (SWOT/PESTEL/Canvas), registre de décisions, battlecards, watchlist, et le champ **concurrent** des Win/Loss (souvent absent du LIVE).

### E. Cartographie vue-par-vue (source · mode · fréquence · prérequis · priorité)
| Vue du module | Source(s) | Mode | Fréquence | Prérequis | Priorité |
|---------------|-----------|------|-----------|-----------|:--:|
| Radar de détection / Fil | Externes (B) + IA (C) | Auto + revue | Quotidien | `intelSources` configurées | ★★★ |
| Passerelle AO → Pipeline | Portails AO (B) | Auto + saisie | Quotidien | mapping AO→opportunité | ★★★ |
| Porter (fournisseurs/clients) | `orders`, `order_suppliers`, `creditLines` | Interne | À chaque import | — | ★★★ |
| BCG / GE-9box | `orders` (CAS N/N-1, marge) | Interne | Mensuel | historique N-1 | ★★ |
| Value-at-stake / Pont de valeur | `opportunities`, `orders`, `creditLines` | Interne | À chaque import | — | ★★★ |
| Simulateur (calibrage) | win rate LIVE, marge P&L, pipeline, exposition | Interne | Mensuel | historique conversion | ★★ |
| Indicateurs avancés (KRIs) | LIVE, P&L, `invoices`, `creditLines` | Interne | Hebdo | tags (voir F) | ★★★ |
| Win/Loss | `opportunities` étapes 6/7 | Interne + saisie | À chaque import | champ concurrent | ★★ |
| Réglementaire / risque pays | ARTCI, BCEAO, FMI (B) | Auto + saisie | Hebdo | `intelSources` | ★★ |
| Tech Radar / Innovation | Analystes, blogs (B) + saisie | Semi-auto | Mensuel | — | ★ |
| Cadres / Décisions / Battlecards | Saisie (D) | Manuel | Continu | — | ★★ |

### F. Prérequis internes à créer (honnêtes — sinon certains KRIs ne sont pas calculables)
- **Tag « récurrent vs projet »** sur les commandes/opportunités → indispensable pour la *part de récurrent*.
- **Champ « concurrent »** sur les affaires perdues → pour le *win/loss* réel (souvent absent du LIVE).
- **Date de commande** fiable → pour le *délai commande→facturation*.
> À ajouter au modèle (`orders`/`opportunities`) ou à la saisie. Sans eux, ces indicateurs restent en estimation.

### G. Priorité de mise en place (meilleur rapport valeur/effort)
1. **AO & financements** (BAD, Banque Mondiale, marchés publics CI) → alimente directement le Pipeline.
2. **Réglementaire** (ARTCI, BCEAO) + **EOL éditeurs** → alimente opportunités cyber/souveraineté et alertes sourcing.
3. **Internes** (Porter, BCG, value-at-stake, KRIs) → déjà disponibles via les imports du cockpit.
4. **Concurrents / presse / LinkedIn** → semi-auto + saisie, en second temps.
5. **Analystes payants (Gartner/IDC)** → optionnel, selon budget.

> Sources payantes/limitées à anticiper : Gartner/IDC (payant) ; certains portails d'AO sans API (scraping ou saisie) ; APIs régionales inégales.

---

## 4. Modèle Firestore (diff — nouvelles collections)

```
intelWatchlist/{entityId}
  { name, type, geo, priority, linkedSupplierId?, linkedClientId?, notes, active }
  // type ∈ partner_editor | partner_constructor | partner_distributor | competitor | client | prospect

intelSources/{sourceId}
  { name, kind, url, axis, active, lastFetch }
  // kind ∈ rss | web | newsletter | manual

intelItems/{itemId}
  { title, summary, url, sourceName, axis, subtype, entityId?, geo, date,
    impact, stance, tags[], linkedFp?, linkedSupplierId?, linkedClientId?,
    actionSuggested?, createdBy, status, createdAt }
  // axis     ∈ partenaires | concurrents | clients_prospects | tech
  // subtype  ∈ product_launch | eol | supply | program_change | pricing | ma |
  //            tender | funding | leadership | win | hire | regulation | trend | macro
  // geo      ∈ afrique | afrique_ouest | ci
  // impact   ∈ high | medium | low
  // stance   ∈ opportunity | threat | neutral
  // status   ∈ new | reviewed | actioned | archived

frameworks/{key}
  { key, content, version, updatedBy, updatedAt }
  // key ∈ swot | pestel | porter | bcg | canvas | ansoff  (documents vivants versionnés)

summaries/veille
  { countsByAxis, countsByImpact, countsByGeo, topThreats, topOpportunities,
    recentItems, tendersOpen, entitiesMostActive, updatedAt }   // écrit par Function aggregateVeille
```

**IDs déterministes** pour l'idempotence de l'ingestion automatique : `intelItems/{hash(url|title+date)}`. Dé-doublonnage natif au ré-import de flux.

---

## 5. Cadres stratégiques intégrés (documents vivants — premier jet à valider)

> Stockés dans `frameworks/{key}`, éditables (droits Direction), versionnés. Ci-dessous un **premier remplissage** taillé pour Neurones (ESN, CI/UEMOA) — à challenger en CODIR.

### 5.1 SWOT
- **Forces** : portefeuille multi-éditeurs certifié (Cisco/Palo Alto/Fortinet/HPE/Microsoft) ; expertise cybersécurité (démarche PASSI) ; références bancaires/télécom/institutionnelles ; capacité projet + managed services ; ancrage régional UEMOA/CEMAC ; capacité de portage/financement fournisseur.
- **Faiblesses** : marge brute faible sur le hardware (~7–21%) ; **concentration fournisseurs** (dépendance Hiperdist/Westcon/Exclusive) et **tension sur les lignes de crédit** ; cycle commande→facturation long (backlog) ; concentration sur quelques grands comptes ; dépendance aux compétences rares (cyber/cloud).
- **Opportunités** : transformation digitale banques/télécoms ; **cybersécurité & souveraineté** (réglementation, PASSI) ; cloud souverain ; **financements bailleurs** (BAD, Banque Mondiale, UE) ; managed services récurrents ; montée des **AO publics** UEMOA ; IA d'entreprise.
- **Menaces** : intensité concurrentielle (ESN + telcos B2B + low-cost) ; **désintermédiation** (vente directe éditeurs, hyperscalers) ; volatilité **FX/logistique** & pénuries (EOL) ; durcissement des **programmes éditeurs** (marges/rebates) ; risque politique/réglementaire régional.

### 5.2 PESTEL (Afrique de l'Ouest / CI)
- **Politique** : stabilité relative CI ; intégration UEMOA/CEDEAO ; commande publique ; souveraineté numérique.
- **Économique** : croissance soutenue ; inflation ; **XOF arrimé à l'EUR** (couverture partielle du risque de change matériel) ; accès au crédit ; budgets IT bancaires/télécom.
- **Social** : démographie jeune ; montée en compétences IT ; **pénurie de talents cyber/cloud** ; urbanisation Abidjan.
- **Technologique** : cloud, IA, cybersécurité, datacenters régionaux, fibre/5G, adoption SaaS.
- **Environnemental** : efficacité énergétique des datacenters ; contraintes énergie ; exigences RSE croissantes.
- **Légal** : ARTCI (données personnelles) ; réglementation BCEAO (banques) ; PASSI ; localisation/souveraineté des données ; **fiscalité douanière** (coût du matériel importé).

### 5.3 Porter — 5 forces (très structurant pour une ESN)
- **Rivalité** : élevée (intégrateurs régionaux, telcos B2B, nouveaux entrants).
- **Pouvoir des fournisseurs** : **élevé** (éditeurs/distributeurs imposent marges, rebates, lignes de crédit) → levier de négociation à piloter (cf. module Crédit Fournisseurs).
- **Pouvoir des clients** : élevé (grands comptes, AO, pression prix).
- **Menace de substituts** : croissante (cloud public direct, SaaS, régie interne DSI).
- **Barrières à l'entrée** : moyennes (certifications, références, capital fournisseur, expertise).

### 5.4 BCG — portefeuille d'activités (croissance × part relative)
- **Vedettes (Stars)** : cybersécurité & managed services (croissance + marge).
- **Vaches à lait (Cash Cows)** : intégration réseau/infrastructure (ICT) — volume, marge modérée.
- **Dilemmes (Question Marks)** : cloud souverain, IA d'entreprise, datacenter-as-a-service.
- **Poids morts (Dogs)** : revente pure de hardware banalisé (marge érodée) → à arbitrer.
> Visualisation : matrice à bulles (axe X part relative, Y croissance, taille = CA/marge), alimentée par les BU du cockpit.

### 5.5 Business Model Canvas (Neurones)
- **Segments** : banques, télécoms, institutions/bailleurs, grands comptes, secteur public.
- **Propositions de valeur** : intégration multi-éditeurs, expertise cyber, managed services, proximité régionale, **portage/financement**.
- **Canaux** : force commerciale (AM), appels d'offres, partenariats éditeurs.
- **Relations clients** : comptes dédiés, support, SLA managés.
- **Revenus** : projets (CAS), récurrent (managed/support), marge revente.
- **Ressources clés** : certifications, ingénieurs, **lignes de crédit fournisseurs**, références.
- **Activités clés** : avant-vente, intégration, delivery, support, **sourcing**.
- **Partenaires clés** : éditeurs, distributeurs, sous-traitants, **consortiums** (ex. GECA NEURONES–APM).
- **Structure de coûts** : achats matériel/licences, masse salariale, certifications, coût de financement.

### 5.6 Ansoff (bonus — matrice de croissance)
Pénétration (part chez clients existants) · Développement marché (nouveaux pays UEMOA/CEMAC) · Développement produit (managed cyber, cloud souverain, IA) · Diversification.

---

## 6. UI / vues du module

**Onglet « Veille » (design Forest & Gold, composants existants) :**
1. **Radar** (accueil) : KPIs (items 30 j, menaces vs opportunités, AO ouverts) + **top signaux de la semaine** + carte menaces/opportunités (impact × posture).
2. **Fil de veille** : liste filtrable par **axe / entité / géo / impact / posture / statut**, recherche plein-texte, tags. Chaque item : titre, résumé, source (lien), badges (axe, impact, opportunité/menace), et **actions** (voir §7).
3. **Watchlist** : entités suivies (partenaires, concurrents, clients, prospects) avec priorité et volume de signaux ; clic → tous les items liés.
4. **Cadres stratégiques** : onglets **SWOT · PESTEL · Porter · BCG · Canvas · Ansoff** — quadrants/blocs éditables (Direction), **BCG en matrice à bulles** alimentée par les BU du cockpit, historique de versions.
5. **Saisie** : formulaire de fiche de veille (contributeurs habilités).

**Visuels** : donut par axe, barres par impact/posture, matrice BCG (bulles), heatmap menaces/opportunités, timeline des signaux.

---

## 7. Passerelles cross-module (la valeur DRO)

- **Item `subtype: tender|funding|leadership` sur un client/prospect** → bouton **« Créer une opportunité »** qui pré-remplit la saisie **Pipeline** (client, montant estimé, étape Qualification). Lien conservé (`linkedFp` une fois l'opportunité créée).
- **Item `subtype: eol|supply|program_change|pricing` sur un distributeur/éditeur** → **alerte Sourcing** poussée dans le module **Crédit Fournisseurs** (via `linkedSupplierId`) et le **Centre d'alertes**.
- **Item sur un client existant** → remonte dans la **fiche client 360°** (module Clients).
- **Réglementaire (ARTCI/PASSI/BCEAO)** → note dans le contexte des modules concernés + tag opportunité.

---

## 8. RBAC — impact transverse (nouveau module `veille`)

Ajout d'une colonne `veille` à la matrice `config/permissions`. Défauts proposés :

| Module | direction | commercial_dir | commercial | pmo | achats | lecture |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|
| **veille** | W | W | W* | R | R | R |

- `*` **commercial** : peut **créer/éditer des items** (contribution) mais **pas** les cadres stratégiques.
- **Cadres stratégiques** (`frameworks/*`) : édition **Direction uniquement** (règle dédiée), lecture pour les profils ayant `veille ∈ {read, write}`.
- `achats`/`pmo` en **lecture** (les alertes fournisseurs les concernent via les passerelles).

---

## 9. Impacts transverses à appliquer (signalés explicitement)

1. **Navigation** : ajouter l'entrée `["veille","Veille Stratégique"]` dans `NAV` (positionnée avant « Habilitations »).
2. **`config/permissions`** (seed + matrice éditable) : ajouter la clé `veille` pour les 6 rôles (défauts §8).
3. **`firestore.rules`** — nouvelles règles :
```
match /intelItems/{id} {
  allow read:   if canRead('veille');
  allow create: if canWrite('veille') && request.resource.data.createdBy == request.auth.uid;
  allow update, delete: if canWrite('veille');
}
match /intelWatchlist/{id} { allow read: if canRead('veille'); allow write: if canWrite('veille'); }
match /intelSources/{id}   { allow read: if canRead('veille'); allow write: if canWrite('veille'); }
match /frameworks/{key}    { allow read: if canRead('veille'); allow write: if role() == 'direction'; }
match /summaries/veille    { allow read: if canRead('veille'); allow write: if false; }  // écrit par Function
```
4. **`firestore.indexes.json`** — index composites :
   - `intelItems` : (`axis` ASC, `date` DESC), (`impact` ASC, `date` DESC), (`entityId` ASC, `date` DESC), (`status` ASC, `date` DESC).
5. **Cloud Functions** : `aggregateVeille` (→ `summaries/veille`) déclenchée sur écriture `intelItems` + planifiée ; en F2, `ingestVeille` (RSS + Vertex AI). Réutilise les conventions du kit (Admin SDK, audit, imports).
6. **Front** : nouveau dossier `web/src/modules/veille/` + hook `useCan('veille')` (déjà générique).
7. **Sauvegarde/restauration JSON** : inclure `intelItems, intelWatchlist, intelSources, frameworks` dans le backup applicatif (continuité prototype).
8. **Aucune modification** des 12 modules existants ni des sources P&L/DF/LIVE/fiche — delta strictement additif.

---

## 10. Critères d'acceptation du delta

- Un profil sans droit `veille` ne voit pas l'onglet **et** se voit refuser lecture/écriture **par les Security Rules**.
- Un `commercial` peut créer un item mais **ne peut pas** éditer un cadre stratégique (refus rules).
- Ré-import d'un flux (même URL) **ne duplique pas** (ID déterministe).
- `summaries/veille` se met à jour en **temps réel** après création/édition d'item.
- Depuis un item « appel d'offres » sur un prospect, le bouton **« Créer une opportunité »** ouvre la saisie Pipeline pré-remplie et conserve le lien.
- Un item « EOL/pénurie » sur un distributeur **apparaît** comme alerte dans Crédit Fournisseurs (via `linkedSupplierId`).
- Les 6 cadres (`swot, pestel, porter, bcg, canvas, ansoff`) sont éditables par la Direction, versionnés, et pré-remplis avec le premier jet §5.
- Les 12 modules existants restent **inchangés** (non-régression).

---

## 11. Prochaines actions (choix du niveau)

Ce delta est au niveau **spécification**. Dis-moi le niveau souhaité pour la suite de **ce module** :
- **(a) Spec validée** → j'intègre ce delta au KIT FINAL (nav, matrice, rules, index, summaries) en une passe.
- **(b) Squelette de code** → `web/src/modules/veille/` (composants React) + `functions` (`aggregateVeille`, règles) au niveau ossature.
- **(c) Implémentation complète** → module opérationnel (fil + watchlist + cadres + passerelles), avec `intelItems` fonctionnels et, si tu veux, l'ingestion IA (Vertex/Gemini) en F2.

Et confirme les **défauts de droits** (§8) et la **liste initiale de la watchlist** (entités à suivre) — je peux la pré-remplir à partir de tes partenaires, concurrents et grands comptes connus.

*— Fin du Delta 01 —*
