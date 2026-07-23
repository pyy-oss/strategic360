---
description: Rejoue la cartographie des coûts GCP et compare au dernier rapport (.audit/RAPPORT.md)
---

Tu es chargé d'un audit de coûts GCP récurrent sur ce repo. Objectif : mesurer depuis la source
de vérité, comparer au dernier état connu, et dire si les barrières tiennent. Règles de la
mission d'origine (impératives) : aucune valeur de secret/clé nulle part ; toute donnée
volumineuse va dans `.audit/*.csv`, jamais dans ton contexte ; sous-agents pour l'exploration
avec résumé ≤ 20 lignes.

## Étape 1 — collecte (source de vérité)

1. **GitHub Actions** (sous-agent) : via les outils MCP GitHub, lister les runs des 30 derniers
   jours du repo, agréger par workflow × jour dans `.audit/github-runs.csv` +
   `.audit/github-runs-agg.csv` (mêmes formats que l'audit initial). Compter en particulier les
   runs des workflows Deploy et leur cible projet.
2. **Facturation** : si l'export BigQuery (cf. `.audit/ETAPE0-billing-export.md`) est actif,
   demander à l'utilisateur de coller la sortie de la requête SQL de contrôle (coût par
   projet/service/jour sur 30 j). S'il ne l'est pas : le signaler en tête de rapport et marquer
   TOUS les chiffres « estimés ».
3. **Code** : vérifier que les barrières sont toujours en place —
   `.claude/hooks/block-costly-deploys.sh` + son entrée dans `.claude/settings.json` ;
   `concurrency` dans `deploy.yml`/`ci.yml` et les workflows opérationnels ; `paths-ignore` de la
   CI ; `scripts/deploy-changed.sh` exécutable ; plafond + `VERTEX_DISABLED` dans
   `functions/domain/vertex.js` et la CI. Toute barrière absente = régression à signaler en rouge.

## Étape 2 — comparaison

Lire le dernier `.audit/RAPPORT.md` (et `.audit/RAPPORT-<date>.md` s'ils existent). Construire le
différentiel : déploiements complets/mois (référence : 203 en 19 j), builds estimés par deploy
(référence : ~45), coût mensuel estimé (référence : ~55-120 $). La cible posée par la mission :
déploiements complets ≈ seulement ceux du workflow deploy.yml, 1-3 builds par itération de dev,
Cloud Build divisé par ≥ 5.

## Étape 3 — rapport

Archiver l'ancien rapport en `.audit/RAPPORT-<date-du-jour>.md` puis réécrire `.audit/RAPPORT.md`
avec : tableau coût par projet × cause (décroissant), différentiel vs rapport précédent
(flèches ↓/↑), état de chaque barrière (présente/absente), et actions restantes. Committer sur une
branche `audit/couts-<date>` — ne pas pousser sans accord.

Conclure dans la conversation par un verdict en ≤ 10 lignes : la dérive est-elle contenue, et
sinon, quelle barrière a cédé.
