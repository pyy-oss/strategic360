# Intégrations tierces — Utilisateurs, Webhooks sortants & entrants

Écran **Config → Intégrations & API** (Direction uniquement). Trois volets : gestion des
utilisateurs, webhooks **sortants** (Sentinel → app tierce) et **entrants** (app tierce → Sentinel).

Toute la configuration passe par les callables `userAdmin` / `webhookAdmin` (rôle `direction`).
Les secrets HMAC ne sont affichés **qu'une seule fois**, à la création ou à la rotation.

---

## 1. Gestion des utilisateurs (rôles)

L'authentification Firebase est **partagée** entre les apps du projet. On ne gère donc que le
**claim `role`** propre à cette app — jamais l'activation globale du compte.

- **Inviter** : crée le compte s'il n'existe pas, assigne le rôle, envoie un e-mail « définissez
  votre mot de passe » (Identity Toolkit — aucun mot de passe ne transite). Nécessite
  `FIREBASE_WEB_API_KEY` (functions/.env, clé web **non secrète**).
- **Ré-attribuer** : change le rôle d'un utilisateur.
- **Révoquer** : retire le claim `role` (l'utilisateur perd l'accès à l'app ; son compte Firebase
  reste intact pour les autres apps du projet). On ne peut pas se révoquer soi-même.

Les 13 rôles ESN et la matrice rôle × module se gèrent dans **Réglages & Droits** (RBAC).

---

## 2. Webhooks sortants

Sentinel envoie un **POST JSON signé** aux endpoints abonnés, à chaque événement choisi.

### Événements
| Type | Déclencheur |
|---|---|
| `intel.signal` | Un signal de veille franchit le seuil « fort score » (`WEBHOOK_SIGNAL_MIN_SCORE`, défaut 70) |
| `briefing.created` | Un briefing vient d'être produit |
| `action.created` | Une action / un geste de plan est créé |
| `account.event` | Cycle de vie (onboarding terminé, …) |

### Enveloppe
```json
{ "id": "evt_…", "type": "intel.signal", "createdAt": "2026-07-18T…Z",
  "source": "sentinel-360", "data": { "id": "…", "score": 88, "title": "…", "url": "…" } }
```

### En-têtes
- `x-sentinel-signature` : `sha256=<hmac>` (HMAC-SHA256 de `` `${timestamp}.${body}` ``)
- `x-sentinel-timestamp` : epoch (s)
- `x-sentinel-event` : type de l'événement

### Vérification côté récepteur (Node)
```js
const crypto = require("crypto");
function verify(rawBody, headers, secret) {
  const ts = headers["x-sentinel-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // anti-rejeu
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(headers["x-sentinel-signature"] || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Réessais : jusqu'à 3 tentatives (backoff court), délai 8 s. Chaque livraison est journalisée
(succès/échec, statut, essais). Une URL pointant vers une IP interne est bloquée (garde SSRF).

---

## 3. Webhooks entrants

Endpoint **public** (la sécurité est la **signature**, pas l'accès réseau — modèle « Stripe ») :

```
https://europe-west1-sentinel-360.cloudfunctions.net/webhookInbound
```

### En-têtes attendus
- `x-sentinel-source` : id de la source (créée dans l'écran, `webhookInboundSources/{id}`)
- `x-sentinel-timestamp` : epoch (s) — fenêtre anti-rejeu 300 s
- `x-sentinel-signature` : `sha256=<hmac de `${ts}.${body}`>` (corps vide pour un GET)
- `x-sentinel-action` : `ingest` | `action` | `sync` (ou `?action=`, ou `body.action` ; **GET ⇒ `pull`**)

L'action doit être **autorisée** pour la source. Charge max 64 Ko. Tout est journalisé.

### Actions
| Action | Méthode | Effet |
|---|---|---|
| `ingest` | POST | `{ item: { title, url?, summary?, axis?, date? } }` → entre dans le fil `intelItems` (dédup + revue humaine respectées) |
| `action` | POST | `{ data: { title, dueDate?, owner?, status? } }` → crée une action |
| `sync` | POST | `{ target: "quanti" \| "sources" }` → force la synchro correspondante |
| `pull` | GET | `?summary=veille\|veille_exec\|quanti` → renvoie le résumé (lecture seule) |

### Exemple — ingérer un signal (bash)
```bash
BODY='{"item":{"title":"Nouveau concurrent X","url":"https://ex.com/a","axis":"concurrents"}}'
TS=$(date +%s)
SIG="sha256=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
curl -X POST "$INBOUND_URL" \
  -H "x-sentinel-source: $SOURCE_ID" -H "x-sentinel-timestamp: $TS" \
  -H "x-sentinel-signature: $SIG" -H "x-sentinel-action: ingest" \
  -H "content-type: application/json" -d "$BODY"
```

---

## Sécurité — résumé

- Signature HMAC-SHA256 avec **timestamp signé** (anti-rejeu ±300 s), comparaison à temps constant.
- Secrets stockés côté serveur, **jamais** lisibles par le client (règles Firestore : `read/write: if false`
  sur `webhookEndpoints` / `webhookInboundSources` / `webhookDeliveries` / `webhookInboundLog`).
- Endpoints sortants revalidés (SSRF) à chaque envoi.
- Callables `userAdmin` / `webhookAdmin` réservés au rôle `direction` ; toutes les mutations sont
  tracées dans `auditLog`.
