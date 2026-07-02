# Veille Stratégique — Neurones Technologies CI

Application autonome de veille stratégique (module Firebase dédié) pour Neurones Technologies CI.

**Spécification faisant autorité** : [`docs/BUILD_KIT.md`](docs/BUILD_KIT.md) (architecture, modèle
Firestore, RBAC, Cloud Functions, roadmap V0→V8). En cas de doute sur l'apparence, la maquette
[`docs/maquette_reference.jsx`](docs/maquette_reference.jsx) fait foi — voir aussi
[`docs/DELTA_01_Veille_Strategique.md`](docs/DELTA_01_Veille_Strategique.md) et
[`docs/DELTA_01B_Veille_Renforcement_Executif.md`](docs/DELTA_01B_Veille_Renforcement_Executif.md).

## Démarrer

```bash
cd web
npm install
npm run dev
```

Autres commandes utiles (dans `web/`) : `npm run build`, `npm run preview`, `npm run typecheck`, `npm run lint`.

Pour les Cloud Functions (squelette V0, non déployé) :

```bash
cd functions
npm install
```

## Statut actuel — V0 à V8 implémentées

L'ensemble de la roadmap `docs/BUILD_KIT.md` §13 (V0 Socle & design → V8 Durcissement) est
implémenté dans ce dépôt :

- **V0-V1** : coque applicative fidèle à la maquette (`web/src/design/tokens.ts`+`ui.tsx`, 15 vues
  sous `web/src/modules/veille/views/`), Firebase Auth + custom claims (8 rôles), `setUserRole`,
  `firestore.rules` opposables + tests de règles par profil (`functions/test/firestore.rules.test.js`).
- **V2-V3** : `intelItems` (CRUD contribution, Fil de veille, Radar de détection), `scoreItems`
  (score de priorité §8.1), `aggregateVeille`/`aggregateVeilleExec` → Radar exécutif temps réel.
- **V4-V5** : `ingestInternal` (SheetJS P&L/LIVE/Facturation/fiche) → `summaries/quanti` → Cadres
  (Porter/BCG), Portefeuille, Création de valeur, Indicateurs avancés ; Simulateur stratégique
  (`domain/sim.js`, tornado, comparaison de scénarios).
- **V6** : Exécution & décisions, Plan d'action, Concurrence, Scénarios, Diagnostic, Tech Radar &
  Innovation, sur `initiatives`/`decisions`/`actions`/`battlecards`/`winLoss`.
- **V7** : `syncSources` + `classifyAI` (Vertex AI/Gemini), `generateBriefing` (pyramide de Minto,
  revue humaine), `exportPdf` (board pack PDF via pdfkit → Cloud Storage).
- **V8 (Durcissement)** : App Check (client `web/src/lib/firebase.ts` + `enforceAppCheck` opt-in
  côté Functions), bannière MFA pour les rôles exécutifs (`web/src/modules/auth/MfaEnrollment.tsx`,
  flux TOTP câblé via le SDK Firebase Auth), export Firestore planifié quotidien
  (`functions/index.js#scheduledFirestoreExport`), couverture de tests portée à ~90 % sur la
  logique métier pure (`functions/domain/*.js`), passe d'observabilité (logs `logger.error`
  cohérents sur tous les triggers), et ce guide utilisateur (`docs/USER_GUIDE.md`).

**Important — déploiement réel** : ce dépôt a été développé dans un environnement sandbox **sans
projet Firebase/GCP réel provisionné**. Tout ce qui nécessite une infrastructure live (App Check
effectivement appliqué, MFA réellement activable, export Firestore planifié, Vertex AI en
production) est écrit et prêt au déploiement mais **non testé en conditions réelles**. Voir
`docs/BUILD_KIT.md` pour l'architecture/spec complète, et la checklist ci-dessous pour la mise en
production.

## Déploiement dans un projet Firebase PARTAGÉ (configuration actuelle)

Ce dépôt est actuellement configuré pour déployer dans **`propulse-business-87f7a`**, un projet
Firebase qui héberge **aussi d'autres applications**. `.firebaserc`/`firebase.json` pointent donc
vers des ressources **dédiées** à cette app, pas les ressources par défaut du projet :

| Ressource | Par défaut (partagé) | Utilisé par cette app |
|---|---|---|
| Site Hosting | site par défaut du projet | site nommé **`strategic360`** (`firebase.json` → `hosting.target`, mappé dans `.firebaserc`) |
| Base Firestore | `(default)` | base **nommée `strategic360`** (`firebase.json` → `firestore.database`, `functions/.env.propulse-business-87f7a` → `FIRESTORE_DATABASE_ID`, `web/.env.local` → `VITE_FIREBASE_FIRESTORE_DATABASE_ID`) — une base nommée est une base Firestore **entièrement séparée** de `(default)`, aucune collision possible avec les données des autres apps |
| Bucket Storage | bucket par défaut (`{projet}.appspot.com`) | bucket dédié **`strategic360`** (`firebase.json` → `storage.bucket`, `functions/.env.propulse-business-87f7a` → `STORAGE_BUCKET_NAME`) |
| Codebase Functions | `default` | codebase nommé **`veille`** (`firebase.json` → `functions[0].codebase`) — `firebase deploy --only functions` ne touche que les fonctions de ce codebase, jamais celles d'une autre app |

