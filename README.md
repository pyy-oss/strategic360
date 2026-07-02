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

## Statut actuel — V0 « Socle & design »

- Projet Vite + React 18 + TypeScript scaffoldé sous `web/`.
- Système de design (`web/src/design/tokens.ts`, `web/src/design/ui.tsx`) extrait à l'identique de
  la maquette (thème « Forest & Gold », composants partagés Eyebrow/Card/Kpi/Badge/Tip/Slider/Gauge/Spark).
- Les 15 vues du module Veille (`web/src/modules/veille/views/`) sont portées fidèlement depuis
  `docs/maquette_reference.jsx`, avec les données d'exemple isolées dans
  `web/src/modules/veille/data.ts` pour faciliter leur remplacement ultérieur par des requêtes
  Firestore (`summaries/*`).
- Coque applicative (`web/src/modules/veille/App.tsx`) : en-tête + sélecteur de focale (DG /
  Stratégie / Innovation), barre d'onglets, 15 routes React Router sous `/veille/:view`.
- Squelette du projet Firebase à la racine : `firebase.json`, `.firebaserc`, `firestore.rules`,
  `firestore.indexes.json`, `storage.rules`.
- Squelette des Cloud Functions (`functions/`) : signatures de déclenchement correctes (onCall,
  onSchedule, onDocumentWritten, onObjectFinalized) pour `ingestInternal`, `syncSources`,
  `classifyAI`, `scoreItems`, `aggregateVeille`, `aggregateVeilleExec`, `generateBriefing`,
  `exportPdf`, `setUserRole` — corps non implémentés (voir commentaires TODO par phase de
  roadmap). `functions/domain/sim.js` porte déjà le moteur `simCompute` complet.
- CI (`.github/workflows/ci.yml`) : build + typecheck du front, install des functions.

**Prochaine étape (V1 — Auth & RBAC)** : Firebase Auth + custom claims (8 rôles), fonction
`setUserRole`, activation de `firestore.rules`, tests de règles par profil. Voir la roadmap
complète en §13 de `docs/BUILD_KIT.md`.

Aucune donnée Firestore réelle n'est branchée en V0 : les vues consomment volontairement les
constantes d'exemple de `web/src/modules/veille/data.ts` (identiques à la maquette), pour
garder un rendu strictement fidèle avant de câbler les données réelles dans les phases
suivantes.
