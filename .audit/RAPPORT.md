# Rapport coûts GCP — Étape 1 (cartographie)

> ⚠️ **TOUS LES CHIFFRES SONT ESTIMÉS.** Sources : historique complet GitHub Actions
> (811 runs, `.audit/github-runs.csv`) + analyse du code. Pas d'accès gcloud/facturation depuis
> cet environnement ; l'export BigQuery (Étape 0, `.audit/ETAPE0-billing-export.md`) remplacera
> ces estimations par des requêtes SQL ventilées projet/service/SKU/jour.
> Période observée : **2026-07-02 → 2026-07-21 (19 jours)** — extrapolée au mois où indiqué.

## Coût estimé par projet × cause, décroissant

| # | Projet | Cause | Volume observé (19 j) | Estimation mensuelle |
|---|---|---|---|---|
| 1 | propulse-business-87f7a | **Cloud Build — 144 déploiements complets** (`firebase deploy` du codebase entier, ~20 fn/déploiement, aucun machine type spécifié) | ~2 880 builds ≈ 8 600 min | **~26-45 $** (0,003 $/min défaut ; borne haute si machine gonflée) |
| 2 | sentinel-360 | **Cloud Build — 59 déploiements complets** (~32 fn en moyenne, 45 aujourd'hui : chaque deploy futur ≈ 45 builds) | ~1 890 builds ≈ 5 700 min | **~17-30 $** (et croissant avec le nb de fn) |
| 3 | les 2 projets | **Artifact Registry — images de conteneurs accumulées** : ~4 800 builds × image/fn ; politique de nettoyage posée sur sentinel-360 (« images > 1 j supprimées ») mais le deploy log montre aussi « Failed to set up cleanup policy » ; propulse : état inconnu, probablement AUCUNE politique depuis le début | inconnu (Go accumulés) | **inconnu — risque de croissance linéaire** ; à chiffrer en priorité via la facturation |
| 4 | sentinel-360 | **Vertex AI (gemini flash)** : sync quotidienne (≤80 sources → ~50-300 classifications/j) + évaluateur horaire (≤150/passe, en pratique ~10-50/j) + enrich hebdo (~18 générations) + copilote à la demande + canari 1/j | ~2 000-8 000 appels/mois, prompts courts | **~5-25 $** |
| 5 | sentinel-360 | **Cloud Run compute (crons)** : syncSources 2 GiB × ~10 min/j (Chromium) ; 15 autres crons légers scale-to-zero | ~5-8 h-GiB/j | **~5-12 $** |
| 6 | sentinel-360 | Firestore (lectures listeners cap 500, agrégats recalculés à chaque write d'item) + export quotidien 02:00 vers bucket backups | modéré | **~3-10 $** |
| 7 | — | GitHub Actions (2 027 min/mois) | 811 runs | **0 $** (repo public) |

**Total estimé : ~55-120 $/mois**, dont **~70-80 % causés par une seule pratique** : le déploiement
du codebase ENTIER à chaque itération (203 fois en 19 jours, pics à 26 deploys/jour), qui
convertit chaque retouche d'une fonction en ~20-45 builds Cloud Build + autant d'images poussées.

## Causes racines (par ordre d'impact)

1. **`firebase deploy --only functions:veille` = tout le codebase** (45 fn dans un codebase unique) —
   aucun déploiement sélectif n'est possible en l'état ; le multiplicateur est structurel.
2. **Cadence de déploiement** : ~10 jours du mois à >20 deploys/jour (itérations de dev poussées une
   à une en prod), sans `concurrency` dans les workflows (empilement possible).
3. **propulse-business-87f7a encore actif comme cible de deploy** (144/203 déploiements le mois
   dernier — projet censé être legacy post-migration) : double facturation de la même app.
4. **Aucun machine type Cloud Build épinglé** ; politique de nettoyage Artifact Registry incertaine.
5. Vertex : volumes raisonnables et déjà bornés (plafonds/verrous posés lors des audits précédents) —
   poste secondaire mais sans plafond de débit global ni coupure en environnement de test.

## Limites de cette cartographie (honnêteté méthodologique)

- **`gcloud projects list` impossible** (pas de credentials ici) : la liste des projets vient du repo
  (2 projets référencés) — s'il existe d'autres projets sur le compte de facturation, ils sont hors
  champ jusqu'à l'export BigQuery.
- Le nombre de builds/deploy est déduit (1 build/fonction gen2), la durée moyenne (3 min/build)
  est une hypothèse standard buildpacks — la facturation tranchera.
- Volume Cloud Build par région, statuts et machine réels : nécessitent `gcloud builds list
  --limit=unlimited` depuis un poste authentifié, ou l'export BigQuery.

**STOP — validation demandée avant l'Étape 2 (pose des barrières).**
