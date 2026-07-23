# Runbook coûts GCP — contrôle hebdomadaire (5 minutes)

Contexte : `.audit/RAPPORT.md` (cartographie), `.audit/BARRIERE5-cloudbuild-registry.md`
(commandes détaillées), `.audit/ETAPE0-billing-export.md` (export facturation).

## Le contrôle hebdo (5 lignes)

1. **Facturation** : https://console.cloud.google.com/billing → « Rapports », grouper par projet
   puis par service, période 7 jours. Attendu : Cloud Build faible et stable ; `propulse-business-87f7a` ≈ 0.
2. **Builds** : https://console.cloud.google.com/cloud-build/builds;region=europe-west1?project=sentinel-360
   → le nombre de builds/jour doit refléter des deploys NOMMÉS (1-3 builds), pas des vagues de 45.
3. **Artifact Registry** : `gcloud artifacts repositories list --project=sentinel-360 --format="table(name,sizeBytes.size(units_out=G))"`
   → taille stable ou décroissante (politique keep-3/delete-7j).
4. **Déploiements** : onglet Actions du repo → seuls des runs `Deploy` volontaires (confirm=deploy) depuis `main`.
5. Si un poste dévie : lancer `/audit-couts` dans Claude Code (rejoue la cartographie, compare, désigne la barrière qui a cédé).

## Alertes à poser une fois (si pas déjà fait)

- **Budget** : https://console.cloud.google.com/billing/budgets → un budget par projet
  (`sentinel-360` : 40 €/mois ; `propulse-business-87f7a` : 5 €/mois), seuils 50/90/100 %,
  e-mail au propriétaire. Un budget n'arrête rien : c'est un détecteur, pas un disjoncteur.
- **Monitoring builds** : https://console.cloud.google.com/monitoring/alerting?project=sentinel-360
  → politique d'alerte sur la métrique `cloudbuild.googleapis.com/build/count` (ou compteur de
  logs `resource.type="build"`), condition > 60 builds / heure — c'est la signature d'un deploy
  complet accidentel ou d'une boucle.

## Réflexes si dérive constatée

| Symptôme | Cause probable | Geste |
|---|---|---|
| Vague de ~45 builds | deploy complet hors workflow | vérifier le hook `.claude/hooks/block-costly-deploys.sh` + qui a déployé |
| Builds sur propulse | cible legacy réactivée | aucun deploy ne doit y pointer — chercher le workflow/poste fautif |
| AR qui grossit | politique de nettoyage absente/cassée | § 5.3 du runbook barrière 5 |
| Vertex qui monte | plafond contourné (client hors vertex.js) | grep `GoogleGenAI` — un seul point d'entrée autorisé |
