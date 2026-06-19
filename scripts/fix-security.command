#!/bin/bash
# Rimuove l'attributo di quarantena così DJ Visualizer si apre senza errori.
APP="/Applications/DJ Visualizer.app"
if [ -d "$APP" ]; then
  xattr -cr "$APP"
  echo "✅ Fatto! Ora puoi aprire DJ Visualizer dalle Applicazioni."
else
  echo "⚠️  Prima trascina DJ Visualizer nella cartella Applicazioni, poi riesegui."
fi
echo "Premi Invio per chiudere."
read
