# MIGRATION-2.md — Bascule d'urgence vers un projet GCP neuf (incident sécurité 2026-07)

**Contexte** : le projet `sentinel-360` a été **compromis** (compte Google/GCP piraté). On ne
répare pas un projet compromis : on **reprovisionne un projet neuf propre** et on considère
`sentinel-360` comme perdu (à purger puis supprimer). Ce document reprend la mécanique éprouvée de
`docs/MIGRATION.md` (propulse → sentinel-360) en l'adaptant au contexte d'incident.

> L'enquête dépôt (2026-07-23) a confirmé que **le code n'est pas le vecteur** : aucune clé privée
> dans l'historique git, aucun workflow exfiltrant de secret, aucun committer inconnu. La
> compromission vient du compte Google/GCP lui-même. Le repo peut donc être réutilisé tel quel.

## Outils fournis

- `migration/target.env.example` — modèle des identifiants du **nouveau** projet (à copier en
  `migration/target.env`, gitignoré, et remplir).
- `scripts/retarget-project.sh` — réécrit toute la surface de config déterministe
  (`.firebaserc`, `firebase.json`, `functions/.env.<projet>`, 17 workflows) de l'ancien projet vers
  le nouveau. `DRY_RUN=1` pour prévisualiser. Il **ne touche pas** au code source : il en **liste**
  les occurrences résiduelles à traiter à la main.
- `.audit/CHECKLIST-nouveau-projet.md` — garde-fous jour-0 (export facturation, budget, quotas,
  nettoyage AR, hook) à appliquer AU NOUVEAU projet dès sa création.

---

## Étape A — Prérequis sécurité (BLOQUANT — ne pas démarrer avant)

1. **Containment terminé** : compte Gmail `p.yyoro@gmail.com` repris en main (mot de passe changé,
   sessions révoquées, 2FA active, méthodes de récupération et apps OAuth nettoyées) ; GitHub idem.
2. **Nouveau projet sur un socle sain** : idéalement un **compte de facturation propre** et un
   compte propriétaire à MFA matérielle. Ne pas rattacher le nouveau projet au compte encore en
   cours d'investigation.
