# Massive Video Reviewer

A keyboard-driven tool to review and label large S3 folders of `.mp4` videos (100k+).
It is a **static, browser-only app**. There is no backend. The browser talks to S3 directly
with temporary AWS credentials that you paste once.

**Live app:** https://prithviramg-nd.github.io/massive-video-reviewer/

## How it works

- The home page asks for an **S3 folder link**. Accepted formats:
  - `s3://bucket/path/`
  - an S3 https URL
  - an AWS console folder URL
- The folder is stored in the tab's URL (`?s3=...&region=...`). A new tab asks for a link again,
  so you can review **different folders in different tabs at the same time**. A refresh keeps the folder.
- The app lists every `.mp4` under the folder, including subfolders, sorted by file name.
  It plays the videos through presigned URLs.
- Labels (TP/FP), tags and your last page are saved to `<folder>/review_db.json`. The save runs
  about one second after each change. The **Manual Save** button saves at once.
- If the same folder is open in two tabs, or by two people, saves use S3 ETag conditions
  (`If-Match` / `If-None-Match`). When the file changed elsewhere, the app re-reads it, merges
  your unsaved changes on top, and retries. No labels are lost.
- The `review_db.json` format is unchanged from the old backend version:
  ```json
  { "lastPage": 12, "labels": { "<s3 key>": { "status": "FP", "tags": ["glare"] } } }
  ```
  `lastPage` is stored as a 1x2-grid page number, so it does not depend on the grid layout.

## For colleagues: getting started

1. Open https://prithviramg-nd.github.io/massive-video-reviewer/
2. Paste your own temporary AWS credentials (see below).
3. Paste your S3 folder link, for example `s3://netradyne-sharing/analytics/<you>/<folder>/`, and click **Open folder**.

You don't need to install anything. Your labels are saved to `review_db.json` in your folder.
Open another browser tab to review another folder at the same time.

## AWS credentials

A browser cannot read `~/.aws`, so you paste temporary credentials. Run these commands on your machine:

```bash
aws sso login --profile <profile>
aws configure export-credentials --profile <profile> --format env
```

Paste the output into the app. You can also use **Access keys** in the AWS access portal, or the
`--format process` JSON. The app stores the credentials in this browser's `localStorage`, and all
tabs of the site share them.

When the credentials expire, the app asks for new ones and keeps your unsaved work. Saving
resumes after you paste new credentials. Fresh credentials pasted in one tab are used by all
open tabs. To remove the stored credentials, click **Forget** on the home page.

> All GitHub Pages sites under `prithviramg-nd.github.io` share one browser origin.
> Only your own Pages sites can read the stored keys.

Your credentials need these permissions on the folder: `s3:ListBucket`, `s3:GetObject` and
`s3:PutObject` (the last one only for saving).

## One-time bucket setup (CORS)

CORS is set **once per bucket**, and every folder in that bucket is covered.
`netradyne-sharing` needs it only once for the whole team. If someone opens a bucket that isn't set
up, the app shows a **How to fix** button with a ready-to-copy script for that bucket. The script
keeps the bucket's existing rules.

The browser can call a bucket only if the bucket's CORS rules allow it. Listing, the videos and
reading `review_db.json` use presigned GET requests, so a rule that allows GET from any origin
is enough. **Saving needs PUT.** [`s3-cors.json`](s3-cors.json) adds a rule for this site and for
localhost dev, and keeps the existing public-GET rule:

```bash
# put-bucket-cors REPLACES the whole config. Check the current rules first and merge them in.
aws s3api get-bucket-cors --bucket netradyne-sharing
aws s3api put-bucket-cors --bucket netradyne-sharing --cors-configuration file://s3-cors.json
```

The rule for this site must stay **first**. S3 uses the first rule that matches, and only that
rule exposes the `ETag` header, which the conflict-safe saves need. Without the PUT rule, the app
still works read-only and shows "Saving was blocked…".

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1`–`6` | Focus a video (also focuses its tag box) |
| `Esc` | Leave the tag box so the shortcuts work again |
| `Q` / `W` | Mark the focused video TP / FP |
| `Space` | Play or pause |
| `←` / `→` | Step 0.1 s |
| `A` / `S` (or PageUp / PageDown) | Previous / next page |
| `Z` | Fullscreen |
| `X` | Copy the video file name |

## Development

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ on http://localhost:4173
```

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys every push to `main`.
One-time setup: open the repo **Settings → Pages**, and set **Source** to **GitHub Actions**.
On a free GitHub plan, Pages needs a public repo. The code contains no secrets.

## Project layout

```
index.html, index.tsx    entry point
Root.tsx                 per-tab routing (?s3=...) and credential state
App.tsx                  the reviewer: grid, shortcuts, save queue
components/              SetupScreen, CredentialsForm, CorsHelp, VideoPlayer, Pagination
lib/s3.ts                S3 link parsing, listing, presigning, review_db.json load/save
lib/credentials.ts       pasted-credential parsing + localStorage
s3-cors.json             bucket CORS config needed for saving
```
