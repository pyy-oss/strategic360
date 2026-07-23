# Barrière 5 — Cloud Build & Artifact Registry (runbook à exécuter depuis un poste authentifié)

> Cet environnement n'a AUCUN credential GCP (règle du projet : jamais de clé ici).
> Les commandes ci-dessous sont donc à exécuter par un humain, une fois, depuis un poste
> où `gcloud auth login` est fait. Chaque section dit **quoi**, **pourquoi**, **la commande
> exacte**, et **comment vérifier que ça a mordu**.

Projets concernés : `sentinel-360` (actif) et `propulse-business-87f7a` (legacy — 144 des
203 déploiements du mois dernier le ciblaient encore, cf. `.audit/RAPPORT.md`).

---

## 5.1 Épingler le pool Cloud Build par défaut (machine type)

**Pourquoi** : aucun machine type n'est épinglé ; un build buildpacks peut partir sur un type
plus gros que nécessaire. Le type par défaut `e2-standard-2` suffit largement pour des
fonctions Node (build ≈ 2-3 min) — l'objectif est d'empêcher toute dérive vers du
`e2-highcpu-32` accidentel.

Firebase CLI ne permet pas de choisir la machine des builds de functions gen2 (ils passent
par le pipeline géré). Le levier réel est donc **la quota** (5.2) + le hook local (barrière 1,
règle 2 : `gcloud run deploy --source` refusé sans `--machine-type`). Rien à exécuter ici —
cette section documente pourquoi.

## 5.2 Abaisser le quota de builds concurrents

**Pourquoi** : plafonner la facture instantanée. 45 builds lancés en parallèle par un deploy
complet = pic de coût et de pression AR. Avec un quota à 8, un deploy complet prend plus
longtemps mais coûte pareil en minutes — en revanche un EMBALLEMENT (boucle de deploys,
run empilés) est mécaniquement écrêté.

Console (pas de commande gcloud stable pour les quotas régionaux Cloud Build) :
1. https://console.cloud.google.com/iam-admin/quotas?project=sentinel-360
2. Filtrer : Service = **Cloud Build API**, métrique **Concurrent builds** (ou « build
   concurrency », région `europe-west1`).
3. « Modifier le quota » → demander **8** (les baisses sont accordées immédiatement).
4. Répéter pour `propulse-business-87f7a` → demander **2** (projet legacy : quasi rien ne
   doit y builder ; 0 est impossible, 2 laisse un secours).

**Preuve que ça mord** : lancer le workflow deploy.yml → dans
https://console.cloud.google.com/cloud-build/builds;region=europe-west1?project=sentinel-360
les builds passent par vagues de ≤8 (statut « Queued » visible).

## 5.3 Politique de nettoyage Artifact Registry (les deux projets)

**Pourquoi** : ~4 800 builds estimés le mois dernier = autant d'images poussées. Sur
sentinel-360, le deploy log affiche parfois « Failed to set up cleanup policy » ; sur
propulse, probablement AUCUNE politique depuis l'origine → croissance linéaire du stockage
(poste n°3 du rapport, montant inconnu tant que l'export facturation n'est pas actif).

```bash
# 1) Constater l'existant (taille et politiques) — lecture seule, sans risque :
gcloud artifacts repositories list --project=sentinel-360 \
  --format="table(name,format,sizeBytes.size(units_out=G))"
gcloud artifacts repositories list --project=propulse-business-87f7a \
  --format="table(name,format,sizeBytes.size(units_out=G))"

# 2) Poser la politique « garder 3 dernières versions, supprimer le reste après 7 jours »
#    sur le dépôt des images de functions gen2 (nom standard : gcf-artifacts) :
cat > /tmp/ar-cleanup.json <<'EOF'
[
  {"name": "keep-recent", "action": {"type": "Keep"},
   "mostRecentVersions": {"keepCount": 3}},
  {"name": "delete-old", "action": {"type": "Delete"},
   "condition": {"olderThan": "604800s"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies gcf-artifacts \
  --project=sentinel-360 --location=europe-west1 \
  --policy=/tmp/ar-cleanup.json --no-dry-run
gcloud artifacts repositories set-cleanup-policies gcf-artifacts \
  --project=propulse-business-87f7a --location=europe-west1 \
  --policy=/tmp/ar-cleanup.json --no-dry-run
```

⚠️ Poser une politique n'est PAS une suppression manuelle de ressource : elle ne supprime que
des couches d'images obsolètes, jamais la version courante (keepCount=3). Si l'étape 1 révèle
d'autres dépôts volumineux (ex. `cloud-run-source-deploy`), **ne rien supprimer** : coller la
liste dans la conversation pour accord explicite (règle de la mission).

**Preuve que ça mord** : re-lister une semaine plus tard — `sizeBytes` doit avoir baissé ou
s'être stabilisé ; la console AR affiche la politique sur le dépôt.

## 5.4 propulse-business-87f7a — extinction contrôlée (EN ATTENTE D'ACCORD)

144/203 déploiements du mois dernier ciblaient encore ce projet legacy. Depuis la migration,
plus aucun workflow du repo ne le vise — le flux est tari. Ce qui RESTE facturable là-bas :
services Cloud Run résiduels, images AR accumulées, éventuels schedulers.

**Aucune suppression sans accord** (règle de mission). Étape sûre et réversible dès
maintenant : lister, puis me coller la sortie pour que je propose une liste d'extinction
précise à valider :

```bash
gcloud run services list --project=propulse-business-87f7a --format="table(metadata.name,status.url,metadata.creationTimestamp)"
gcloud scheduler jobs list --project=propulse-business-87f7a --location=europe-west1 2>/dev/null
gcloud artifacts repositories list --project=propulse-business-87f7a
```

## 5.5 Vérification d'ensemble (après 5.2 + 5.3)

```sql
-- Une fois l'export facturation actif (.audit/ETAPE0-billing-export.md) :
SELECT service.description, SUM(cost) AS cout
FROM `FACTURATION.gcp_billing_export_resource_v1_XXXXXX`
WHERE project.id IN ('sentinel-360','propulse-business-87f7a')
  AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY 1 ORDER BY cout DESC;
```
Attendu sous 7 jours : Cloud Build divisé par ≥5 (déploiements nommés), Artifact Registry
stable ou décroissant, propulse ≈ 0 sur Cloud Build.