3. **Nouveau compte de service de déploiement** dédié (jamais l'ancien) → sa clé JSON ira dans le
   secret GitHub `GCP_SA_KEY_STRATEGIC360` (même nom, nouvelle valeur).

## Étape B — Provisionner le nouveau projet

Suivre **`docs/MIGRATION.md` § Étape 2** à l'identique (elle est éprouvée), en remplaçant
`sentinel-360` par le nouvel id. Points immuables à ne pas rater :

- Base Firestore **NOMMÉE `sentinel360`** (pas `(default)`), **europe-west1**, type firestore-native.
- App Engine / Cloud Scheduler en **europe-west1**.
- APIs activées (firestore, cloudfunctions, run, cloudbuild, artifactregistry, aiplatform,
  firebaseappcheck, identitytoolkit, storage/firebasestorage, firebasehosting, cloudscheduler,
  pubsub, firebase, iam).
- Buckets `<projet>.firebasestorage.app` + `<projet>-backups`.
- Vertex `roles/aiplatform.user` au SA runtime ; confirmer `gemini-3.5-flash` sur endpoint `global`.
- SA de déploiement (rôles : firebase.admin, cloudbuild.builds.editor, artifactregistry.writer,
  iam.serviceAccountUser, firebasestorage.admin, cloudscheduler.admin, datastore.importExportAdmin).
- **IAM cross-projet nt360** : accorder au SA runtime du nouveau projet `roles/datastore.viewer` sur
  le projet hôte de la base `nt360` (aujourd'hui `propulse-business-87f7a`).
- Org policy `iam.allowedPolicyMemberDomains` : autoriser `allUsers` (sinon le binding `run.invoker`
  échoue en silence → callables `internal`).
- Hosting : `firebase hosting:sites:create <site>` + `firebase target:apply hosting strategic360 <site>`.
- **Appliquer `.audit/CHECKLIST-nouveau-projet.md`** (export facturation dès le jour 0 — non rétroactif).

## Étape C — Repointer la config du dépôt (déploiement à blanc, sans données)

```bash
cp migration/target.env.example migration/target.env   # puis remplir avec le nouveau projet
DRY_RUN=1 ./scripts/retarget-project.sh                 # prévisualiser tous les changements
./scripts/retarget-project.sh                           # appliquer
```

Puis traiter les **occurrences résiduelles** que le script signale (il ne les modifie pas seul) :

- `web/src/modules/veille/views/Integrations.tsx` — l'URL en dur du webhook entrant
  `https://europe-west1-<projet>.cloudfunctions.net/webhookInbound` : remplacer par le nouvel id.
- `functions/domain/webhooks.js` (label `source` par défaut) + `functions/test/webhooks.domain.test.js`
  (assertion associée) : mettre à jour ensemble si l'on veut renommer la source.
- `functions/index.js:538` : commentaire historique — laisser.
- `web/.env.local` (gitignoré) : régénérer avec la config web du nouveau projet.

Vérifier avant de committer :
`cd functions && npm run test:unit && npm run lint` · `cd web && npm run typecheck && npm run lint && npm run build`.

**Go/No-go C** : `firebase deploy` réussit ; Functions démarrent sans throw ; callables en europe-west1.

## Étape D — Données (décision de sécurité critique)

⚠️ **Ne pas ré-importer aveuglément les données du projet compromis** : elles ont pu être
altérées/piégées pendant l'intrusion.

1. **Source préférée = backup ANTÉRIEUR à l'intrusion** : l'app exporte Firestore chaque jour à
   02:00 vers `<ancien>-backups`. Choisir un export **daté d'avant** la fenêtre de compromission,
   **si ce bucket lui-même n'a pas été touché** (vérifier via Cloud Audit Logs). Importer dans la
   base `sentinel360` du nouveau projet (`gcloud firestore import`), puis
   `firebase deploy --only firestore:indexes` (les 7 index composites ne sont pas dans l'export).
2. Si les backups sont aussi suspects : repartir du dernier état de confiance connu, ou reconstruire
   le référentiel (sources de veille via `seed.js`) et ré-agréger — plutôt que d'importer du douteux.
3. **config/permissions** : re-seeder (`seed.js`) AVANT toute connexion (sinon deny généralisé).
4. **Auth** : re-provisionner les comptes + claims `role` (`adminSetUserRole.js`). Après une
   compromission, **forcer la réinitialisation de tous les mots de passe** plutôt que de réimporter
   les hash de l'ancien projet.
5. **Storage binaires** (`imports/**`, `exports/**`) : recopier depuis une source de confiance
   seulement.

**Go/No-go D** : connexion d'un compte `direction` OK ; `config/permissions` présent ; pas de deny massif.

## Étape E — Cutover

DNS/Hosting → nouveau site ; authDomain / domaines autorisés / templates e-mail Auth ; réactiver les
pipelines (`config/runtime` `paused=false`) ; recréer les jobs Cloud Scheduler (europe-west1) ;
re-exécuter le step `run.invoker` ; App Check monitor → **enforce** seulement après trafic attesté.

## Étape F — Décommissionnement du projet compromis

Après validation complète du nouveau projet :

- **Purger toute la PII** de `sentinel-360` : base `sentinel360`, buckets `imports/`/`exports/`, et
  surtout **`sentinel-360-backups`** (copie complète de données financières/personnelles).
- Révoquer toutes les clés de service account restantes ; retirer tous les accès IAM.
- **Supprimer le projet** `sentinel-360` (compromis = perte totale, pas de réutilisation).

## RGPD (obligation légale)

Si des données personnelles ont été exposées lors de l'intrusion, **notification CNIL sous 72 h**
(entreprise française). Documenter la fenêtre d'intrusion (Cloud Audit Logs), la nature des données
concernées et les mesures prises. Voir aussi le journal d'incident à tenir en parallèle.
