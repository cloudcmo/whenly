# Whenly — automation & relaunch runbook

Whenly is a static site on **Netlify** (repo `github.com/cloudcmo/whenly`, domain
**whenly.co.uk**). The game reads its questions live from a published Google Sheet
(columns `date | category | question | image | answer | min | max | explainer`),
so new questions appear with no redeploy. This adds a small pipeline — borrowed
from Pub Quiz Daily — to write questions into the sheet and auto-source images.

## What was added
- `scripts/draft-questions.js` — appends questions from `whenly-question-drafts.json`
  into the sheet (append-only, de-duped, never overwrites).
- `scripts/add-images.js` — fills the **image column (D)** with free Pexels photos,
  searched on the **question text only** so the picture never gives the year away.
- `image-search.config.example.json` — config template.
- `index.html` — one-line change so the image column accepts full `http(s)` URLs
  (Pexels) as well as local `/images/` filenames. Existing local images still work.

## One-time setup (about 5 minutes)
1. `cp image-search.config.example.json image-search.config.json`
2. Open your **pubquizdaily** `image-search.config.json` and copy its
   `pexelsApiKey` and the whole `googleServiceAccount` block into this new file.
   (The `sheetId` is already set to the Whenly sheet.)
3. Share the **Whenly** Google Sheet with the service account's email —
   `pqd-images@sonic-progress-499712-k5.iam.gserviceaccount.com` — as **Editor**.
   (It currently only has access to the PubQuiz sheet.)

## Loading a batch of questions
```
npm run draft-questions -- --dry-run    # preview what would be appended
npm run draft-questions                 # append them to the sheet
```
Safe to re-run: anything already in the sheet (same date + question) is skipped.

## Images
```
# ONE-OFF clean-up: replace EVERY image (incl. the old historical ones) with Pexels:
npm run add-images -- --all --overwrite

# Normal use afterwards — only fills new rows that have no image yet:
npm run add-images
```
Add `--dry-run` to preview. If you hit the Pexels free-tier hourly cap
(~200 lookups), add `--limit=180` and re-run the same command an hour later —
already-done rows are skipped, so it just continues.

## Going live (relaunch)
The site-wide redirect to pubquizdaily.com has been removed from `_redirects`.
Review and deploy with your usual flow:
```
git diff                 # check index.html + _redirects changes
./deploy-staging.sh      # test on staging first
./deploy-main.sh         # promote to live whenly.co.uk
```
To send the site back to PubQuiz Daily again, restore the one line in `_redirects`.

## Keeping it hands-off
- Questions are added in batches, so the routine is: drop a new batch into
  `whenly-question-drafts.json` → `npm run draft-questions` → `npm run add-images`.
- To fully automate images, add a `cron`/`launchd` job on your Mac (it has the
  config + network) running `npm run add-images` daily, or a Netlify scheduled
  function with the service-account creds in env — the same pattern as the
  existing `daily-report` function.