**Ce qui reste PARTAGÉ malgré tout (limite structurelle Firebase, pas une négligence)** :
- **Authentication** : un seul pool d'utilisateurs par projet, quel que soit le nombre d'apps —
  impossible à cloisonner sans Identity Platform multi-tenant (fonctionnalité payante, hors
  périmètre ici). `setUserRole` (`functions/index.js`) **fusionne** les custom claims existants au
  lieu de les écraser, pour ne jamais effacer un claim posé par une autre app sur le même compte —
  mais un même utilisateur reste un même compte pour toutes les apps du projet.
- **Noms des Cloud Functions** : les noms de fonctions (`scoreItems`, `setUserRole`, …) doivent
  être uniques dans le projet, tous codebases confondus. Avant le tout premier déploiement,
  **vérifier dans la console Cloud Functions qu'aucune fonction existante ne porte l'un des noms de
  `functions/index.js`** — un nom en collision écraserait la fonction de l'autre app.

Étapes de déploiement, dans l'ordre :

1. **Vérifier les ressources dédiées côté Console** : site Hosting `strategic360` (déjà créé),
   bucket Storage `strategic360` (déjà créé), base Firestore nommée `strategic360` (déjà créée) —
   confirmé sur vos captures. Si l'un manque, le créer avant de continuer.
2. **Auth** : activer les fournisseurs email/mot de passe (et SSO si besoin) ; dans
   Authentication > Sign-in method > Advanced, **activer la MFA multi-facteurs (TOTP)** — condition
   préalable pour que la bannière/flux d'enrôlement `MfaEnrollment.tsx` fonctionne réellement.
   *(Activer la MFA au niveau projet affecte potentiellement les autres apps du projet — vérifier
   avec leurs équipes avant d'activer.)*
3. **App Check** : Authentication/App Check > Apps > enregistrer l'app web `strategic360` >
   fournisseur reCAPTCHA v3 > récupérer la clé de site, la placer dans `web/.env.local` →
   `VITE_FIREBASE_APPCHECK_SITE_KEY`. Démarrer en mode « surveillance » avant d'activer
   l'application stricte. Ne définir `APPCHECK_ENFORCE=true` dans
   `functions/.env.propulse-business-87f7a` **qu'une fois** le client réellement déployé avec la
   clé configurée — sinon tous les appels échouent.
4. **Vertex AI** : activer l'API Vertex AI sur le projet GCP `propulse-business-87f7a` si ce n'est
   pas déjà fait (potentiellement déjà activée pour une autre app — vérifier avant, ne rien
   désactiver). Ajuster `VERTEX_LOCATION` dans `functions/.env.propulse-business-87f7a` si besoin.
5. **Export Firestore planifié** : accorder au compte de service des Functions le rôle
   `roles/datastore.importExportAdmin` et les droits d'écriture sur le bucket cible de
   `scheduledFirestoreExport` (`functions/index.js`).
6. **Seed initial** : `cd functions && npm install`, puis (avec des identifiants ayant accès au
   projet, ex. `GOOGLE_APPLICATION_CREDENTIALS` vers une clé de compte de service) :
   ```bash
   GCLOUD_PROJECT=propulse-business-87f7a FIRESTORE_DATABASE_ID=strategic360 node functions/seed.js
   ```
   Seed uniquement `config/permissions`, `intelSources`, `frameworks/*`, `scenarios`,
   `strategicThemes`, etc. **dans la base nommée `strategic360`** — n'écrit jamais dans `(default)`.
7. **Déploiement** :
   ```bash
   firebase deploy --project propulse-business-87f7a \
     --only hosting:strategic360,firestore:strategic360,storage,functions:veille
   ```
   (adapter la syntaxe exacte selon la version de `firebase-tools` installée — `firebase --version`
   avant de déployer ; le support des bases Firestore nommées dans `firebase.json`/le CLI nécessite
   une version raisonnablement récente). Toujours vérifier le `firebase deploy --only ... --dry-run`
   ou passer par un canal de prévisualisation avant la première production si disponible.
8. **Premier compte `direction`** : appeler `setUserRole({ uid, role: "direction" })` une première
   fois (le bootstrap est autorisé tant qu'aucun `direction` n'existe pour CETTE app, voir
   `config/bootstrap` dans la base `strategic360`) pour amorcer le RBAC — voir
   `docs/USER_GUIDE.md` pour la suite côté utilisateur final.

### Déployer plutôt dans un projet Firebase dédié (alternative)

Si un projet Firebase séparé est préférable (isolation complète, y compris Auth), il suffit de :
remettre `.firebaserc` sur le nouveau `project-id`, retirer `hosting.target`/`firestore.database`/
`storage.bucket` de `firebase.json` (ou les adapter au nouveau projet), et laisser
`FIRESTORE_DATABASE_ID`/`STORAGE_BUCKET_NAME` vides (comportement par défaut du code — voir
`functions/.env.example`).
