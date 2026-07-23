# Règles projet — Sentinel (strategic360)

Projet Firebase : `sentinel-360` · base Firestore : `sentinel360` · site hosting : `strategic360`
· codebase functions : `veille` (45 fonctions, europe-west1, nodejs22).

## Déploiement — règles IMPÉRATIVES (coûts GCP, cf. `.audit/RAPPORT.md`)

Chaque `firebase deploy` non ciblé reconstruit LES 45 FONCTIONS (45 builds Cloud Build).
C'est la cause n°1 de la dérive de coûts constatée (203 déploiements complets en 19 jours
≈ 4 800 builds). D'où :

1. **JAMAIS** `firebase deploy` sans `--only`, ni `--only functions` / `--only functions:veille`.
   Un hook PreToolUse (`.claude/hooks/block-costly-deploys.sh`) bloque ces commandes — ne pas le
   contourner ni le désactiver.
2. Déploiement de fonctions : **toujours par fonctions nommées** —
   `--only functions:veille:fnA,functions:veille:fnB` — ou via `./scripts/deploy-changed.sh`
   (dérive les cibles du git diff ; `FUNCTIONS="fnA,fnB"` pour les fonctions ; `DRY_RUN=1` pour
   vérifier).
3. Déploiement **complet** (rare : nouvelle fonction, changement transverse) : uniquement le
   workflow GitHub Actions `deploy.yml` (`confirm=deploy`, depuis `main`), jamais depuis un poste.
4. `gcloud run deploy --source` : toujours avec `--machine-type` explicite.
5. Le projet `propulse-business-87f7a` est **legacy** : n'y déployer sous AUCUN prétexte.

## Secrets

**Jamais de valeur de secret ou de clé** dans une sortie, un fichier ou un commit (un projet
précédent a été suspendu par Google pour exposition de credentials). Le seul chemin d'accès GCP
est le secret GitHub Actions `GCP_SA_KEY_STRATEGIC360` — aucun credential local.

## Vertex AI

Tous les appels Gemini passent par `functions/domain/vertex.js` (`generateJson`) — ne jamais
créer un autre client. Plafond de débit `VERTEX_MAX_CALLS_PER_MIN` (défaut 30/instance) ;
`VERTEX_DISABLED=1` dans tout environnement de test/CI.

## Vérifications avant push

`cd functions && npm run test:unit && npm run lint` · `cd web && npm run typecheck && npm run lint
&& npm run build`. La CI ignore `docs/**`, `.audit/**`, `*.md`.

## Audit de coûts

`/audit-couts` (commande projet) rejoue la cartographie et compare au dernier rapport.
Routine hebdo : `RUNBOOK-COUTS.md`. Nouveau projet GCP : suivre `.audit/CHECKLIST-nouveau-projet.md`.
