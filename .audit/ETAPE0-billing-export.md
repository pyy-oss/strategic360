# Étape 0 — Export BigQuery de la facturation (BLOQUANT, à activer par un humain)

## État constaté
- Cette session n'a **ni gcloud ni credentials GCP** (accès uniquement via les workflows GitHub
  Actions existants, et la mission interdit d'en pousser de nouveaux). **Impossible de vérifier
  d'ici si l'export est déjà actif** — à contrôler en console (2 min, procédure ci-dessous).
- ⚠️ **L'export n'est PAS rétroactif** : il ne capture que les données à partir de son activation.
  Chaque jour d'attente est un jour de facturation définitivement absent de la table.
  → À activer AUJOURD'HUI, avant toute autre chose.

## Procédure exacte (console — ~5 minutes)

1. **Créer le dataset de destination** (une fois) :
   - Console → BigQuery → projet `sentinel-360` → « Créer un ensemble de données »
   - ID : `billing_export` · Région : `europe-west1` (même région que le reste) ·
     Expiration des tables : jamais.

2. **Activer l'export** :
   - Console → **Facturation** (menu ☰ → Facturation) → sélectionner le **compte de facturation**
     qui porte `sentinel-360` (droits requis : *Billing Account Administrator*)
   - Menu gauche → **Exportation de données de facturation** (« Billing export »)
   - Onglet **BigQuery export** → section **« Detailed usage cost »** (PAS seulement « Standard ») →
     *Modifier les paramètres* → projet `sentinel-360`, dataset `billing_export` → **Enregistrer**.
   - Le « Detailed » est indispensable : c'est lui qui porte la ventilation **par SKU** (Cloud Build
     minutes, Vertex tokens, Cloud Run vCPU-s…). Activer aussi « Standard » ne coûte rien.

3. **Vérifier sous 24-48 h** (la première table apparaît avec un délai) :
   - BigQuery → dataset `billing_export` → table `gcp_billing_export_resource_v1_XXXXXX`
   - Requête de contrôle :
     ```sql
     SELECT service.description, sku.description, usage_start_time,
            SUM(cost) AS cost
     FROM `sentinel-360.billing_export.gcp_billing_export_resource_v1_*`
     GROUP BY 1,2,3 ORDER BY cost DESC LIMIT 20;
     ```

## Alternative CLI (si tu préfères, depuis un poste authentifié)
```bash
bq --location=europe-west1 mk --dataset sentinel-360:billing_export
# L'activation de l'export lui-même n'a PAS d'API/CLI publique : elle se fait en console
# (étape 2 ci-dessus) — c'est la seule étape manuelle incompressible.
```

## Une fois l'export actif
Toutes les estimations du RAPPORT seront remplacées par des requêtes SQL sur cette table,
ventilées projet / service / SKU / jour. Jusque-là, **tous les chiffres sont marqués « ESTIMÉ »**
(source : historique GitHub Actions + analyse du code).
