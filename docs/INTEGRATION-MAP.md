# INTEGRATION-MAP.md — Copilote Commercial (add-on DELTA 02 / 02B)
### RÉEL rempli par lecture du repo `strategic360` · statuts ✅/🔧 · **à valider avant tout code**

> Contrainte imposée : **zéro régression sur l'existant + reuse maximum.**
> Constat majeur : l'annexe/la map d'origine visaient un projet « Pilote Revenu » à moteur IA
> **client** (`firebase/ai` `getAI()` + `agents.ts` `Schema.object`). Notre repo a un moteur IA
> **serveur** (`functions/domain/vertex.js#generateJson`). ⇒ On **réutilise le moteur serveur**
> (zéro régression, pas de 2ᵉ pile IA), et les agents deviennent des `onCall` server-side.

---

## 1. Moteur IA — `functions/domain/vertex.js` (et NON `src/lib/gemini.ts`)

| Élément | Hypothèse (doc) | RÉEL | Statut |
|---|---|---|---|
| Export principal | `getAI()` client | `generateJson(prompt, schema?)` **serveur** (`functions/domain/vertex.js`) | 🔧 |
| Backend | `VertexAIBackend` client | `@google/genai` `GoogleGenAI({vertexai:true, location:"global"})` serveur | 🔧 |
| Modèles | `gemini-2.5-flash` + `gemini-2.5-pro` | **`gemini-3.5-flash`** uniquement (validé en prod) | 🔧 |
| Sorties structurées | `Schema.object` (`firebase/ai`) | `generateJson(prompt, responseSchema)` — schéma JSON passé au 2ᵉ arg | 🔧 |
| Sécurité | App Check client | callables `enforceAppCheck` (`CALLABLE_OPTS`) + gate rôle serveur | ✅ |

**Décision reuse-max :** les 6 agents = **prompt-builders purs** (mêmes gabarits §B–§G) appelés par des
`onCall` qui font `generateJson(build*Prompt(ctx), SCHEMA)`. **Un seul modèle** `gemini-3.5-flash`
(pas de split Flash/Pro — non validé, ajouterait du risque infra). Aucune dépendance IA ajoutée.

---

## 2. Module Veille — collections & composants réutilisables

| Élément | Hypothèse (doc) | RÉEL | Statut |
|---|---|---|---|
| Fichiers | `Veille_Strategique_NT_CI.jsx` | `web/src/modules/veille/**` (React/Vite TS, 15 vues) | 🔧 |
| Signaux | `veilleSignals` | **`intelItems`** (+ `withDetectionFields`, `bizOpportunities`) | 🔧 |
| Cadres | `cadresStrategiques` | **`frameworks/{swot,pestel,porter,ge9,ansoff,vrio,valueChain,…}`** via `useFramework` | 🔧 |
| PESTEL réutilisable | oui | ✅ `useFramework<PestelContent>("pestel")` — **à injecter dans CVP, pas régénérer** | ✅ |
| 9-box GE-McKinsey | composant exportable | présent = `frameworks/ge9` + `Portefeuille.tsx` (Recharts ScatterChart) — réutiliser le doc, pas redessiner | ✅ |
| Value-at-stake (EV) | logique EV présente | ✅ `summaries/quanti.valueAtStake` + `computeValueAtStake` (nt360) | ✅ |

---

## 3. Shell cockpit — `web/src/modules/veille/App.tsx`

| Élément | Hypothèse (doc) | RÉEL | Statut |
|---|---|---|---|
| Navigation | `activeModule` local, `Pilote_Revenu_NT_CI.jsx` | `useState("view")` + `NAV: [id,label][]` (`data.ts`) + switch `{view==="x" && <X/>}` | 🔧 |
| Greffe module | registre NAV central | ➕ **1 entrée NAV + 1 import + 1 ligne switch + 1 fichier `views/Copilote.tsx`** (zéro régression) | ✅ |
| Design tokens | palette centralisée | ✅ `web/src/design/tokens.ts` (`T`) + `ui.tsx` — **réutiliser, pas de palette locale** | ✅ |
| Layout | shell unique | ✅ shell `App.tsx` (sidebar + header) — greffe, pas de fork | ✅ |

---

## 4. Auth & `firestore.rules`

| Élément | Hypothèse (doc) | RÉEL | Statut |
|---|---|---|---|
| Rôles | `{commercial, dro, dg, admin}` | 8 rôles : `direction, strategie, innovation, commercial_dir, commercial, pmo, achats, lecture` | 🔧 |
| Helpers rules | `isAuthed()` + `hasRole([...])` | `role()`, `exec()` (direction/strategie/innovation), `lvl(m)`, matrice `config/permissions` | 🔧 |
| Fichier | unique à fusionner | ✅ `firestore.rules` unique — ajouter les collections copilote avec les helpers existants | ✅ |
| Gate serveur | — | `requireExecCaller` + `EXEC_ROLES` ; **à étendre** : `commercial`/`commercial_dir` pour le copilote | 🔧 |

