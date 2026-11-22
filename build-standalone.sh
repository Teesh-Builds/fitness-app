#!/bin/sh
# Builds lift-block-standalone.html: the whole app in one file.
cd "$(dirname "$0")"
OUT=${1:-lift-block-standalone.html}
ICON=$(base64 -w0 icons/apple-touch-icon.png)
{
cat <<HEAD
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Lift Block</title>
<!-- Lift Block: the whole app in one file (HTML + CSS + exercise list + app code).
     Data is saved in the browser's localStorage on the device that opens it. -->
<meta name="theme-color" content="#111111">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="Lift Block">
<link rel="icon" href="data:image/png;base64,$ICON">
<link rel="apple-touch-icon" href="data:image/png;base64,$ICON">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,600..800&family=Inter:wght@400;600;700&display=swap">
<style>
HEAD
cat styles.css
echo '</style>'; echo '</head>'; echo '<body>'; echo '<div id="app"></div>'
echo '<noscript>Lift Block needs JavaScript turned on.</noscript>'
echo '<!-- ===== EXERCISE LIST (edit here) ===== -->'
echo '<script>'; cat exercises.js; echo '</script>'
echo '<script>'; cat xlsx.js; echo '</script>'
echo '<!-- ===== APP CODE ===== -->'
echo '<script>'; cat app.js; echo '</script>'
echo '</body>'; echo '</html>'; } > "$OUT"
