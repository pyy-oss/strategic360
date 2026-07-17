# MIGRATION.md — Bascule vers un projet GCP dédié

Migration de l'app **Sentinel** (`strategic360`) du projet Firebase PARTAGÉ
`propulse-business-87f7a` vers un projet DÉDIÉ sur un autre compte Google Cloud.

| Composant | Aujourd'hui (partagé) | Cible (dédié) |
|---|---|---|
| App Sentinel | `propulse-business-87f7a` | **`sentinel-360`** (n° 876373263153) |
| App sœur nt360 (données internes) | `propulse-business-87f7a`, base nommée `nt360` | **`neurones-360`** (n° 165643317476), base nommée `nt360` — migrée en parallèle |
| Accès nt360 | même projet (`getFirestore("nt360")`) | **cross-projet, lecture seule** (IAM) |
| Base Firestore de l'app | nommée `strategic360` | nommée `strategic360` (à re-créer) |
| Région | europe-west1 | europe-west1 (inchangée) |

> Fondé sur l'audit pré-migration 2026-07 (63 findings vérifiés). Le modèle d'autorisation
> (firestore.rules + gates callables) est sain ; les risques sont d'infra/portabilité.

---

## Bloquants — état

| # | Bloquant | Traitement |
|---|---|---|
| B1 | Lecture cross-projet nt360 non câblée | ✅ **Corrigé code** : `NT360_PROJECT_ID` + `nt360Firestore()` (index.js) |
| B2 | IAM cross-projet absent | ⏳ Infra — étape 2 (grant `datastore.viewer`) |
| B3 | `.env` lié au nom du projet | ✅ **Fait** : `functions/.env.sentinel-360` + `.gitignore` |
| B4 | Custom claims RBAC perdus à l'import Auth | ⏳ Étape 4 (re-provisionner les claims) |
| B5 | Paramètres de hash scrypt Auth | ⏳ Étape 4 (récupérer AVANT export) |
| B6 | Buckets GCS globalement uniques | ✅ **Fait** : nouveaux noms dans `.env.sentinel-360` (à créer étape 2) |
| B7 | Vertex AI non provisionné | ⏳ Étape 2 |
| B8 | `.env.example` région 404 | ✅ **Corrigé** : `VERTEX_LOCATION=global` |
| B9 | Doc migration périmée | ✅ **Ce document** |

---

## Étape 1 — Correctifs code (FAIT, sur la branche)

