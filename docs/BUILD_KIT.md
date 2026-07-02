# KIT CLAUDE CODE — Application « Veille Stratégique » (standalone, 100% Firebase)
### Neurones Technologies CI · module autonome · design de la maquette maintenu à l'identique

> **Document unique et faisant autorité** pour construire, avec Claude Code, une **application Veille Stratégique autonome** (son propre projet Firebase), reprenant **1:1 le design et les vues de la maquette** `Veille_Strategique_NT_CI.jsx`, et branchée sur des **données réelles**.
>
> **Références jointes** (à placer dans `docs/`) : cette maquette `.jsx` (source visuelle & fonctionnelle), `DELTA_01_Veille_Strategique.md` (spec + plan d'alimentation §3 bis), `DELTA_01B_Veille_Renforcement_Executif.md` (renforcement exécutif). En cas de doute d'apparence, **la maquette fait foi**.
>
> **Cap : on ne retire rien, on porte la maquette en app réelle.** Chaque vue conserve son rendu ; on remplace les données d'exemple par des requêtes Firestore et un moteur de calcul.

---

## 0. Comment utiliser ce kit
1. Créer un projet Firebase dédié « veille-nt-ci » + un dépôt Git ; placer ce fichier en `docs/BUILD_KIT.md` et la maquette en `docs/maquette_reference.jsx`.
2. Rendre disponibles (environnement sécurisé) les fichiers sources du cockpit pour le volet quantitatif : `PIPELINE_NT_CI_Inventory.xlsx` (feuilles **P&L**, **Facturation DF**, **LIVE**) + une **fiche affaire** type.
3. Démarrer Claude Code, coller le **Prompt d'amorçage** (§15). Dérouler la **Roadmap V0→V8** (§13), une phase à la fois, en validant les **critères d'acceptation** (§14).
4. **Fidélité design** : porter les tokens, composants et graphiques de la maquette **à l'identique** (§5) avant de câbler les données.

---

## 1. Mission & principes
- **Application autonome** dédiée à la Veille Stratégique (auth, base, fonctions, hébergement propres).
- **Design maintenu** : « Forest & Gold », mêmes composants, mêmes visuels (radars SVG, jauge, sparklines, waterfall, matrices).
- **Deux familles de données** : **internes** (P&L/LIVE/Facturation/fiche → quantifient les cadres, la valeur, les KRIs) et **externes** (veille → détectent), + **IA** (Vertex/Gemini) + **saisie**.
- **Droits opposables** (Security Rules + custom claims), **ingestion idempotente** (IDs déterministes), **lectures économiques** (documents `summaries/*`), **temps réel + offline**, **traçabilité** (audit).
- **Rien n'est publié par l'IA sans revue humaine** (`new → reviewed`).

---

## 2. Périmètre — 15 vues (identiques à la maquette) + 3 focales
Focales (sélecteur d'en-tête) : **DG (Board)** · **Stratégie** · **Innovation**.

| # | Onglet | Contenu (repris de la maquette) |
|---|--------|--------------------------------|
| 1 | **Radar exécutif** | KPIs stratégiques, top signaux par score, carte menaces×opportunités, décisions |
| 2 | **Fil de veille** | Signaux filtrables (axe/posture), score de priorité, cotation source A1-F5, so-what + action |
| 3 | **Radar de détection** | Sonar SVG animé : catégorie×imminence×impact ; types d'événements ; fil détecté |
| 4 | **Indicateurs avancés** | 10 KRIs *leading* avec sparklines, tendance, seuils ; alertes |
| 5 | **Cadres stratégiques** | SWOT · PESTEL · Porter (radar) · BCG (bulles) · Canvas |
| 6 | **Portefeuille & Croissance** | GE-McKinsey 9-box · Three Horizons · Granularité (where-to-win) |
| 7 | **Création de valeur** | Pont de valeur (waterfall) · Value-at-stake · Arbre des leviers |
| 8 | **Simulateur stratégique** | Leviers → revenu/marge/récurrent/score ; **tornado** + **comparaison de scénarios** |
| 9 | **Diagnostic** | Arbre MECE · McKinsey 7S · Maturité des capacités |
| 10 | **Tech Radar & Innovation** | Radar SVG (Adopter/Essayer/Évaluer/Suspendre) · portefeuille RICE |
| 11 | **Concurrence** | Battlecards · Win/Loss (taux de victoire par concurrent) |
| 12 | **Scénarios** | Matrice 2×2 probabilisée · espérance · what-if |
| 13 | **Exécution & Décisions** | Initiatives/OKR · registre de décisions |
| 14 | **Plan d'action** | Matrice impact×urgence · plan priorisé (valeur attendue, porteur, échéance) |
| 15 | **Briefing exécutif** | Pyramide de Minto (idée directrice → 3 arguments MECE) · export board pack |

---

## 3. Architecture Firebase (standalone)
```
Firebase Hosting (SPA React/Vite/TS — design Forest & Gold, offline, App Check)
   │  ID token (claim: role ∈ direction|strategie|innovation|commercial_dir|commercial|pmo|achats|lecture)
   ├── Firebase Auth (email/MFA/SSO, custom claims)
   ├── Firestore (collections Veille + summaries/* ; Security Rules = RBAC)
   ├── Cloud Functions (Node 20) :
   │     ingestInternal (SheetJS: P&L/LIVE/Facturation/fiche → métriques quanti)
   │     syncSources (scheduled) → classifyAI (Vertex/Gemini) → intelItems(new)
   │     scoreItems · aggregateVeille · aggregateVeilleExec
   │     generateBriefing (IA) · exportPdf · setUserRole
   ├── Cloud Storage (imports bruts + exports PDF)
   └── Cloud Scheduler (sync veille quotidien)   [BigQuery optionnel : analytique]
```

---

## 4. Stack & structure du projet
Stack : **React 18 + Vite + TypeScript**, **Recharts** (+ SVG custom pour radars/jauge/sparkline), **TanStack Query**, **React Router**, **Firebase SDK** (auth/firestore/functions/app-check, persistance offline). Fonctions : **Node 20 + SheetJS (`xlsx`)**, **ExcelJS/pdfkit** pour exports, **Vertex AI (Gemini)** pour l'IA.
```
veille-nt-ci/
├─ docs/ (BUILD_KIT.md, maquette_reference.jsx, DELTA_01*, DELTA_01B*)
├─ firebase.json  .firebaserc  firestore.rules  firestore.indexes.json  storage.rules
├─ functions/            # Node 20
│  ├─ index.js           # ingestInternal, syncSources, classifyAI, scoreItems, aggregate*, generateBriefing, setUserRole, exportPdf
│  ├─ parsers/           # SheetJS : pnl, live, facturationDf, fiche
│  ├─ domain/            # sim.js (simCompute), scoring.js, valueAtStake.js, kris.js
│  └─ package.json
├─ web/
│  ├─ src/
│  │  ├─ design/         # tokens.ts (Forest&Gold), ui.tsx (Eyebrow, Card, Kpi, Badge, Tip, Slider, Gauge, Spark)
│  │  ├─ modules/veille/ # 15 vues (1 fichier par onglet, portées de la maquette)
│  │  ├─ lib/            # firebase.ts, rbac.ts (useClaims/useCan), hooks (useSummary, useCollection), format.ts (fmt/pct)
│  │  └─ app/            # routing + focale DG/Stratégie/Innovation
│  └─ package.json
└─ .github/workflows/ci.yml
```

---

## 5. Design system — à reprendre **à l'identique** de la maquette
**Tokens (Forest & Gold) — `design/tokens.ts` :**
```
bg #0E1613 · panel #151F1A · panel2 #1B2721 · line #26352D
ink #EEF3EF · dim #8FA89B · faint #5E7268
gold #C9A24B · emerald #46C08A · clay #D9694C · steel #6E9DC0 · plum #A98AC4
```
**Polices :** **Bricolage Grotesque** (titres/nombres) + **Inter** (corps). `font-variant-numeric: tabular-nums` sur les chiffres.
**Cartes de couleurs (à conserver) :** `AX` (axes veille), `IMP` (impact), `STANCE` (opportunité/menace/neutre), `RING` (tech radar), `ECAT`/`PROX` (radar de détection), `QCOL` (BCG), `STCOL` (statut KRI).
**Composants partagés (mêmes props que la maquette) :** `Eyebrow`, `Card`, `Kpi(label,value,accent,sub)`, `Badge(children,c)`, `Tip` (tooltip recharts), `Slider(label,val,set,min,max,step,unit,color,hint)`, `Gauge(score)` (anneau SVG), `Spark(data,color)` (sparkline SVG).
**Styles pill/tab** (nav focale + sous-nav) et **helpers** `fmt` (Md/M/k), `pct` : identiques.
**Visuels signature à porter tels quels :** radar Tech (SVG 4 quadrants × 4 anneaux), **radar de détection** (sonar + balayage `animateTransform`), **jauge** de score, **sparklines** KRIs, **waterfall** (pont de valeur via BarChart empilé base transparente), **matrices** (BCG/GE/impact-urgence via ScatterChart + Cell), **Porter/7S** (RadarChart).

> Consigne Claude Code : commencer par extraire `tokens.ts` + `ui.tsx` depuis la maquette, recréer chaque vue en composant, **puis** remplacer les constantes d'exemple (`SIGNAUX`, `EVENTS`, `KRI`, `WATCH`, `SWOT`, `BCG`, `GE9`, `VAS`, `ACTIONS`, `SCENARIOS`, `INITIATIVES`, `DECISIONS`, `RADAR_TECH`, `CONCURRENTS`, …) par des requêtes Firestore/hooks — **sans changer le rendu**.

---

## 6. Modèle Firestore (toutes les collections)
> IDs déterministes ⇒ idempotence. Le front lit surtout `summaries/*` ; le détail à la demande.
```
// — Signaux & détection —
intelItems/{id}         { title, summary, url, sourceName, axis, subtype, cat, ent, geo, date,
                          impact, stance, sourceRating(A1..F5), confidence, priorityScore,
                          soWhat, recommendedAction, owner, dueDate, prox, neuf,
                          linkedFp?, linkedSupplierId?, linkedClientId?, decisionId?, initiativeId?,
                          status(new|reviewed|actioned|archived), createdBy, createdAt }
intelWatchlist/{id}     { name, type, geo, priority, linkedSupplierId?, linkedClientId?, active }
intelSources/{id}       { name, kind(rss|web|newsletter|manual|portal), url, axis, active, lastFetch }

// — Cadres & analyse (documents vivants versionnés) —
frameworks/{key}        { key(swot|pestel|porter|bcg|canvas|ansoff), content, version, updatedBy, updatedAt }
strategicThemes/{id}    { title, description, owner, order }
initiatives/{id}        { title, themeId, objective, keyResults[], owner, status, horizon, dueDate, progress, linkedItems[] }
decisions/{id}          { title, context, options[], chosen, rationale, decidedBy, date, linkedItems[], reviewDate, outcome? }
techRadar/{blipId}      { name, quadrant, ring, momentum, rationale, linkedItems[] }
innovationPortfolio/{id}{ title, reach, impact, confidence, effort, rice, stage, owner, budget, horizon }
scenarios/{id}          { title, axisX, axisY, worlds[4], probs[4], triggers[], responses[] }
battlecards/{competitorId}{ competitor, positioning, strengths[], weaknesses[], ourWinThemes[], theirLikelyMoves[], recentMoves[] }
winLoss/{oppFp}         { competitor, result, reason, amount, lesson, date }
actions/{id}            { title, impact, urgence, effort, ev, owner, echeance, statut, source, linkedItemId? }
briefings/{id}          { period, governingThought, arguments[3], content, kpis, generatedBy, reviewedBy, status }

// — Config & sécurité —
config/permissions      { matrix: { roleId: { module: "none|read|write" } } }
config/fiscal           { currentFy }
users/{uid}             { email, name, active }            // rôle = custom claim
auditLog/{id}           { uid, action, module, entity, entityId, detail, ts }
imports/{id}            { uid, kind, filename, rowsIn, rowsOk, report, ts }

// — AGRÉGATS (écrits par Functions, lecture rapide) —
summaries/veille        { countsByAxis, countsByImpact, topThreats, topOpportunities, recentItems,
                          tendersOpen, entitiesMostActive }
summaries/veille_exec   { boardKpis, decisionsPending, porter, winRateByCompetitor,
                          pipelineInfluenced, threatsExposure, okrProgress }
summaries/quanti        { porterForces, bcg[], ge9[], pipelinePondere, winRate, marginAvg,
                          supplierSaturation, recurrentShare, kris[], valueAtStake[] }  // dérivé des sources internes
```

---

## 7. RBAC — rôles & Security Rules
**8 profils** (dont exécutifs) : `direction`, `strategie`, `innovation`, `commercial_dir`, `commercial`, `pmo`, `achats`, `lecture`.
**Défauts `config/permissions` pour le module `veille`** : `write` → direction/strategie/innovation ; **contribution** (create items) → commercial_dir/commercial ; **read** → pmo/achats/lecture.
**Sous-domaines à droits particuliers :** cadres/scénarios/décisions/OKR → exécutifs (direction/strategie/innovation) ; battlecards → contribution commerciale ; techRadar/innovationPortfolio → innovation.
```
rules_version='2';
service cloud.firestore { match /databases/{db}/documents {
  function role(){return request.auth.token.role;}
  function matrix(){return get(/databases/$(db)/documents/config/permissions).data.matrix;}
  function lvl(m){return role() in ['direction'] ? 'write' : matrix()[role()][m];}
  function canRead(m){return request.auth!=null && lvl(m) in ['read','write'];}
  function canWrite(m){return request.auth!=null && lvl(m)=='write';}
  function exec(){return role() in ['direction','strategie','innovation'];}

  match /intelItems/{id}{
    allow read: if canRead('veille');
    allow create: if canWrite('veille') && request.resource.data.createdBy==request.auth.uid;
    allow update,delete: if canWrite('veille');
  }
  match /intelWatchlist/{id}{ allow read: if canRead('veille'); allow write: if canWrite('veille'); }
  match /intelSources/{id}{ allow read: if canRead('veille'); allow write: if exec(); }
  match /frameworks/{k}{ allow read: if canRead('veille'); allow write: if exec(); }
  match /{c}/{id} where c in ['scenarios','decisions','strategicThemes','initiatives']{ allow read: if canRead('veille'); allow write: if exec(); }
  match /{c}/{id} where c in ['techRadar','innovationPortfolio']{ allow read: if canRead('veille'); allow write: if role() in ['direction','innovation']; }
  match /battlecards/{id}{ allow read: if canRead('veille'); allow write: if canWrite('veille'); }
  match /{c}/{id} where c in ['winLoss','actions','briefings']{ allow read: if canRead('veille'); allow write: if exec(); }
  match /summaries/{d}{ allow read: if request.auth!=null; allow write: if false; }   // Functions
  match /config/permissions{ allow read: if request.auth!=null; allow write: if role()=='direction'; }
  match /config/{d}{ allow read: if request.auth!=null; allow write: if false; }
  match /auditLog/{id}{ allow read: if role()=='direction'; allow write: if false; }
  match /users/{uid}{ allow read: if role()=='direction' || request.auth.uid==uid; allow write: if false; }
}}
```
> Note : la syntaxe `match … where c in […]` est indicative ; en pratique, dupliquer un bloc `match` par collection. Imports & agrégats écrits par l'Admin SDK (Functions) contournent les rules. MFA pour profils exécutifs + App Check.

---

## 8. Moteur métier — formules exactes (à porter depuis la maquette, puis calibrer)

**8.1 Score de priorité d'un signal (0-100)** :
```
priorityScore = 100 × credibilite × (0.35·impact + 0.25·alignementStrategique + 0.20·probabilite + 0.20·proximite)
```
`credibilite` dérivée de la cotation source **A1..F5** (code de l'amirauté : A/1=fiable & confirmé → F/5=indéterminé & improbable).

**8.2 Simulateur — `domain/sim.js` (identique à la maquette) :**
```js
const SIM_BASE={cas:8000,recurrent:1500,winBase:62,pipe:13780,ambition:15300,objMarge:0.24}; // ← calibrer sur données réelles
const SCEN={central:{cloud:1.0,mp:1.0},s1:{cloud:1.2,mp:0.7},s2:{cloud:1.1,mp:1.3},s3:{cloud:0.7,mp:1.3},s0:{cloud:0.8,mp:0.8}};
function simCompute(p){
  const ramp=p.horizon/3, s=SCEN[p.scenario]||SCEN.central;
  const addManaged=p.managed/100*2500*ramp, addCloud=p.cloud/100*1800*ramp*s.cloud, addAO=p.aoBad/100*3500*ramp;
  const addWin=(p.win-SIM_BASE.winBase)/100*SIM_BASE.pipe*0.30, addNew=p.newAcc/100*1500*ramp, lossAttr=p.attrition/100*1400;
  const revenu=SIM_BASE.cas+addManaged+addCloud+addAO+addWin+addNew-lossAttr;
  const recurrent=SIM_BASE.recurrent+addManaged+0.6*addCloud, recShare=recurrent/revenu, baseShare=SIM_BASE.recurrent/SIM_BASE.cas;
  let margin=0.21+p.mix/100*0.06+Math.max(recShare-baseShare,0)*0.25-p.tarif/100*0.05*s.mp-p.invest/100*0.02;
  margin=Math.max(0.10,Math.min(0.45,margin));
  const sC=Math.min(revenu/SIM_BASE.ambition,1.2)/1.2, sM=Math.min(margin/SIM_BASE.objMarge,1.2)/1.2;
  const sR=Math.min(recShare/0.35,1), sRes=Math.max(0,1-(p.attrition+p.tarif)/200);
  const score=Math.round(100*(0.4*sC+0.25*sM+0.2*sR+0.15*sRes));
  const tension=Math.max(0,Math.min(1,(addAO+addWin)*0.5/SIM_BASE.cas+p.invest/100*0.3-recShare*0.2));
  return {revenu,recurrent,recShare,margin,margeVal:revenu*margin,score,tension};
}
// Tornado : pour chaque levier, |score(min)-score(max)| autres fixés. Comparaison : PRESETS Prudent/Base/Ambition.
```

**8.3 Autres calculs :** value-at-stake `ev = probabilité × impact` ; RICE `=(reach·impact·confidence)/effort` ; priorité action `= impact×urgence/effort` ; BCG (croissance CAS N/N-1 × part relative, taille=marge) ; Porter *pouvoir fournisseurs*=concentration Top-3 fournisseurs, *pouvoir clients*=concentration Top-5 clients ; KRIs (voir §9). Tous **calibrés sur les données réelles** (§9), pas sur les constantes d'exemple.

---

## 9. Alimentation des données (résumé — détail dans DELTA_01 §3 bis)

**A. Internes (quantifient)** — ingérées par `ingestInternal` (SheetJS) → `summaries/quanti` :
- **P&L** → BCG/GE-9box, Porter (clients/fournisseurs), pont de valeur, marge, exposition fournisseurs, KRI saturation.
- **LIVE** → pipeline pondéré, **win rate** (6 vs 7 → calibre `SIM_BASE`), value-at-stake, KRIs conversion, AO actifs.
- **Facturation DF** → réalisé, KRI délai commande→facturation.
- **Fiche affaire** → coûts par fournisseur/type.

**B. Externes (détectent)** — `intelSources` + `syncSources` (scheduled) :
- **AO & financements** : marchés publics CI (SIGMAP/DGMP, ARMP), **BAD**, **Banque Mondiale**, UE, UEMOA.
- **Réglementaire** : **ARTCI**, **BCEAO**, journaux officiels, DGI/Douanes.
- **Partenaires** : pages **EOL/EOS** (Cisco/HPE/Fortinet/Microsoft), programmes, newsletters distributeurs.
- **Concurrents / clients** : presse éco régionale, **LinkedIn**, **BRVM**, registres du commerce.
- **Tech / macro** : analystes, blogs éditeurs ; **BCEAO**/FMI (FX, risque pays).

**C. IA (Vertex/Gemini)** — `classifyAI` : résume, classe (axe/type/imminence/impact/posture), rapproche des entités, détecte signaux faibles, propose so-what+action. **Revue humaine obligatoire** (`new→reviewed`).

**D. Saisie** : cadres, décisions, battlecards, watchlist, champ **concurrent** des Win/Loss.

**Prérequis internes à créer** (sinon KRIs en estimation) : tag **récurrent/projet**, champ **concurrent** sur affaires perdues, **date de commande** fiable.

**Cartographie vue→source→fréquence→priorité** : voir DELTA_01 §3 bis E (à respecter).

---

## 10. Cloud Functions (Node 20)
| Fonction | Déclencheur | Rôle |
|----------|-------------|------|
| `ingestInternal` | Storage `onFinalize` (imports/*.xlsx) | SheetJS : parse P&L/LIVE/Facturation/fiche → calcule `summaries/quanti` (Porter, BCG/GE, pipeline pondéré, win rate, marge, saturation, KRIs, value-at-stake) |
| `syncSources` | Scheduler (quotidien 06:00) | Récupère `intelSources` (RSS/web/portails) → `classifyAI` → crée `intelItems{status:new}` |
| `classifyAI` | appelée par syncSources | **Vertex AI/Gemini** : résumé, classification (axe/type/imminence/impact/posture), entity resolution, so-what+action, signaux faibles |
| `scoreItems` | `onWrite` intelItems | calcule `priorityScore` (§8.1) |
| `aggregateVeille` / `aggregateVeilleExec` | `onWrite` + planifié | construit `summaries/veille` et `summaries/veille_exec` |
| `generateBriefing` | callable / planifié | **IA** : idée directrice + 3 arguments MECE + KPIs → `briefings` (revue humaine) |
| `exportPdf` | callable | board pack / one-pager PDF (pdfkit) → Storage (URL signée) |
| `setUserRole` | callable (admin `direction`) | pose le custom claim `role` + audit |

Idempotence : IDs déterministes (`intelItems/{hash(url|title+date)}`). Sécurité : Admin SDK (contourne rules), audit systématique, secrets via config Functions, IA avec garde-fous (provenance, pas de publication auto).

---

## 11. Frontend — mapping vue → données
| Vue | Lit | Écrit (selon droits) |
|-----|-----|----------------------|
| Radar exécutif | `summaries/veille_exec`, `intelItems` (top), `decisions` | — |
| Fil de veille | `intelItems` (query, tri priorityScore) | create/update items (contribution) |
| Radar de détection | `intelItems` (subtype/cat/prox) | — |
| Indicateurs avancés | `summaries/quanti.kris` | — |
| Cadres | `frameworks/*` + `summaries/quanti` (Porter/BCG) | frameworks (exécutifs) |
| Portefeuille & Croissance | `summaries/quanti.ge9/bcg`, `initiatives` | — |
| Création de valeur | `summaries/quanti.valueAtStake`, pont (dérivé) | — |
| Simulateur | `summaries/quanti` (calibrage) + état local | — (sim côté client) |
| Diagnostic | `frameworks`, saisie | exécutifs |
| Tech Radar / Innovation | `techRadar`, `innovationPortfolio` | innovation |
| Concurrence | `battlecards`, `winLoss` | contribution / exécutifs |
| Scénarios | `scenarios` | exécutifs |
| Exécution & Décisions | `initiatives`, `decisions` | exécutifs |
| Plan d'action | `actions` (+ dérivé de `intelItems`) | exécutifs |
| Briefing | `briefings`, `summaries/*` | exécutifs (generate) |

Hooks : `useClaims()`/`useCan('veille')`, `useSummary(key)` (onSnapshot temps réel), `useCollection(name, query)`. Offline activé. UI masquée/désactivée selon droits (le serveur reste seul juge).

---

## 12. Fichiers de démarrage (prêts à committer)
**`firebase.json`**
```json
{ "hosting": { "public": "web/dist", "rewrites": [{ "source":"**", "destination":"/index.html" }] },
  "firestore": { "rules":"firestore.rules", "indexes":"firestore.indexes.json" },
  "storage": { "rules":"storage.rules" },
  "functions": [{ "source":"functions", "codebase":"default", "runtime":"nodejs20" }],
  "emulators": { "auth":{"port":9099},"firestore":{"port":8080},"functions":{"port":5001},"storage":{"port":9199},"hosting":{"port":5000},"ui":{"enabled":true} } }
```
**`functions/package.json`**
```json
{ "name":"functions","engines":{"node":"20"},"main":"index.js",
  "dependencies":{"firebase-admin":"^12","firebase-functions":"^5","xlsx":"^0.18","exceljs":"^4","pdfkit":"^0.15","@google-cloud/vertexai":"^1"},
  "devDependencies":{"vitest":"^2","@firebase/rules-unit-testing":"^3"} }
```
**`firestore.indexes.json`** (extrait)
```json
{ "indexes":[
  {"collectionGroup":"intelItems","queryScope":"COLLECTION","fields":[{"fieldPath":"axis","order":"ASCENDING"},{"fieldPath":"priorityScore","order":"DESCENDING"}]},
  {"collectionGroup":"intelItems","queryScope":"COLLECTION","fields":[{"fieldPath":"cat","order":"ASCENDING"},{"fieldPath":"date","order":"DESCENDING"}]},
  {"collectionGroup":"intelItems","queryScope":"COLLECTION","fields":[{"fieldPath":"status","order":"ASCENDING"},{"fieldPath":"priorityScore","order":"DESCENDING"}]},
  {"collectionGroup":"actions","queryScope":"COLLECTION","fields":[{"fieldPath":"statut","order":"ASCENDING"},{"fieldPath":"ev","order":"DESCENDING"}]}
], "fieldOverrides":[] }
```
**`web`** : Vite + TS + Firebase SDK ; `design/tokens.ts` & `design/ui.tsx` extraits de la maquette ; 15 vues dans `modules/veille/`. **`.github/workflows/ci.yml`** : `pnpm test` (web), `npm --prefix functions test` (Vitest parseurs + sim), `firebase emulators:exec "npm run test:rules"`, build, `firebase deploy` (preview puis prod). **Seed** : `config/permissions` (matrice §7), 1er utilisateur `direction`, `intelSources` initiales, `frameworks/*` (premier jet DELTA_01 §5), `scenarios` (2×2 §maquette), `strategicThemes`.

---

## 13. Roadmap V0→V8 (une phase à la fois)
- **V0 Socle & design** : projet Firebase, Emulator Suite, Hosting, **extraction `tokens.ts`+`ui.tsx`** et coque (focale + sous-nav) — l'app affiche les 15 onglets vides au bon design.
- **V1 Auth & RBAC** : Auth + claims (8 rôles) + `setUserRole` + `firestore.rules` + tests de règles par profil.
- **V2 Saisie & Fil** : `intelItems` (CRUD contribution) + `intelWatchlist`/`intelSources` + vue **Fil** + **Radar de détection** branchés (données réelles saisies).
- **V3 Scoring & agrégats veille** : `scoreItems` (§8.1) + `aggregateVeille`/`veille_exec` → **Radar exécutif** temps réel.
- **V4 Quanti interne** : `ingestInternal` (SheetJS P&L/LIVE/Facturation/fiche) → `summaries/quanti` → **Cadres (Porter/BCG)**, **Portefeuille (GE/Three Horizons/granularité)**, **Création de valeur**, **Indicateurs avancés**.
- **V5 Simulateur** : `domain/sim.js` (calibré sur `summaries/quanti`) + **tornado** + **comparaison** — rendu identique maquette.
- **V6 Exécution & concurrence** : `initiatives`/`decisions`/`actions`/`battlecards`/`winLoss` + **Exécution**, **Plan d'action**, **Concurrence**, **Scénarios**, **Diagnostic**, **Tech Radar**.
- **V7 IA & sync** : `syncSources` + `classifyAI` (Vertex/Gemini) + `generateBriefing` + **Briefing** (pyramide de Minto) + `exportPdf`.
- **V8 Durcissement** : App Check, MFA exécutifs, export Firestore planifié, tests ≥80%, observabilité, doc utilisateur.

---

## 14. Critères d'acceptation
- **Fidélité design** : chaque vue est visuellement **identique à la maquette** (tokens, composants, radars SVG, jauge, sparklines, waterfall, matrices).
- Une écriture non autorisée est refusée **par les Security Rules** (pas seulement l'UI) ; cadres/décisions réservés aux exécutifs.
- Ré-import (interne ou flux) **sans doublon** (IDs déterministes) ; `summaries/*` en **temps réel**.
- **Score de priorité** et **cotation A1-F5** calculés et pilotant tri/alertes.
- Cadres **vivants** : Porter reflète les concentrations réelles (fournisseurs/clients) ; BCG/GE bougent avec les BU ; KRIs calculés depuis les sources internes.
- **Simulateur** : mêmes formules que la maquette, calibré ; tornado & comparaison fonctionnels.
- Passerelles : item AO → **créer opportunité** (export/lien) ; item EOL → **alerte sourcing**.
- **Briefing** généré par IA puis validé, exportable en **board pack PDF**.
- Prérequis §9 (tags récurrent/projet, concurrent, date commande) en place ou signalés.

---

## 15. Prompt d'amorçage Claude Code
```
Lis docs/BUILD_KIT.md (spec faisant autorité) et docs/maquette_reference.jsx (design & fonctionnel FAISANT FOI).
Objectif : construire une APPLICATION VEILLE STRATÉGIQUE AUTONOME (projet Firebase dédié) qui reprend
1:1 le design et les 15 vues de la maquette, branchée sur des données réelles. On ne retire rien.

Stack : Firebase Hosting (React/Vite/TS) + Auth (custom claims, 8 rôles dont direction/strategie/innovation, MFA)
+ Firestore (collections Veille + summaries/*) + Cloud Functions Node 20 (SheetJS ingestInternal, syncSources,
classifyAI via Vertex/Gemini, scoreItems, aggregate*, generateBriefing, exportPdf, setUserRole)
+ Cloud Storage + Cloud Scheduler. RBAC OPPOSABLE par Security Rules.

Règles d'or :
- DESIGN MAINTENU : extraire tokens.ts + ui.tsx depuis la maquette, recréer chaque vue, PUIS remplacer les
  constantes d'exemple par des requêtes Firestore — sans changer le rendu (Forest & Gold, radars SVG, jauge,
  sparklines, waterfall, matrices).
- Deux familles de données : internes (P&L/LIVE/Facturation/fiche → summaries/quanti, quantifient) et externes
  (veille → intelItems, détectent) + IA (revue humaine obligatoire, new→reviewed) + saisie.
- Moteur métier = formules exactes du §8 (simCompute, score de priorité A1-F5, value-at-stake, RICE) ; calibrer
  SIM_BASE/coefficients sur summaries/quanti (win rate, marge, pipeline, exposition), pas sur les valeurs d'exemple.
- Ingestion idempotente (IDs déterministes) ; dashboards lisent summaries/* ; temps réel + offline.
- Respecter DELTA_01 §3 bis (plan d'alimentation, cartographie vue→source→priorité) et DELTA_01B (exécutif).

Méthode : 1) proposer firebase.json + arborescence + tokens.ts/ui.tsx + firestore.rules, attendre validation ;
2) dérouler la Roadmap V0→V8, phase par phase, avec tests (rules-unit-testing, Vitest parseurs+sim) et critères
d'acceptation ; pause et résumé à chaque fin de phase. Commence par V0.
```

---

## 16. Rappels
- La **maquette fait foi** pour l'apparence ; ce kit fait foi pour l'architecture, les données et les droits.
- Sources payantes/limitées à anticiper (Gartner/IDC ; portails AO sans API ; APIs régionales inégales).
- Prioriser (§9 / DELTA_01 §3 bis G) : **AO + réglementaire + EOL** en premier (valeur/effort).
- **On ne retire rien** : l'app réelle reproduit la maquette et la rend vivante, multi-utilisateurs et sécurisée.

*— Fin du kit Veille standalone —*
