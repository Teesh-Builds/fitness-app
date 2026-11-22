#!/bin/sh
# Builds a single-file preview (preview.html) of the app, used for the claude.ai preview link.
cd "$(dirname "$0")"
{
  echo '<title>Lift Block</title>'
  echo '<meta name="claude:viewport-fit-sides" content="cover">'
  echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,600..800&family=Inter:wght@400;600;700&display=swap">'
  echo '<style>'; cat styles.css; echo '</style>'
  echo '<div id="app"></div>'
  echo '<script>'; cat exercises.js; echo '</script>'
  echo '<script>'; cat app.js; echo '</script>'
} > preview.html
