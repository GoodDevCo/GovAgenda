# Belle Isle Government Tracker

A self-owned, version-controlled historical record of City of Belle Isle, FL local government.
Each **topic** (the FY27 budget, an ordinance, Flock cameras, etc.) is a thread with a
chronological timeline of meeting events and the commissioner remarks recorded in the minutes.

- **Data** lives in `data/topic-archive.json` — the single source of truth. Every weekly
  update is a Git commit, so you get a full audit trail: what changed, when, and the ability
  to diff or roll back any entry.
- **Build** (`scripts/build.mjs`) injects that data into `scripts/template.html` and writes a
  single self-contained page to `public/index.html`.
- **Publish** — the GitHub Action deploys `public/` to GitHub Pages on every change.

## How it fits together

```
data/topic-archive.json   →   node scripts/build.mjs   →   public/index.html   →   GitHub Pages
   (source of truth)              (build step)               (generated view)        (live site)
```

The page is a *generated view*. A static page can't call an API when opened, so the data is
always baked into `public/index.html` at build time. The JSON archive is where scale, editing,
querying, and history live.

## One-time setup

1. **Create the repo** and push these files (see "Pushing" below).
2. In the repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push once (or run the **Build & Deploy tracker** workflow manually from the Actions tab).
   Your site publishes at `https://<your-username>.github.io/<repo-name>/`.

## Pushing (first time)

```bash
git init
git add .
git commit -m "Initial Belle Isle tracker"
git branch -M main
# create an empty repo named belle-isle-tracker on github.com first, then:
git remote add origin https://github.com/<your-username>/belle-isle-tracker.git
git push -u origin main
```

## Updating the data

Edit `data/topic-archive.json` and commit. The Action rebuilds and redeploys automatically.
The schema is documented by example in the file itself:

- `topics[]` — each has `id`, `title`, `category`, `status`, `statusClass`
  (`s-teal` / `s-amber` / `s-slate`), `summary`, `updated`, and a `timeline[]`.
  - Optional `docType` (`Ordinance` / `Resolution`) and `docNum` (e.g. `26-05`) render as a
    distinct badge next to the status/category badges. Put the plain subject in `title`
    (e.g. `"Fire Rescue Assessment"`), not `"Ord. 26-05 — Fire Rescue Assessment"`.
- `timeline[]` — each event has `date` (ISO, for sorting), `dateLabel`, `meeting`, `event`,
  `detail`, `remarks[]` (`{who, role, text}`), and `links[]` (`{label, url}`).
- `weeks[]` — the weekly roll-up shown under the "This week" tab.

The Monday refresh **appends** new timeline entries to existing topics (matched by `id`) and
adds new topics as they arise. Prior entries are never edited, which is what keeps the record
trustworthy.

## The weekly refresh — two options

The *building and publishing* is automated by the Action above. The remaining question is how
the **new data** gets written each week. Two paths:

**A. Assisted (recommended for accuracy).** A scheduled Cowork task does the research each
Monday — reading the newest Belle Isle agendas, packets, and minutes, extracting the events and
commissioner remarks — and commits the updated `data/topic-archive.json`. Because commissioner
quotes are involved, keeping this step AI-assisted (rather than a blind scraper) protects
accuracy. The Action then rebuilds and republishes on that commit. Requires the Cowork session
to be able to push to this repo (e.g. a connected GitHub integration or a deploy token).

**B. Fully autonomous.** A second GitHub Action runs on a weekly `schedule`, calls the
Anthropic API to research and produce the new entries, commits, and lets the deploy workflow
publish. Add an `ANTHROPIC_API_KEY` repo secret (Settings → Secrets and variables → Actions).
Cheap (pennies per run) and hands-off, but the record self-updates with no human glance before
publish, so verify entries periodically against the linked sources.

## Verifying locally

```bash
node scripts/build.mjs
# then open public/index.html in a browser
```
