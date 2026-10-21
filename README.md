# Screenly Florida Silver Alert App

A full-screen Silver Alert board for digital signage in Florida. Each time the
page loads it shows **one person** from the **Florida Department of Law
Enforcement**'s current Silver Alerts: their photo, their age, when and where
they went missing, and a QR code for the official FDLE flyer. Alerts issued in
the last 30 days come first. **911** and FDLE's **1-888-FL-MISSING** line are
always on screen.

Silver Alerts are for adults who go missing with an irreversible deterioration
of intellectual faculties, such as dementia, often while driving.

Live: **https://silver-alert.srly.io**

Part of the Screenly signage family alongside
[missing-children](https://github.com/Screenly-Labs/missing-children), which it
is modelled on. Like it, the board is a **static** site on **GitHub Pages**,
built on [`@screenly-labs/signage-kit`](https://github.com/Screenly-Labs/signage-kit).

## Where the data comes from

FDLE's Missing Endangered Persons Information Clearinghouse lists every current
Silver Alert at:

```
https://mepic.fdle.state.fl.us/currentSilverAlerts.asp
```

That page is HTML only (no JSON or RSS) and it doesn't answer CORS requests, so
the browser can't read it directly. Instead an **hourly GitHub Actions job**
scrapes it, validates every field, and deploys the result to Pages next to the
board:

```
/data/alerts.json        the alerts
/data/photos/{id}.jpg    one photo per alert (some are .png)
```

The browser only ever reads those two paths on its own origin. The QR code links
to FDLE's own flyer for the alert, `https://mepic.fdle.state.fl.us/Flyer.asp?ID={id}`.

## Safeguards

Parsing someone else's HTML is fragile, and showing the wrong person, or
someone who has already been found, is worse than showing nobody. So the
scraper refuses to guess, and the board refuses to trust anything stale.

**Scraper (`scraper/`)**

- One fixed HTTPS URL. 30 s timeout, 4 attempts with backoff, redirects refused,
  2 MB size cap, `text/html` required.
- Parsed with [parse5](https://github.com/inikulin/parse5), the spec-compliant
  HTML parser, not regexes.
- The **whole page is refused** unless the heading reads "Current Silver
  Alerts", there is exactly one results table, and its header has exactly the
  eight expected columns in order. "Nobody is missing" is only accepted when
  FDLE's own "No Silver Alerts are active at this time." notice is present.
- **Each row is checked on its own**:
  - exactly 8 cells, each holding only the tags FDLE uses there (a stray
    `<script>`, `<img>` or link rejects the row);
  - the photo and name link to the same numeric flyer id;
  - names must be "Last, First" in letters only;
  - dates must be real dates;
  - FDLE's printed "Age" and "Age Missing" must match the ages computed from the
    dates, which catches shifted columns;
  - the person must have been 18 or over when they went missing;
  - the missing date can't be in the future or before 2008;
  - the place must be "City,ST".

  Bad rows are dropped with a logged reason, never patched up.
- If more than a quarter of rows fail, or all of them do, the run fails.
- Photo and flyer URLs are **rebuilt from validated numeric ids**, never copied
  from the page. Photos must be real JPEG or PNG files by signature (FDLE
  labels PNGs as `image/jpeg`), 1 KB to 2 MB. A bad photo falls back to
  initials.
- The finished dataset must pass the **same validator the browser runs**, with
  nothing dropped, before it is written.
- Any failure fails the job **before the deploy step**, so nothing is
  published and the previous deploy stays up.

**Board (`assets/static/js/`)**

- Revalidates every alert (`parseDataset`) and drops unknown fields.
- Refuses the whole file if it's the wrong schema, has over 300 alerts, or was
  generated **more than 4 hours ago**. Freshness is judged against the server's
  `Date` header, so a player with a wrong clock can't revive stale data. A
  refused file shows the standing appeal (911 + FDLE line) instead of a person.
- Everything is rendered with `textContent`. The only markup inserted is the
  locally generated QR SVG.
- There is no bundled or cached list.

If the hourly job stops (FDLE down for hours, the page layout changes, or GitHub
disables the schedule after 60 days without repository activity), screens fall
back to the appeal within 4 hours rather than showing old alerts. A failed run
shows up as a red run in the Actions tab.

## Stack

- **Bun** for package management, bundling, tests and the scraper (no npm/npx)
- **TypeScript**, strict
- **Tailwind CSS v4**, CSS-first config, compiled by the Tailwind CLI
- **Biome** for lint + format
- Self-hosted Bricolage Grotesque + Hanken Grotesk, vendored via signage-kit

## Develop

```sh
bun install
bun run dev        # build, scrape live into dist/data, serve dist/
bun run build      # build the static site into dist/
bun run scrape     # scrape FDLE into dist/data (after build)
bun test           # parser, validator and manifest tests
bun run typecheck  # tsc --noEmit
bun run lint       # Biome (lint:fix / format to auto-fix)
```

Tests run against fictional fixtures (`test/fixture.ts`) that copy FDLE's
markup exactly. Never commit real alert data or screenshots of it.

## Supported resolutions

Verified landscape **and** portrait at 3840×2160, 1920×1080, 1280×720 and
800×480 (Raspberry Pi Touch Display).

## Deploy

`.github/workflows/deploy-pages.yml` builds, tests, scrapes and publishes
`dist/` to GitHub Pages:

- on a **CalVer tag** (`YYYY.N.P`), to ship new code;
- **hourly** (`:17`), re-deploying the **latest tag** with fresh data;
- by hand (`workflow_dispatch`).

Pushing to `master` on its own does not deploy. CI (`ci.yml`) typechecks,
lints, tests and builds every PR; it never scrapes.

One-time setup follows the app-store repo's `docs/new-app-setup.md` (Pages
with `build_type=workflow`, the tag deployment policy, DNS
`silver-alert.srly.io → screenly-labs.github.io`, then the custom domain).

## Attribution

Alert data and photographs are published by the
[Florida Department of Law Enforcement](https://www.fdle.state.fl.us/mepic) and
are shown unaltered apart from name casing, with a link to each official flyer
and a standing credit on every screen. This app is not affiliated with or
endorsed by FDLE.

## License

AGPL-3.0-only (see `LICENSE`).