- **B1** : `functions/index.js` — `NT360_PROJECT_ID` (vide = même projet, aucune régression ;
  renseigné = client `@google-cloud/firestore` projeté sur l'autre projet). Appliqué aux 2 call-sites
  (`runInternalQuantiSync`, `runSyncCopiloteAccounts`), lecture seule.
- **B3/B6** : `functions/.env.sentinel-360` (base `strategic360`, buckets dédiés,
  `NT360_PROJECT_ID=neurones-360`, `VERTEX_LOCATION=global`).
- **B8** : `functions/.env.example` → `VERTEX_LOCATION=global` + doc `NT360_PROJECT_ID` / `GEMINI_MODEL_EXTRACTION`.
- `backfillKpiHistory` → `onCall(CALLABLE_OPTS, …)` (déployait en us-central1 + jamais App-Check-enforcé).
- Doc : `adminSetUserRole.js` (13 rôles), README (section migration → ce runbook).

**Go/No-go étape 1** : `npm run test:unit` + `test:rules` verts, `web` build/typecheck verts.
NO-GO si le client cross-projet ne se construit pas.

---

## Étape 2 — Provisionner `sentinel-360` (ordre critique)

1. **Projet + facturation** : lier un compte de facturation (prérequis Vertex/Functions).
2. **Emplacements IMMUABLES** (une erreur ici impose de recréer le projet) :
   - Créer la base Firestore **nommée `strategic360`** (PAS `(default)`) en **europe-west1**.
   - Fixer App Engine / Cloud Scheduler en **europe-west1**.
3. **Activer les APIs** : `firestore`, `cloudfunctions`, `run`, `cloudbuild`, `artifactregistry`,
   `aiplatform` (Vertex), `firebaseappcheck`, `identitytoolkit` (Auth), `storage` + `firebasestorage`,
   `firebasehosting`, `cloudscheduler` + `pubsub`, `firebase`, `iam` (+ `secretmanager` si plan B Vertex).
4. **Buckets** : créer `sentinel-360.firebasestorage.app` (Storage, si pas auto-créé) et
   `sentinel-360-backups` (export). IAM : `datastore.importExportAdmin` + écriture au SA runtime.
5. **Vertex AI** : `roles/aiplatform.user` au SA runtime ; confirmer `gemini-3.5-flash` servi sur
   l'endpoint `global` ; demander une hausse de quota RPM (le pipeline rafale : `AI_CONCURRENCY=5`,
   évaluation jusqu'à 150 items/passe, enrichissement ~18 générations).
6. **SA de déploiement** : créer un SA dédié, rôles `firebase.admin`, `cloudbuild.builds.editor`,
   `artifactregistry.writer`, `iam.serviceAccountUser`, `firebasestorage.admin`, `cloudscheduler.admin`,
   `datastore.importExportAdmin` ; générer sa clé JSON → secret GitHub `GCP_SA_KEY_STRATEGIC360`.
7. **IAM cross-projet nt360** (B2) : sur **`neurones-360`**, accorder au SA **runtime** des Functions
   de `sentinel-360` (par défaut `876373263153-compute@developer.gserviceaccount.com`, à confirmer
   après 1er déploiement) le rôle **`roles/datastore.viewer`**. Sans ça : `PERMISSION_DENIED`.
8. **exportPdf** : self-grant `roles/iam.serviceAccountTokenCreator` au SA runtime (URL signées via
   l'API IAM `signBlob`, `exports/` étant read:false — seul canal du board-pack).
9. **Policy d'org** : vérifier `iam.allowedPolicyMemberDomains` (Domain Restricted Sharing) sur le
   nouveau compte. Si elle interdit `allUsers`, le binding `run.invoker` (deploy.yml) échoue en
   silence → tous les callables renvoient `internal`. Exempter le projet ou changer de stratégie.
10. **App Check** : enregistrer la web app, créer une **NOUVELLE clé reCAPTCHA v3**
    (`VITE_FIREBASE_APPCHECK_SITE_KEY`), autoriser les domaines Hosting, **mode monitor** d'abord.
11. **Hosting** : site `sentinelnt-360` — `firebase hosting:sites:create sentinelnt-360` +
    `firebase target:apply hosting strategic360 sentinelnt-360` (l'alias de cible `strategic360`
    de firebase.json pointe vers le site `sentinelnt-360`). Déjà câblé dans `.firebaserc`.

**À récupérer AVANT l'étape 4** : les 4 paramètres de hash scrypt de l'ancien projet (B5 — Console
Auth > paramètres de hash, ou Admin API) : `base64_signer_key`, `base64_salt_separator`, `rounds`, `mem_cost`.

**Go/No-go étape 2** : base nommée en bonne région ; APIs actives ; IAM cross-projet posé ;
`aiHealthCheck` **vert** sur `sentinel-360` ; binding `allUsers` accepté (ou alternative).
NO-GO si Vertex 404 ou cross-projet `PERMISSION_DENIED`.

---

## Étape 3 — Repointer la config CI/front (déploiement à blanc, sans trafic)

Config Firebase Web de `sentinel-360` (publique) :
```
apiKey            AIzaSyCykx2RuRoxsI9YTUL3xvRZp2_UcZ_P4c4
authDomain        sentinel-360.firebaseapp.com
projectId         sentinel-360
storageBucket     sentinel-360.firebasestorage.app
messagingSenderId 876373263153
appId             1:876373263153:web:09d412dfcf265259d6e610
```

À remplacer (ancien project-id → `sentinel-360`) :
- `.firebaserc` : `default` + `targets.sentinel-360.hosting.strategic360`.
- `firebase.json` : `storage.bucket` = `sentinel-360.firebasestorage.app` ; `firestore.database` = `strategic360`.
- `.github/workflows/deploy.yml` : bloc `env` VITE_FIREBASE_* (7 valeurs), `--project`, secret `GCP_SA_KEY_STRATEGIC360` (nouveau SA), `STORAGE_BUCKET_NAME`.
- Tous les `run-*-now.yml`, `cleanup/rescore/reset/seed/set-user-role/inspect/grant-copilote-invoker/read-*-logs` : `GCLOUD_PROJECT`/`--project` = `sentinel-360`. `set-user-role.yml` : `FIREBASE_WEB_API_KEY` (nouvelle apiKey web).
- `web/.env.local` (si utilisé hors CI) + nouvelle `VITE_FIREBASE_APPCHECK_SITE_KEY`.
- Recommandé : centraliser l'id projet via `vars.GCP_PROJECT` (GitHub) pour éviter les oublis.

**Go/No-go étape 3** : `firebase deploy` réussit ; les Functions démarrent sans throw (B3 OK) ;
callables trouvés en europe-west1. NO-GO si crash cold start.

---

## Étape 4 — Fenêtre de maintenance : migrer données + Auth

Prérequis : la migration de **nt360 → `neurones-360`** doit être TERMINÉE et la base peuplée (le
quanti interne de Sentinel en dépend). Sinon, basculer d'abord Sentinel en **veille seule** et
rebrancher le quanti après.

1. **Geler** : pauser les pipelines (`setPipelineConfig` `paused=true`, honoré par
   `gateScheduledPipeline`), passer le front en lecture seule, geler les inscriptions Auth. L'export
   managé = snapshot cohérent ; toute écriture postérieure est PERDUE.
2. **Firestore** : `gcloud firestore export --database=strategic360 gs://…` → transférer l'export vers
   un bucket lisible par le SA d'import de `sentinel-360` (grant cross-compte `storage.objectViewer`
   OU recopie gsutil/Storage Transfer) → `gcloud firestore import --database=strategic360` →
   `firebase deploy --only firestore:indexes` (les 7 index composites NE SONT PAS dans l'export).
3. **config/permissions** : si base neuve, re-seeder (`seed.js`) AVANT toute connexion (sinon
   `matrix()` deny généralisé). `firebase deploy --only firestore:rules`.
4. **Auth** : `firebase auth:export` → filtrer le sous-ensemble strategic360 (heuristique :
   `customAttributes.role` ∈ 13 rôles ; l'Auth partagée dumpe TOUS les users du projet) →
   `firebase auth:import` **en préservant `localId` (UID) + `customAttributes.role`** et en passant
   les 4 paramètres scrypt (B5), sinon mots de passe invalides.
5. **Claims RBAC** (B4) : re-provisionner tous les claims `role` via `adminSetUserRole.js` (SA, hors
   règles) après import ; (re)poser le premier `direction` (script, ou `config/bootstrap.done=false`
   + `ALLOW_ROLE_BOOTSTRAP=true` temporaire, puis retirer). Vérifier qu'aucun claim `role` parasite
   d'un autre tenant ne subsiste sur les comptes importés.
6. **Storage binaires** : l'export Firestore NE copie PAS les objets — recopier `imports/**` (.xlsx)
   et `exports/**` (PDF) vers les nouveaux buckets (gsutil -m cp / Storage Transfer), préfixes préservés.
7. **config/runtime** : vérifier que la cadence des pipelines est reprise (fail-open = cadence
   maximale = coût maximal silencieux).

**Go/No-go étape 4** : connexion d'un compte `direction` OK ; pas de deny massif ;
`config/permissions` présent ; mots de passe valides sur un échantillon. NO-GO sinon.

---

## Étape 5 — Cutover

DNS/Hosting → nouveau site ; reconfigurer authDomain / domaines autorisés / templates e-mail Auth ;
réactiver les pipelines (`paused=false`) ; recréer les jobs Cloud Scheduler (europe-west1) ;
re-exécuter le step `run.invoker` ; App Check monitor → **enforce** (`APPCHECK_ENFORCE=true` +
redeploy) UNIQUEMENT après confirmation du trafic attesté.

**Go/No-go** : le front prod parle à `sentinel-360`. Rollback = bascule DNS/Hosting + réactivation
des workflows sur l'ancien project-id (possible tant que l'ancien projet n'est pas purgé).

---

## Étape 6 — Vérification post-bascule

- **Priorité 1 (risque n°1)** : exécuter `syncInternalQuantiNow` + `syncCopiloteAccountsNow` et
  confirmer que `summaries/quanti` et l'empreinte nt360 des `copiloteAccounts` se rafraîchissent
  (= lecture cross-projet réelle vers `neurones-360` OK).
- exportPdf end-to-end (URL signée résolvable) ; briefing / enrichissement / copilote / digest ;
  `firestore.rules.test.js` contre l'émulateur ; jobs Scheduler présents ; quotas Vertex/Firestore surveillés.
- Vues Indicateurs / Valeur / Portefeuille / Simulateur alimentées ; RBAC cohérent par rôle.

**Après validation complète — nettoyage PII côté ancien compte** : purger la base nommée
`strategic360`, les buckets `imports/`/`exports/`, et surtout **`strategic360-backups`** (copie PII
financière complète) ; révoquer l'ancienne clé de service account. Sans ça, la donnée survit chez
l'ancien hébergeur.

---

## Optimisations coût IA (à activer pendant/après la migration)

- `GEMINI_MODEL_EXTRACTION` (classify/evaluate) : le câblage existe déjà ; définir un flash-lite
  MOINS cher dans `.env.sentinel-360` **après l'avoir validé via `aiHealthCheck`** (un modèle non
  servi sur `global` renvoie 404 = extraction cassée). Plus gros poste de volume.
- Contexte entreprise résumé pour les agents d'extraction (le complet reste pour briefing/copilote) ;
  envisager le context caching Vertex sur le préfixe stable (garde + date).
- `config/runtime` : LE levier de cadence (donc de coût). Migrer le doc et vérifier `intervals`/`paused`.
