# CLAUDE.md

Guidance for working in this repo.

## What this is

A **static** full-screen Florida Silver Alert board for digital signage, hosted
on **GitHub Pages**. Modelled on `missing-children` (same design, "The
Bulletin", in Silver Alert blue). It is **single-shot**: one person per page
load, no rotation and no refresh timer. Keep it that way.

The difference from its siblings is the data. FDLE publishes current Silver
Alerts only as an HTML table (`https://mepic.fdle.state.fl.us/currentSilverAlerts.asp`)
with no CORS, so `scraper/scrape.ts` runs in the hourly deploy workflow, after
`bun run build`, and writes `dist/data/alerts.json` and `dist/data/photos/`.
The browser reads only those. Nothing about any person is ever committed.

## The safeguards are the product

The user asked for this explicitly: we parse HTML, so it must fail closed.

- `assets/static/js/alerts.ts` is the **one definition of the dataset**:
  types, bounds, `alertProblem`/`parseDataset`. The scraper validates its
  output with it, and so does the browser. Change both sides together.
- `scraper/parse.ts` refuses the whole page (`LayoutError`) on any structural
  surprise: heading, the single `table.DataTable`, the exact header titles,
  or an empty list without FDLE's notice. It rejects rows rather than repairing
  them, including any cell holding tags outside `ALLOWED_TAGS`.
  `assertHealthy` fails the run past 25% rejected. Don't loosen these to make
  a failing run pass. Find out what changed on FDLE's side first.
- URLs (photo, flyer) are rebuilt from numeric ids, never taken from the page.
- The board refuses data older than `MAX_DATA_AGE_MS` (judged by the
  response's `Date` header) and shows the appeal. Never add a cached or bundled
  list. A stale record could show someone who has been found.
- Render with `textContent`. The QR SVG is the only `innerHTML`.

## Stack & conventions

- **Bun** for everything (package manager, bundler, test runner, scraper).
  Never npm/npx. CI pins **Bun 1.3.14**; update `bun.lock` with that version
  (newer Bun writes `lockfileVersion: 2`, which 1.3.14 can't read).
- **TypeScript**, strict. **Tailwind CSS v4**, CSS-first. **Biome**: single
  quotes, no semicolons, 2-space, 100 cols.

## Commands

```sh
bun install
bun run dev        # build + live scrape + serve dist/
bun run build
bun run scrape     # after build
bun test
bun run typecheck
bun run lint
```

## Layout

- `index.html`: page shell. Card hidden until `html[data-state="ready"]`; the
  appeal shows only when `html[data-state="offline"]` or without JS.
- `assets/static/js/alerts.ts`: pure, tested helpers (dataset validation,
  dates, selection, links). `main.ts`: browser entry, export-free.
- `scraper/parse.ts`: pure HTML → alerts. `scraper/photo.ts`: image sniffing.
  `scraper/scrape.ts`: network + writing, entry only.
- `test/fixture.ts`: builds pages with FDLE's exact markup and **fictional**
  people. Never commit real alerts, photos or screenshots of them.
- `.well-known/signage-app.json`: manifest, no settings (Florida only).

## Layout invariants (inherited from missing-children)

- The board is exactly one viewport tall; the hotline band sits on the bottom
  edge.
- The Screenly badge lives inside the hotline band.
- `fitCard()` scales `--fit`; sizes inside `.card` use `--u`, not `rem`.

## Deploy

`deploy-pages.yml` runs on CalVer tags, hourly (re-deploying the latest tag),
and by hand. A failed scrape fails the job before deploy. PRs run `ci.yml`,
which never scrapes.
