#!/usr/bin/env bash
# Déploiement SÉLECTIF dérivé du git diff (barrière 4 — audit coûts GCP, .audit/RAPPORT.md).
#
# Pourquoi : `firebase deploy --only functions:veille` reconstruit les 45 fonctions (45 builds
# Cloud Build) même pour une retouche d'une seule. Ce script calcule les cibles réellement
# touchées depuis la base donnée et refuse de déployer plus large.
#
# Usage :
#   ./scripts/deploy-changed.sh [base]                 # base par défaut : origin/main
#   FUNCTIONS="syncSources,aiHealthCheck" ./scripts/deploy-changed.sh
#
# Règles de mapping :
#   web/**                        → hosting:strategic360
#   firestore.rules|indexes       → firestore
#   storage.rules                 → storage
#   functions/**                  → PAS de mapping automatique fiable (index.js monolithique) :
#                                   exiger FUNCTIONS="fnA,fnB" (noms d'exports), sinon refus avec
#                                   la liste des fichiers touchés. Le déploiement COMPLET du
#                                   codebase reste réservé au workflow GitHub Actions deploy.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/main}"
PROJECT="${FIREBASE_PROJECT:-sentinel-360}"

# Union : commits depuis la base + index + worktree + fichiers non suivis (un dev déploie
# souvent du non-commité, y compris des fichiers tout neufs que `git diff` ne liste jamais).
changed="$( { git diff --name-only "$BASE"...HEAD 2>/dev/null || git diff --name-only "$BASE"; \
              git diff --name-only --cached; git diff --name-only; \
              git ls-files --others --exclude-standard; } | sort -u )"
[ -z "$changed" ] && { echo "Aucun fichier changé vs $BASE — rien à déployer."; exit 0; }

targets=()
grep -q '^web/' <<<"$changed" && targets+=("hosting:strategic360")
grep -qE '^firestore\.(rules|indexes\.json)$' <<<"$changed" && targets+=("firestore")
grep -q '^storage.rules$' <<<"$changed" && targets+=("storage")

fn_files="$(grep '^functions/' <<<"$changed" | grep -vE '^functions/(test|\.env)' || true)"
if [ -n "$fn_files" ]; then
  if [ -n "${FUNCTIONS:-}" ]; then
    IFS=',' read -ra fns <<<"$FUNCTIONS"
    for fn in "${fns[@]}"; do
      fn="$(echo "$fn" | tr -d ' ')"
      # La fonction doit exister dans les exports — refuse une faute de frappe qui déploierait du vide.
      grep -q "exports\.$fn *=" functions/index.js || { echo "ERREUR : fonction inconnue '$fn' (pas d'export dans functions/index.js)."; exit 1; }
      targets+=("functions:veille:$fn")
    done
  else
    echo "Des fichiers functions/ ont changé mais le mapping fichier→fonction n'est pas automatisable"
    echo "(index.js monolithique). Fichiers touchés :"
    echo "$fn_files" | sed 's/^/  - /'
    echo
    echo "→ Relance avec la liste explicite :  FUNCTIONS=\"fnA,fnB\" $0 $BASE"
    echo "→ Déploiement COMPLET voulu : workflow GitHub Actions deploy.yml (confirm=deploy)."
    exit 1
  fi
fi

[ ${#targets[@]} -eq 0 ] && { echo "Changements hors périmètre déployable (docs/tests/CI) — rien à déployer."; exit 0; }

only="$(IFS=,; echo "${targets[*]}")"
echo "Cibles dérivées du diff vs $BASE :"
printf '  - %s\n' "${targets[@]}"
echo
echo "firebase deploy --project $PROJECT --only $only --non-interactive"
if [ "${DRY_RUN:-0}" = "1" ]; then echo "(DRY_RUN=1 — commande non exécutée)"; exit 0; fi
exec npx firebase-tools deploy --project "$PROJECT" --only "$only" --non-interactive
