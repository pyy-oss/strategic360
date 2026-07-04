# ADR — Récupération pour l'IA : récupération légère plutôt qu'un RAG vectoriel (2026-07)

## Statut
Adopté (Vague D). Réévaluable — critères de sortie en fin de document.

## Contexte
Audit de la pertinence d'un RAG (retrieval-augmented generation) pour renforcer la valeur ajoutée
et la cohérence des insights. Évaluation fondée sur le code réel, pas sur des a priori.

### Faits
- **Un seul corpus texte réellement croissant** : `intelItems` (les signaux de veille). Le reste est
  soit court et structuré (battlecards, techRadar, bizOpportunities, copiloteAccounts…), soit déjà
  agrégé (`summaries/*`). `companyContext` est un **petit blob statique** injecté en entier — aucun
  besoin de récupération.
- **Aucune infra vectorielle** provisionnée (ni embeddings, ni Firestore `findNearest`, ni Vertex
  Vector Search). Un RAG partirait de zéro : génération d'embeddings, index, backfill, indexation à
  chaque écriture.
- **Projet Firebase partagé, proche du plafond quota CPU/région** (`europe-west1`), et déjà fragile
  sur les endpoints (modèle forcé en `global`). Ajouter un service d'index/embeddings va à l'encontre
  de cette contrainte explicite.
- **Un récupérateur léger existe déjà et est testé** : `matchSignalsToAccount` (rattachement par
  jetons). Le vrai goulot n'était **pas** la recherche sémantique, mais des **sélections de signaux
  arbitraires** : `slice(0,10)` en prospection, top-60 par priorité identique pour tous les
  générateurs (indépendant du sujet), résumés tronqués à 300 caractères, briefing top-10.

## Décision
**Pas de RAG vectoriel maintenant.** On implémente une **récupération légère** (`domain/retrieve.js`) :
classement des signaux par **pertinence au sujet** (axes + termes) combiné à la priorité et à la
récence, de façon déterministe, pure et testée. Appliqué là où la sélection était arbitraire
(prospection du Copilote ; battlecards par lot de concurrents). Extensible aux autres générateurs.

Cela capte l'essentiel de la valeur (le modèle voit les signaux qui comptent pour le sujet) à
**coût quasi nul**, dans le domaine pur, sans nouveau service ni dépendance — cohérent avec la
contrainte de quota.

## Conséquences
- Positif : meilleure pertinence sans surface opérationnelle nouvelle ; primitive réutilisable ;
  entièrement testable hors ligne.
- Limite assumée : pas de correspondance **sémantique/paraphrase** (le classement est lexical). Un
  signal pertinent formulé sans aucun terme commun peut être manqué.

## Quand rouvrir la question (critères de réévaluation)
Envisager des embeddings + recherche vectorielle si l'UN de ces seuils est franchi :
1. Le matcher lexical **rate > ~20 %** des rattachements attendus (mesuré sur un échantillon annoté).
2. `intelItems` **dépasse plusieurs milliers de docs** et la sélection lexicale plafonne la couverture.
3. Un besoin réel de **recherche sémantique multilingue / paraphrase** émerge (ex. requêtes libres
   d'utilisateurs sur le corpus).
4. Le projet obtient une **marge de quota** (ou un projet dédié) absorbant un service d'index.
