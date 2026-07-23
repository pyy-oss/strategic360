#!/usr/bin/env bash
# Barrière anti-dérive de coûts GCP (audit .audit/RAPPORT.md, 2026-07).
# Hook PreToolUse (Bash) : bloque les commandes qui déclenchent un build Cloud Build
# par fonction du codebase (45 fonctions = 45 builds par `firebase deploy` non ciblé —
# 203 déploiements en 19 jours ont produit ~4 800 builds estimés).
#
# Reçoit le JSON de l'appel outil sur stdin ; exit 2 = blocage (stderr affiché à l'agent).
set -euo pipefail

payload="$(cat)"
cmd="$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# --- Règle 1 : firebase deploy touchant les functions SANS fonction nommée ---------------------
# Interdit : `firebase deploy` sans --only ; `--only functions` ; `--only functions:veille`
# Autorisé : `--only functions:veille:maFonction[,functions:veille:autre]` (cible nommée),
#            `--only hosting:...`, `--only firestore`, `--only storage`, etc.
if printf '%s' "$cmd" | grep -q 'firebase[^|;&]*deploy'; then
  only="$(printf '%s' "$cmd" | grep -o '\-\-only[= ][^ ]*' | head -1 | sed 's/--only[= ]//' || true)"
  if [ -z "$only" ]; then
    echo "BLOQUÉ (coûts GCP) : 'firebase deploy' sans --only redéploie TOUT (45 fonctions = 45 builds Cloud Build)." >&2
    echo "→ Cible nommée obligatoire, ex. : firebase deploy --only functions:veille:syncSources" >&2
    echo "→ Ou le script sélectif : ./scripts/deploy-changed.sh (dérive les cibles du git diff)." >&2
    exit 2
  fi
  # Chaque segment functions* doit porter une fonction nommée (2e ':' après le codebase).
  if printf '%s' "$only" | tr ',' '\n' | grep -E '^functions(:[^:,]+)?$' >/dev/null; then
    echo "BLOQUÉ (coûts GCP) : '--only $only' redéploie le codebase functions ENTIER (45 builds Cloud Build)." >&2
    echo "→ Nomme les fonctions : --only functions:veille:fnA,functions:veille:fnB" >&2
    echo "→ Ou ./scripts/deploy-changed.sh. Déploiement complet volontaire : passer par le workflow" >&2
    echo "  GitHub Actions deploy.yml (confirm=deploy), jamais depuis un poste." >&2
    exit 2
  fi
fi

# --- Règle 2 : gcloud run deploy --source sans --machine-type ---------------------------------
# `--source` déclenche un build Cloud Build ; sans machine type épinglé, GCP peut employer un
# type par défaut/gonflé — coût non maîtrisé.
if printf '%s' "$cmd" | grep -q 'gcloud[^|;&]*run[^|;&]*deploy' \
   && printf '%s' "$cmd" | grep -q '\-\-source' \
   && ! printf '%s' "$cmd" | grep -q '\-\-machine-type'; then
  echo "BLOQUÉ (coûts GCP) : 'gcloud run deploy --source' sans --machine-type (build Cloud Build à coût non épinglé)." >&2
  echo "→ Ajoute --machine-type=e2-medium, ou déploie depuis une image déjà construite (--image)." >&2
  exit 2
fi

exit 0
