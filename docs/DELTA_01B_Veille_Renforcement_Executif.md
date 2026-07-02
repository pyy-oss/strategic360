# DELTA 01-B — Veille Stratégique : RENFORCEMENT EXÉCUTIF (niveau 10/10)
### Additif au Delta 01 · conforme au KIT FINAL Firebase · on ne retire rien, on élève

> **But** : qu'un **DG**, un **Directeur de la Stratégie** ou un **Directeur de l'Innovation** note ce module **10/10**. Cela suppose de dépasser le fil d'actualité pour livrer un **système d'intelligence stratégique et d'aide à la décision** : anticipation, rigueur, priorisation chiffrée, cadres vivants connectés aux données, exécution stratégique et sorties « board-ready ».

---

## 0. La grille des 10 points (ce que note un dirigeant) → comment on y répond

| # | Attente d'un DG / CSO / CIO | Réponse du module |
|---|------------------------------|-------------------|
| 1 | **Décider, pas s'informer** | Chaîne Signal → Insight → Recommandation → **Décision** → Action → **Impact mesuré** (§2) + registre de décisions |
| 2 | **Anticiper (signaux faibles)** | Détection IA de signaux faibles, **3 horizons (H1/H2/H3)**, scénarios & wargaming (§5, §6) |
| 3 | **Prioriser avec rigueur** | **Score de priorité** multi-critères + **cotation source/info** (code de l'amirauté) + RICE (§3) |
| 4 | **Relier à la valeur** | Pipeline influencé, valeur d'opportunité, exposition au risque chiffrée ; **Win/Loss** vs concurrents (§4, §7) |
| 5 | **Cadres vivants, pas des slides** | SWOT/PESTEL/Porter/BCG/Canvas **alimentés par les données** du cockpit + alertes de dérive (§4) |
| 6 | **Intelligence concurrentielle** | **Battlecards**, timeline des mouvements, Win/Loss, positionnement (§7) |
| 7 | **Innovation pilotée** | **Tech Radar** (Adopter/Essayer/Évaluer/Suspendre) + portefeuille d'innovation (RICE) (§5) |
| 8 | **Exécution stratégique** | Piliers → **initiatives → OKR → porteurs**, cadence de revue, alignement signal→initiative (§8) |
| 9 | **Board-ready** | **Briefing exécutif auto (IA)**, one-pager/board pack PDF, KPIs stratégiques (§9, §10) |
| 10 | **Confiance & IA maîtrisée** | Provenance/audit, niveaux de confiance, **human-in-the-loop**, mesure du ROI de la veille (§11, §12) |

---

## 1. Positionnement

Le module devient un **poste de commandement stratégique** à trois focales, personnalisées par profil :
- **DG (Board)** : synthèse décisionnelle, KPIs stratégiques, menaces/opportunités majeures, décisions.
- **Directeur Stratégie** : cadres vivants, scénarios, positionnement concurrentiel, OKR & initiatives.
- **Directeur Innovation** : tech radar, portefeuille de paris, horizons, veille techno.

---

## 2. De l'information à la décision (le cœur du 10/10)

**Cycle du renseignement** appliqué, chaque signal traverse :
`Signal (item) → Analyse (so-what) → Insight → Recommandation → Décision → Action (initiative) → Impact mesuré`

Nouvelles entités :
- **`decisions/{id}`** — registre de décisions stratégiques : `{ title, context, options, chosen, rationale, decidedBy, date, linkedItems[], linkedInitiativeId?, reviewDate, outcome? }`. Traçabilité totale (qui a décidé quoi, sur quels signaux, quel résultat).
- Champs ajoutés à **`intelItems`** : `soWhat` (implication), `recommendedAction`, `owner`, `dueDate`, `priorityScore`, `sourceRating`, `confidence`, `decisionId?`, `initiativeId?`, `reviewStatus`.

Chaque signal *high-impact* **doit** recevoir un « so-what », une recommandation et un statut d'action (sinon il remonte comme *non traité* dans le radar exécutif). C'est ce qui distingue un outil noté 6 d'un outil noté 10.

---

## 3. Priorisation & rigueur analytique (chiffrée)

**3.1 Score de priorité d'un signal (0-100)** — recalculé par Cloud Function :
```
priorityScore = 100 × credibilite × (
    0.35·impact + 0.25·alignementStrategique + 0.20·probabilite + 0.20·proximite )
```
où chaque facteur ∈ [0,1] ; `impact` (faible/moyen/fort), `alignementStrategique` (lien avec un pilier stratégique), `probabilite`, `proximite` (échéance/urgence), `credibilite` (cf. 3.2). Tri du fil par score ; seuil d'alerte configurable.

**3.2 Cotation source & information (code de l'amirauté / OTAN)** — rigueur du renseignement :
- **Fiabilité source** : A (totalement fiable) → F (indéterminée).
- **Crédibilité info** : 1 (confirmée) → 5 (improbable).
- Affichage `A1`…`F5` ; `credibilite` numérique dérivée pour le score. Combat les biais et la désinformation.

**3.3 RICE / ICE** pour les paris (opportunités, innovation) : `RICE = (Reach × Impact × Confidence) / Effort`. Classe le portefeuille (§5).

**3.4 Niveaux de confiance & provenance** : chaque item porte sa source, sa date, son mode d'obtention (IA/analyste), son historique de révision (audit).

---

## 4. Cadres stratégiques VIVANTS (connectés aux données)

Les cadres du Delta 01 deviennent **dynamiques** : alimentés par le cockpit **et** les signaux, avec recalcul et **alertes de dérive**.
- **SWOT** : chaque force/faiblesse/opportunité/menace peut être **liée à des signaux** et à des **initiatives** ; badge « soutenu par N signaux récents » ; alerte si une menace gagne en fréquence/score.
- **PESTEL** : chaque facteur porte un **impact chiffré** et une tendance (↑/↓) alimentée par les items ; heatmap.
- **Porter (5 forces)** : forces **quantifiées par les données réelles** — *pouvoir fournisseurs* = concentration Top-3 fournisseurs (module Crédit Fournisseurs) ; *pouvoir clients* = concentration Top-5 clients ; *rivalité* = densité de signaux concurrents ; *substituts* = signaux cloud/SaaS. Radar à 5 axes actualisé.
- **BCG** : matrice à bulles **alimentée par les BU** (croissance = évolution CAS N/N-1, part = poids relatif, taille = marge) ; déplacement des bulles dans le temps.
- **Canvas** : blocs annotés par les signaux (ex. nouveau partenaire clé, nouveau segment détecté).
- **Ansoff / Three Horizons** : chaque initiative positionnée.

→ Un cadre n'est plus une slide figée : il **respire avec l'activité et le marché**, et **alerte** quand la position se dégrade. C'est décisif pour un Directeur Stratégie.

---

## 5. Innovation pilotée (pour le Directeur Innovation)

- **`techRadar/{blipId}`** : `{ name, quadrant (cyber|cloud|data_ia|reseau_infra|managed), ring (adopter|essayer|evaluer|suspendre), momentum (↑/→/↓), rationale, linkedItems[], updatedAt }`. Visualisation **radar** classique (4 anneaux × quadrants).
- **`innovationPortfolio/{id}`** : paris d'innovation notés **RICE**, matrice **effort × impact**, statut (idée→POC→pilote→industrialisation), porteur, budget, lien AO/opportunité.
- **Three Horizons (H1/H2/H3)** : cœur de métier / adjacent / rupture — chaque initiative et pari classé, pour équilibrer le portefeuille.
- **Scanning techno** : items `axis:tech` clusterisés en **tendances** (IA générative, cloud souverain, XDR, SASE…) avec courbe d'attention (proto « hype cycle » interne).

---

## 6. Scénarios & wargaming (anticipation)

- **`scenarios/{id}`** : planification par scénarios (**matrice 2×2** sur deux axes d'incertitude majeurs, ex. *souveraineté réglementaire* × *pression prix hyperscalers*) → 4 mondes, implications par BU, signaux déclencheurs (early warning), réponses préparées.
- **Simulation « what-if » stratégique** : ex. « un éditeur durcit son programme canal (−5 pts de rebate) » → impact chiffré sur marge/pipeline en s'appuyant sur les données du cockpit ; « un concurrent gagne le compte X » → impact backlog/part.
- **Wargaming concurrentiel** : anticiper la réaction d'un concurrent à un mouvement de Neurones (et inversement) ; consigné et relié aux battlecards.

---

## 7. Intelligence concurrentielle (pour DG & Stratégie)

- **`battlecards/{competitorId}`** : `{ competitor, positioning, strengths[], weaknesses[], ourWinThemes[], theirLikelyMoves[], objectionHandling[], recentMoves[] }` — fiche de combat prête pour les commerciaux.
- **Win/Loss** : `winLoss/{oppId}` relié au **Pipeline** — chaque opportunité gagnée/perdue **contre un concurrent identifié**, motif, prix, leçon. Statistiques : **taux de victoire par concurrent**, motifs de perte récurrents.
- **Timeline des mouvements concurrents** + **part de voix** (volume de signaux) + **matrice de positionnement** (2 axes : couverture d'offre × force sur le marché).

---

## 8. Exécution stratégique & gouvernance

- **`strategicThemes/{id}`** (piliers) → **`initiatives/{id}`** `{ title, themeId, objective, keyResults[] (OKR), owner, status, horizon, dueDate, linkedItems[], linkedDecisionId?, progress }`.
- **Alignement** : un signal → une recommandation → une **initiative** → un **OKR** → un **pilier**. On voit, de bout en bout, comment le marché infléchit la stratégie et son exécution.
- **Cadence de revue** intégrée : **hebdo** (radar & signaux), **mensuelle** (CODIR : cadres + initiatives), **trimestrielle** (board : scénarios + OKR). Chaque revue génère un pack.
- **Registre de décisions** (§2) comme mémoire institutionnelle.

---

## 9. Sorties « board-ready » (IA + export)

- **Briefing exécutif auto-généré** (`briefings/{id}`, Vertex AI/Gemini) : « Top 5 signaux prioritaires · 3 menaces · 3 opportunités · recommandations · décisions en attente », en 1 page, à la fréquence choisie. Revue humaine avant diffusion.
- **Board pack / one-pager stratégique** exporté en **PDF** (KPIs, cadres, scénarios, initiatives, décisions).
- **Vue Board** synthétique et sobre (le DG voit l'essentiel en 30 secondes).

---

## 10. KPIs stratégiques (tableau de bord exécutif)

- **Valeur du pipeline influencée par la veille** (opportunités issues de signaux, en FCFA).
- **Menaces neutralisées / en cours** (nombre, exposition évitée).
- **Time-to-insight** et **time-to-action** (délai signal→décision).
- **Taux d'action sur signaux high-impact** (couverture décisionnelle).
- **Avancement OKR** des initiatives stratégiques.
- **Fraîcheur & couverture** de la watchlist (entités sans signal récent = angle mort).
- **Indice de position concurrentielle** (Porter agrégé) et **taux de victoire** vs concurrents.

---

## 11. IA augmentée (human-in-the-loop) — Vertex AI / Gemini

Fonctions IA (Cloud Functions, revue humaine obligatoire avant publication) :
- **Résumé + classification** (axe, sous-type, impact, posture, entité) et **entity resolution** (rapprochement watchlist/clients/fournisseurs).
- **Détection de signaux faibles** : clustering thématique + anomalies de fréquence/ton.
- **Génération du « so-what »** et **suggestion d'action** par signal.
- **Synthèse de tendances** et **rédaction du briefing** exécutif.
- **Détection de mouvements concurrents** à partir des flux.
- Garde-fous : provenance, niveau de confiance affiché, pas de publication auto (statut `new→reviewed`), audit complet, journalisation des prompts/sorties.

---

## 12. Mesure de la valeur de la veille (méta)

Le module **prouve son ROI** : opportunités générées (FCFA), risques évités, décisions éclairées, délais d'insight. Un dirigeant note 10/10 un outil qui **démontre** sa contribution à la performance — pas seulement qui affiche des news.

---

## 13. Modèle Firestore — additions (diff)

```
decisions/{id}            { title, context, options[], chosen, rationale, decidedBy, date,
                            linkedItems[], linkedInitiativeId?, reviewDate, outcome? }
strategicThemes/{id}      { title, description, owner, order }
initiatives/{id}          { title, themeId, objective, keyResults[], owner, status, horizon,
                            dueDate, progress, linkedItems[], linkedDecisionId? }
techRadar/{blipId}        { name, quadrant, ring, momentum, rationale, linkedItems[], updatedAt }
innovationPortfolio/{id}  { title, reach, impact, confidence, effort, rice, stage, owner,
                            budget, horizon, linkedOppFp? }
scenarios/{id}            { title, axisX, axisY, worlds[4], triggers[], responses[], updatedBy }
battlecards/{competitorId}{ competitor, positioning, strengths[], weaknesses[], ourWinThemes[],
                            theirLikelyMoves[], objectionHandling[], recentMoves[] }
winLoss/{oppFp}           { competitor, result, reason, amount, lesson, date }   // relié au Pipeline
briefings/{id}            { period, content, kpis, generatedBy, reviewedBy, status, createdAt }

// intelItems : + priorityScore, sourceRating (A1..F5), confidence, soWhat,
//              recommendedAction, owner, dueDate, decisionId?, initiativeId?, reviewStatus
// frameworks/* : + liens signaux/initiatives, valeurs dérivées des données, tendance
summaries/veille_exec     { boardKpis, topDecisionsPending, positionPorter, winRateByCompetitor,
                            pipelineInfluencedValue, threatsExposure, okrProgress, updatedAt }
```

---

## 14. Impacts transverses (signalés)

1. **Profils exécutifs** : ajouter (recommandé) les rôles **`strategie`** et **`innovation`** à `roles`, en plus de `direction` — vues personnalisées (Board / Stratégie / Innovation). *Aligné avec ton futur périmètre DGA Stratégie, Innovation & Opérations.*
2. **`config/permissions`** : `veille` = `write` pour `direction/strategie/innovation`, contribution `commercial_dir/commercial`, lecture sinon. Cadres, scénarios, décisions, OKR : édition **exécutive** (direction/strategie/innovation) ; battlecards : contribution commerciale ; tech radar/portefeuille : innovation.
3. **`firestore.rules`** : matches pour `decisions, strategicThemes, initiatives, techRadar, innovationPortfolio, scenarios, battlecards, winLoss, briefings` (lecture `canRead('veille')`, écriture selon sous-domaine) ; `summaries/veille_exec` en lecture, écriture Functions.
4. **`firestore.indexes.json`** : `intelItems(priorityScore DESC)`, `initiatives(themeId, status)`, `winLoss(competitor, date)`, `techRadar(quadrant, ring)`.
5. **Cloud Functions** : `aggregateVeilleExec` (→ `summaries/veille_exec`), `scoreItems` (priorité), `generateBriefing` (IA), `detectWeakSignals` (IA), `syncWinLoss` (depuis Pipeline).
6. **Passerelles renforcées** : Pipeline (Win/Loss, opportunités issues de signaux), Crédit Fournisseurs (Porter/pouvoir fournisseurs, alertes EOL), Objectifs/OKR (initiatives ↔ R/O), Prévision/Atterrissage (scénarios what-if).
7. **Delta strictement additif** — les 13 modules et le Delta 01 restent intacts.

---

## 15. Critères d'acceptation « 10/10 »

- Chaque signal *high-impact* possède **so-what + recommandation + owner + statut** ; les non traités remontent au radar exécutif.
- Le **score de priorité** et la **cotation source (A1..F5)** sont calculés et pilotent le tri/alertes.
- Les **cadres sont vivants** : Porter reflète les concentrations réelles (fournisseurs/clients), BCG bouge avec les BU, SWOT/PESTEL alertent sur dérive.
- Le **Tech Radar** et le **portefeuille d'innovation (RICE)** sont opérationnels et priorisés.
- **Win/Loss** relié au Pipeline produit un **taux de victoire par concurrent**.
- Un **scénario what-if** chiffre un impact sur marge/pipeline/backlog.
- Le **briefing exécutif** est généré (IA) puis validé (humain) et exporté en **board pack PDF**.
- Le tableau de bord affiche les **KPIs stratégiques** dont la **valeur de pipeline influencée** et l'**avancement OKR**.
- Vues **personnalisées** DG / Stratégie / Innovation.
- **Test 10/10** : un DG/CSO/CIO peut, en une session, comprendre la situation, décider, assigner, et suivre l'impact — sans quitter le module.

---

## 16. Prochaine action
Dis-moi le **niveau** pour ce renforcement : (a) l'intégrer à la spec Veille consolidée, (b) squelette de code (React + Functions IA), ou (c) implémentation. Et confirme l'ajout des **rôles `strategie` et `innovation`** (recommandé) — je peux aussi pré-remplir un **premier Tech Radar** et des **battlecards** de tes concurrents connus.

*— Fin du Delta 01-B (renforcement exécutif) —*
