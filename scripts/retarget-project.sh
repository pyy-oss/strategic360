#!/usr/bin/env bash
# Bascule la configuration du dépôt d'un projet Firebase/GCP vers un autre (incident 2026-07 :
# sentinel-360 compromis → projet neuf propre). Voir docs/MIGRATION-2.md.
#
# Réécrit UNIQUEMENT la surface de config DÉTERMINISTE (.firebaserc, firebase.json, le .env des
# functions, et les workflows GitHub Actions). Il NE touche PAS au code source : il en LISTE les
# occurrences résiduelles pour revue manuelle (un sed aveugle sur index.js/webhooks.js corromprait
# des références comme le n° de compte de service runtime).
#
# Usage :
#   cp migration/target.env.example migration/target.env   # puis remplir
#   DRY_RUN=1 ./scripts/retarget-project.sh                 # prévisualiser
#   ./scripts/retarget-project.sh                           # appliquer
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="migration/target.env"
[ -f "$TARGET" ] || { echo "ERREUR : $TARGET introuvable. Copier migration/target.env.example et le remplir."; exit 1; }
# shellcheck disable=SC1090
set -a; . "./$TARGET"; set +a

# --- Anciennes valeurs (littéraux du projet compromis, à remplacer) ------------------------
OLD_PROJECT_ID="sentinel-360"
OLD_DB_ID="sentinel360"
OLD_HOSTING_SITE="sentinelnt-360"
OLD_STORAGE_BUCKET="sentinel-360.firebasestorage.app"
OLD_BACKUP_BUCKET="sentinel-360-backups"
OLD_API_KEY="AIzaSyCykx2RuRoxsI9YTUL3xvRZp2_UcZ_P4c4"
OLD_AUTH_DOMAIN="sentinel-360.firebaseapp.com"
OLD_SENDER_ID="876373263153"
OLD_APP_ID="1:876373263153:web:09d412dfcf265259d6e610"

# --- Garde-fous : aucun placeholder ne doit subsister -------------------------------------
missing=()
for v in NEW_PROJECT_ID NEW_DB_ID NEW_HOSTING_SITE NEW_STORAGE_BUCKET NEW_BACKUP_BUCKET \
         NEW_API_KEY NEW_AUTH_DOMAIN NEW_MESSAGING_SENDER_ID NEW_APP_ID; do
  val="${!v:-}"
  { [ -z "$val" ] || printf '%s' "$val" | grep -q 'CHANGEME'; } && missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "ERREUR : valeurs non renseignées dans $TARGET : ${missing[*]}"
  echo "→ Renseigner chaque champ avec la config du NOUVEAU projet, puis relancer."
  exit 1
fi
if [ "$NEW_PROJECT_ID" = "$OLD_PROJECT_ID" ]; then
  echo "ERREUR : NEW_PROJECT_ID == ancien projet ($OLD_PROJECT_ID). La bascule n'aurait aucun effet."
  exit 1
fi

DRY="${DRY_RUN:-0}"
apply() {  # apply <fichier> <sed-expr...>
  local f="$1"; shift
  [ -f "$f" ] || return 0
  local args=(); for e in "$@"; do args+=(-e "$e"); done
  if [ "$DRY" = "1" ]; then
    local diff; diff="$(sed "${args[@]}" "$f" | { diff -u "$f" - || true; })"
    if [ -n "$diff" ]; then echo "### $f"; echo "$diff"; echo; fi
  else
    local before; before="$(cat "$f")"
    sed -i "${args[@]}" "$f"
    [ "$before" != "$(cat "$f")" ] && echo "  réécrit : $f"
  fi
  return 0
}

echo "== Bascule $OLD_PROJECT_ID → $NEW_PROJECT_ID $( [ "$DRY" = 1 ] && echo '(DRY_RUN — aperçu)' )"
echo

# 1) .firebaserc — projet par défaut + site hosting cible
apply .firebaserc \
  "s#\"$OLD_PROJECT_ID\"#\"$NEW_PROJECT_ID\"#g" \
  "s#$OLD_HOSTING_SITE#$NEW_HOSTING_SITE#g"

# 2) firebase.json — bucket storage + base firestore
apply firebase.json \
  "s#$OLD_STORAGE_BUCKET#$NEW_STORAGE_BUCKET#g" \
  "s#\"database\": \"$OLD_DB_ID\"#\"database\": \"$NEW_DB_ID\"#g"

