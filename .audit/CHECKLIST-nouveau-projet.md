# Checklist — nouveau projet GCP/Firebase (avant le premier deploy)

À dérouler INTÉGRALEMENT à la création de tout nouveau projet. Chaque case coûte 2 minutes ;
les oublier a coûté ~55-120 $/mois sur les deux projets existants (`.audit/RAPPORT.md`).

## Jour 0 — avant toute ressource

- [ ] **Export facturation BigQuery** activé immédiatement (« Detailed usage cost », non
      rétroactif — `.audit/ETAPE0-billing-export.md`). Sans lui, aucun audit futur n'a de chiffres.
- [ ] **Budget** créé (billing/budgets) avec seuils 50/90/100 % et e-mail.
- [ ] **Quota Cloud Build « concurrent builds »** abaissé (8 pour un projet actif, 2 pour un bac à sable).
- [ ] **Compte de service CI** au moindre privilège ; la clé va UNIQUEMENT dans un secret GitHub
      Actions — jamais en local, jamais dans le repo (précédent : projet suspendu par Google).

## Premier déploiement

- [ ] Politique de **nettoyage Artifact Registry** posée sur `gcf-artifacts` (keep-3 versions,
      delete > 7 j — commandes § 5.3 de `.audit/BARRIERE5-cloudbuild-registry.md`).
- [ ] Workflow de deploy avec `concurrency` (cancel-in-progress), garde de branche `main`, et
      confirmation manuelle.
- [ ] CI avec `paths-ignore` (docs/md) et `concurrency` par ref.
- [ ] Hook local anti-deploy-complet copié (`.claude/hooks/block-costly-deploys.sh` +
      `.claude/settings.json`) et `scripts/deploy-changed.sh` adapté aux cibles du projet.

## Si le projet appelle Vertex/Gemini

- [ ] Un SEUL module client (modèle : `functions/domain/vertex.js`) avec plafond de débit et
      `VERTEX_DISABLED` pour test/CI.
- [ ] Alerte Monitoring sur le volume d'appels.

## Décommissionnement d'un ancien projet

- [ ] Lister ce qui tourne encore (run services, schedulers, AR) — § 5.4 barrière 5.
- [ ] Validation humaine de la liste AVANT toute suppression.
- [ ] Vérifier 0 $ sur le projet au rapport de facturation suivant.
