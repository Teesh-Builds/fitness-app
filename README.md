# Lift Block

A 12-week, 3-day full-body training tracker that runs in the phone's browser and can be added to the home screen. There is no server: every user's data is stored in their own browser (localStorage).

## Files
- `exercises.js`: **the exercise list.** Edit this to add, remove or rename exercises, and to paste specific how-to video links (blank `video` = automatic YouTube search link). Deload weeks and block length are set here too.
- `app.js`: the app (onboarding, targets, plan builder, tracker, week 13 check-in, backup).
- `styles.css`, `index.html`, `manifest.webmanifest`, `sw.js`, `icons/`: page, install and offline support.
- `build-preview.sh`: rebuilds `preview.html`, a single-file copy used for previews.

## Run locally
`python3 -m http.server 8000` in this folder, then open http://localhost:8000.

## Updating after it's hosted
Change files, then bump `VERSION` in `sw.js` so installed phones pick up the change.