# 3) functions/.env : créer le fichier du nouveau projet à partir de l'ancien, puis retirer l'ancien
OLD_ENV="functions/.env.$OLD_PROJECT_ID"
NEW_ENV="functions/.env.$NEW_PROJECT_ID"
if [ -f "$OLD_ENV" ]; then
  if [ "$DRY" = "1" ]; then
    echo "### $OLD_ENV → $NEW_ENV (nouveau fichier, mêmes clés, valeurs repointées)"
    echo "  FIRESTORE_DATABASE_ID=$NEW_DB_ID ; STORAGE_BUCKET_NAME=$NEW_STORAGE_BUCKET"
    echo "  FIRESTORE_EXPORT_BUCKET=$NEW_BACKUP_BUCKET ; WEB_API_KEY=<nouvelle clé web>"
    echo "  NT360_PROJECT_ID=$NEW_NT360_PROJECT_ID ; NT360_DATABASE_ID=$NEW_NT360_DATABASE_ID"
    echo
  else
    sed -e "s#$OLD_DB_ID#$NEW_DB_ID#g" \
        -e "s#$OLD_STORAGE_BUCKET#$NEW_STORAGE_BUCKET#g" \
        -e "s#$OLD_BACKUP_BUCKET#$NEW_BACKUP_BUCKET#g" \
        -e "s#$OLD_API_KEY#$NEW_API_KEY#g" \
        -e "s#^NT360_PROJECT_ID=.*#NT360_PROJECT_ID=$NEW_NT360_PROJECT_ID#" \
        -e "s#^NT360_DATABASE_ID=.*#NT360_DATABASE_ID=$NEW_NT360_DATABASE_ID#" \
        "$OLD_ENV" > "$NEW_ENV"
    git rm -q --cached "$OLD_ENV" 2>/dev/null || true
    rm -f "$OLD_ENV"
    echo "  créé : $NEW_ENV  (ancien $OLD_ENV retiré)"
    # .gitignore : autoriser le nouveau .env non-secret (comme l'ancien)
    if ! grep -q "!functions/.env.$NEW_PROJECT_ID" .gitignore 2>/dev/null; then
      sed -i "s#^!functions/.env.$OLD_PROJECT_ID#!functions/.env.$NEW_PROJECT_ID#" .gitignore || true
      echo "  .gitignore : exception mise à jour pour $NEW_ENV"
    fi
  fi
fi

# 4) Workflows GitHub Actions — project id, db, buckets, hosting site, config web de deploy.yml
for wf in .github/workflows/*.yml; do
  apply "$wf" \
    "s#$OLD_PROJECT_ID#$NEW_PROJECT_ID#g" \
    "s#$OLD_STORAGE_BUCKET#$NEW_STORAGE_BUCKET#g" \
    "s#$OLD_BACKUP_BUCKET#$NEW_BACKUP_BUCKET#g" \
    "s#$OLD_HOSTING_SITE#$NEW_HOSTING_SITE#g" \
    "s#\b$OLD_DB_ID\b#$NEW_DB_ID#g" \
    "s#$OLD_API_KEY#$NEW_API_KEY#g" \
    "s#$OLD_AUTH_DOMAIN#$NEW_AUTH_DOMAIN#g" \
    "s#$OLD_APP_ID#$NEW_APP_ID#g" \
    "s#\b$OLD_SENDER_ID\b#$NEW_MESSAGING_SENDER_ID#g"
done

echo
echo "== Occurrences RÉSIDUELLES à traiter À LA MAIN (le script n'y touche pas) =="
echo "-- code source (labels/commentaires — décider au cas par cas) --"
grep -rIn "$OLD_PROJECT_ID\|$OLD_SENDER_ID" \
  functions/index.js functions/domain/ functions/test/ web/src/ 2>/dev/null \
  | sed 's/^/   /' || echo "   (aucune)"
echo "-- rappels manuels --"
echo "   • web/.env.local (gitignoré) : régénérer avec la config web du nouveau projet."
echo "   • functions/domain/webhooks.js:131 : label source par défaut '\"$OLD_PROJECT_ID\"' (+ test) — mettre à jour si souhaité."
echo "   • docs/*.md et .audit/*.md : références historiques — laisser (traçabilité) ou annoter."
echo "   • Secret GitHub GCP_SA_KEY_STRATEGIC360 : nouvelle clé de service account (hors dépôt)."
echo
[ "$DRY" = "1" ] && echo "(DRY_RUN=1 — aucun fichier modifié)" || echo "Fait. Vérifier : git diff, puis npm run build/test avant de committer."