**Décision :** le copilote est un outil **commercial** → accès `commercial`, `commercial_dir` **et** exec
(nouveau helper `requireCommercialCaller`), sans toucher les gates existants.

---

## 5. Données comptes (ingestion)

| Élément | Hypothèse (doc) | RÉEL | Statut |
|---|---|---|---|
| Historique | `opportunites` (N° FP) | **nt360 `opportunities` (4 895)** + `orders` (1 506) — base `nt360` **STRICTEMENT read-only** | 🔧 |
| Clients/fournisseurs | `clients`, `fournisseurs` | nt360 `opportunities`/`orders`/`invoices`/`bcLines` (pas de collections `clients`/`fournisseurs` dédiées) | 🔧 |
| Idempotence | upsert clé stable | ✅ pattern `intelItemId`/slug + garde humaine réutilisable | ✅ |
| Champs qualitatifs (secteur, tier, enjeux, whitespace, contacts) | supposés présents | **ABSENTS** de nt360 → nouvelle collection légère **`copiloteAccounts`** (éditée à la main / enrichie IA) | 🔧 |

**Décision reuse-max :** un **compte** = agrégat read-only nt360 (empreinte, montants, stades) **+**
un doc `copiloteAccounts/{id}` pour le qualitatif (tier/enjeux/whitespace/contacts). nt360 jamais écrit.

---

## 6. Functions & Storage — export & rédaction

| Élément | Hypothèse (doc) | RÉEL | Statut |
|---|---|---|---|
| Runtime | Node 20, `firebase-functions` v2 `onCall` | ✅ identique | ✅ |
| App Check | `enforceAppCheck` | ✅ `CALLABLE_OPTS` | ✅ |
| Signed URL | `file.getSignedUrl` déjà utilisé | ✅ `exportPdf` : upload Storage `exports/{id}.pdf` + `getSignedUrl` | ✅ |
| **Export PDF** | ❓ à ajouter | ✅ **EXISTE** (`exportPdf` + `pdfkit` déjà en deps) → **RÉUTILISER**, ne pas ré-ajouter | ✅ |
| **Export PPTX** | à ajouter (`pptxgenjs`) | **ABSENT** → ajout `pptxgenjs` **uniquement si le PPTX est requis** (décision ci-dessous) | 🔧 |
| **Module rédaction** | ❓ à ajouter | **ABSENT** → nouvel agent `redaction` (server-side, réutilise `generateJson`) | 🔧 |

---

## 7. Facturation / crédit GenAI

| Élément | RÉEL | Statut |
|---|---|---|
| Plan / crédit | non vérifiable depuis le repo (config console) — Vertex `@google/genai` déjà facturé et fonctionnel en prod | ⏳ (côté console) |

---

## Synthèse — reuse maximum, zéro régression

**Ce qu'on RÉUTILISE tel quel (aucune régression) :** moteur IA serveur `generateJson`,
`gemini-3.5-flash`, PESTEL/GE9/value-at-stake/`bizOpportunities`/nt360 comme sources de contexte,
`exportPdf`+`pdfkit`, design tokens `T`, pattern NAV+switch, `enforceAppCheck`, helpers rules.

**Ce qu'on AJOUTE (isolé, greffé) :**
1. `functions/domain/copilote/` — 6 prompt-builders purs (§B–§G, adaptés `generateJson`) + schémas JSON.
2. `functions/index.js` — callables `copiloteAgent` (prospection/cvp/triennal/planCompte/chat/redaction), gate `commercial+`.
3. Collection `copiloteAccounts` (qualitatif compte) + rules.
4. `web/src/modules/veille/views/Copilote.tsx` + 1 entrée NAV + 1 ligne switch.
5. (Optionnel) `pptxgenjs` + `exportPptx` si le PPTX est requis (sinon on réutilise `exportPdf`).

**4 décisions bloquantes → résolues par reuse-max, 3 restent à confirmer par toi :**
1. Moteur/modèle → **`gemini-3.5-flash` serveur unique** (recommandé, zéro infra nouvelle). ✅ résolu
2. Collections Veille → **branchées sur les vraies** (`frameworks/*`, `intelItems`, nt360). ✅ résolu
3. **Export : PDF seul (réutilise l'existant) ou +PPTX (ajoute `pptxgenjs`) ?** → à confirmer
4. **Rédaction : on ajoute l'agent (absent) ?** → à confirmer (recommandé oui)
+ **Périmètre agents** (les 6, ou un sous-ensemble) et **modèle de compte** (`copiloteAccounts`) → à confirmer.
