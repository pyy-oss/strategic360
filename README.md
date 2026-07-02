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

## Checklist de déploiement (projet Firebase réel)

Étapes manuelles à réaliser avant toute mise en production, dans l'ordre :

1. **Créer le projet Firebase** dédié (ex. `veille-nt-ci`) sur console.firebase.google.com.
2. **Activer les APIs/produits** : Firestore (mode natif), Authentication, Cloud Functions
   (2ᵉ génération), Cloud Storage, Cloud Scheduler, et sur GCP Console : Vertex AI API, Firestore
   Admin API (généralement activée automatiquement avec Firestore).
3. **Auth** : activer les fournisseurs email/mot de passe (et SSO si besoin) ; dans
   Authentication > Sign-in method > Advanced, **activer la MFA multi-facteurs (TOTP)** — condition
   préalable pour que la bannière/flux d'enrôlement `MfaEnrollment.tsx` fonctionne réellement.
4. **App Check** : Authentication/App Check > Apps > enregistrer l'app web > fournisseur
   reCAPTCHA v3 > récupérer la clé de site, la placer dans `VITE_FIREBASE_APPCHECK_SITE_KEY`
   (voir `web/.env.example`). Démarrer en mode « surveillance » avant d'activer l'application
   stricte. Ne définir `APPCHECK_ENFORCE=true` côté Functions (voir `functions/index.js`) **qu'une
   fois** le client réellement déployé avec la clé configurée — sinon tous les appels échouent.
5. **Config Functions / variables d'environnement** : région Vertex AI (`vertex.js`), et le cas
   échéant `FIRESTORE_EXPORT_BUCKET` si un bucket dédié (autre que `{projet}.appspot.com`) est
   souhaité pour `scheduledFirestoreExport`. Accorder au compte de service des Functions le rôle
   `roles/datastore.importExportAdmin` (export planifié) et les droits d'écriture sur le bucket
   cible.
6. **Seed initial** : exécuter `functions/seed.js` contre le vrai projet (matrice `config/permissions`,
   `intelSources` initiales, `frameworks/*`, `scenarios`, `strategicThemes`).
7. **Déploiement** : `firebase deploy` (rules Firestore/Storage, indexes, functions, hosting) —
   idéalement d'abord sur un projet/canal de prévisualisation, puis en production.
8. **Premier compte `direction`** : appeler `setUserRole({ uid, role: "direction" })` une première
   fois (le bootstrap est autorisé tant qu'aucun `direction` n'existe, voir `config/bootstrap` dans
   `functions/index.js`) pour amorcer le RBAC — voir `docs/USER_GUIDE.md` pour la suite côté
   utilisateur final.
