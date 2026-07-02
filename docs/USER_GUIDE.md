# Guide utilisateur — Veille Stratégique (Neurones Technologies CI)

*Ce guide s'adresse aux utilisateurs de l'application, pas aux développeurs. Pour l'architecture
technique, voir [`BUILD_KIT.md`](BUILD_KIT.md).*

## 1. À quoi sert l'application ?

**Veille Stratégique** centralise, pour Neurones Technologies CI, tout ce qui permet de **détecter**
(signaux du marché, de la concurrence, de la réglementation, de la technologie) et de **quantifier**
(chiffres internes : ventes, marge, pipeline commercial) la situation de l'entreprise, afin d'éclairer
les décisions de la Direction. Elle réunit en un seul endroit :

- un **fil de veille** alimenté par des sources externes et par les équipes elles-mêmes,
- des **cadres d'analyse stratégique** classiques (SWOT, PESTEL, Porter, BCG, Canvas…),
- un **simulateur** pour tester l'impact de décisions (ex. « et si on investit plus dans le cloud ? »),
- le suivi de l'**exécution** (initiatives, décisions, plan d'action),
- des **briefings exécutifs** générés automatiquement puis validés par un humain avant diffusion.

Rien n'est jamais publié automatiquement par l'intelligence artificielle sans relecture humaine.

## 2. Les 3 focales et les 15 onglets

En haut de l'écran, un sélecteur permet de changer de **focale** (angle de lecture) :

- **DG (Board)** — vue synthétique orientée décisions/gouvernance.
- **Stratégie** — vue orientée cadres d'analyse, portefeuille, concurrence.
- **Innovation** — vue orientée technologies émergentes, portefeuille d'initiatives.

La focale change l'emphase de certains écrans (ex. le Radar exécutif), mais les 15 onglets restent
toujours accessibles (sous réserve de vos droits) :

| Onglet | Ce qu'on y trouve |
|---|---|
| Radar exécutif | Indicateurs clés, signaux les plus prioritaires, carte menaces/opportunités, décisions en cours |
| Fil de veille | Tous les signaux, filtrables par thème, avec leur score de priorité |
| Radar de détection | Vue « sonar » des événements par catégorie, imminence et impact |
| Indicateurs avancés | 10 indicateurs précurseurs (KRI) avec tendance et seuils d'alerte |
| Cadres stratégiques | SWOT, PESTEL, Porter, BCG, Canvas |
| Portefeuille & Croissance | Matrice GE-McKinsey, horizons de croissance, où investir |
| Création de valeur | Pont de valeur, enjeux financiers, leviers |
| Simulateur stratégique | Curseurs de décision → impact sur revenu/marge/score, comparaison de scénarios |
| Diagnostic | Analyse structurée (arbre MECE), 7S, maturité des capacités |
| Tech Radar & Innovation | Radar technologique (Adopter/Essayer/Évaluer/Suspendre), portefeuille d'idées |
| Concurrence | Fiches concurrents, taux de victoire par appel d'offres |
| Scénarios | Matrice de scénarios probabilisés, simulations « et si » |
| Exécution & Décisions | Suivi des initiatives/objectifs, registre des décisions |
| Plan d'action | Actions priorisées par impact/urgence, valeur attendue, échéance |
| Briefing exécutif | Synthèse structurée (idée directrice + arguments), export en document pour le Board |

## 3. Qui peut faire quoi (RBAC)

Chaque utilisateur a **un seul rôle**, attribué par la Direction :

| Rôle | Accès typique |
|---|---|
| `direction` | Accès complet, y compris administration des rôles |
| `strategie` | Lecture/écriture sur les cadres, décisions, scénarios, briefings |
| `innovation` | Lecture/écriture sur le radar technologique et le portefeuille d'innovation, plus les mêmes droits stratégiques |
| `commercial_dir`, `commercial` | Contribution au fil de veille, accès aux battlecards concurrence |
| `pmo`, `achats` | Lecture sur la veille |
| `lecture` | Lecture seule |

Ce que vous voyez à l'écran s'adapte automatiquement à votre rôle (boutons masqués/désactivés si
vous n'avez pas le droit). Mais **ce n'est pas l'interface qui décide** : même si un bouton était
accessible par erreur, le serveur (règles de sécurité Firestore) refuserait toute écriture non
autorisée. En cas de doute sur votre rôle, contactez un utilisateur `direction`.

## 4. Contribuer un signal (Fil de veille)

1. Ouvrez l'onglet **Fil de veille**.
2. Si vous avez les droits de contribution, un bouton « Nouvelle fiche de veille » permet de
   soumettre un signal : titre, résumé, source, axe (partenaires / concurrents / clients &
   prospects / tendances tech / réglementaire), niveau d'impact perçu.
3. Le signal apparaît avec le statut **« nouveau »**. Un score de priorité (0-100) est calculé
   automatiquement à partir de la fiabilité de la source, de l'impact, de l'urgence et de
   l'alignement stratégique — il sert à trier et à faire remonter ce qui compte le plus.
4. Les signaux détectés automatiquement (sources externes suivies quotidiennement, puis classés
   par IA) arrivent avec le même statut « nouveau » : ils doivent être **relus et validés** par un
   utilisateur habilité avant d'être considérés comme fiables (passage à « revu »/« traité »).

## 5. Comment les briefings sont générés et validés

1. Un utilisateur exécutif (direction/stratégie/innovation) déclenche la génération d'un briefing
   depuis l'onglet **Briefing exécutif**.
2. L'IA (Vertex AI/Gemini) analyse les signaux les plus prioritaires et les indicateurs du moment,
   et produit une synthèse au format **pyramide de Minto** : une idée directrice, appuyée par
   3 arguments structurés, avec les indicateurs clés associés.
3. Ce brouillon est marqué comme **non revu** — il ne doit pas être diffusé tel quel. Un exécutif
   le relit, l'ajuste si besoin, puis peut l'exporter en document PDF (« board pack ») prêt à être
   partagé en comité de direction.

## 6. Prise en main rapide — nouvel utilisateur exécutif

1. **Connexion** : rendez-vous sur l'URL de l'application, connectez-vous avec l'email fourni par
   la Direction (celle-ci a dû au préalable vous attribuer un rôle via `setUserRole`).
2. **Sécurité (MFA)** : si votre rôle est `direction`, `strategie` ou `innovation`, un bandeau doré
   apparaît en haut de l'écran vous invitant à activer l'authentification à deux facteurs (MFA,
   via une application comme Google Authenticator). Ce n'est pas bloquant dans l'immédiat, mais
   fortement recommandé compte tenu des données auxquelles vous avez accès — cliquez sur
   « Configurer la MFA » et suivez les instructions (scanner le QR code, saisir le code à 6
   chiffres).
3. **Explorer le Radar exécutif** : c'est l'onglet par défaut à la connexion. Vous y trouverez en un
   coup d'œil les indicateurs clés, les signaux les plus critiques du moment (menaces/opportunités)
   et les décisions en attente.
4. **Changer de focale** en haut à droite (DG / Stratégie / Innovation) selon l'angle qui vous
   intéresse, puis naviguez entre les 15 onglets via la barre du haut.
5. Pour toute question sur vos droits d'accès ou pour signaler un problème, contactez un
   utilisateur `direction`.
