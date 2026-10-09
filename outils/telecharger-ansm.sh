#!/usr/bin/env bash
# Télécharge l'export ANSM dans public/data/ pour le publier avec le site.
# En cas d'échec, reprend l'export actuellement en ligne (URL_SITE) pour ne pas le perdre.
# Variables attendues : URL_ANSM (export ANSM), URL_SITE (adresse du site GitHub Pages, peut être vide).
set -u

DOSSIER=public/data
FICHIER="$DOSSIER/ansm_export.xls"
META="$DOSSIER/ansm_meta.json"
TEMP=$(mktemp)
mkdir -p "$DOSSIER"

# Un export valide est un classeur Excel : .xls (signature OLE D0CF11E0) ou .xlsx (zip, « PK »).
est_excel() {
  local entete
  entete=$(head -c 4 "$1" | od -An -tx1 | tr -d ' \n')
  [ "$(stat -c %s "$1")" -gt 10000 ] && { [ "$entete" = "d0cf11e0" ] || [ "${entete:0:4}" = "504b" ]; }
}

if curl -fsSL --retry 3 --retry-delay 20 --max-time 120 \
     -A "Mozilla/5.0 (Appli Commande PUI)" -o "$TEMP" "$URL_ANSM" && est_excel "$TEMP"; then
  mv "$TEMP" "$FICHIER"
  printf '{"date":"%s","source":"téléchargement automatique"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$META"
  echo "Export ANSM téléchargé ($(stat -c %s "$FICHIER") octets)."
  exit 0
fi

echo "::warning::Téléchargement de l'export ANSM impossible : reprise de l'export déjà publié."
if [ -n "${URL_SITE:-}" ] \
   && curl -fsSL --max-time 60 -o "$TEMP" "${URL_SITE%/}/data/ansm_export.xls" && est_excel "$TEMP" \
   && curl -fsSL --max-time 60 -o "$META" "${URL_SITE%/}/data/ansm_meta.json"; then
  mv "$TEMP" "$FICHIER"
  echo "Export précédent conservé : $(cat "$META")"
else
  rm -f "$TEMP" "$META"
  echo "::warning::Aucun export ANSM disponible : l'application proposera le chargement manuel."
fi
exit 0
