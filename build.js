#!/usr/bin/env bun
/* global Bun */
// Builds the static site into ./dist for GitHub Pages. Like the sibling
// on-this-day app this is a plain static bundle — no server. The alert data is
// added after the build by scraper/scrape.ts (dist/data/), never committed;
// nothing about any person is in the repo. Steps:
//   1. vendor fonts from @fontsource (sync-fonts.js)
//   2. assemble dist/ (index.html + static assets, copied not mutated)
//   3. compile Tailwind v4 CSS (minified)
//   4. bundle TypeScript → browser JS (minified, ./alerts inlined)
//   5. stamp a content hash into asset URLs (?v=) for cache-busting
//   6. write CNAME for the custom domain
//   7. write .nojekyll so Pages serves .well-known/ verbatim
// dist/ is gitignored; CI uploads it as the Pages artifact.

import { rm, mkdir, cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { bundleJs, injectGate, processCss } from '@screenly-labs/signage-kit/build'
import { run as syncFonts } from './sync-fonts.js'

const DIST = 'dist'
const DOMAIN = 'silver-alert.srly.io'

// The support floor, the CSS down-leveling recipe, the JS bundler, and the inline
// degraded-mode gate all come from @screenly-labs/signage-kit. This file only
// orchestrates the app-specific steps: the gate is injected into index.html at
// build time (step 2) rather than living inline in the source. See the kit's
// degraded-mode docs and tailwind.css for the html.legacy styling.

// 1. Vendor the Bun-managed webfonts into ./assets before copying.
await syncFonts()

// 2. Fresh dist/, then copy the web root (everything served at /static/...) and
// the page shell. Sources are never minified in place.
await rm(DIST, { recursive: true, force: true })
await mkdir(`${DIST}/static`, { recursive: true })
// Create the output subdirs up front so Tailwind/the kit's bundler never race an
// absent dir.
await mkdir(`${DIST}/static/styles`, { recursive: true })
await mkdir(`${DIST}/static/js`, { recursive: true })
await cp('assets/static/fonts', `${DIST}/static/fonts`, { recursive: true })
await cp('assets/static/images', `${DIST}/static/images`, { recursive: true })
// Copy the page shell with the shared degraded-mode gate injected before the
// stylesheet, so html.legacy is set on the first paint on old/weak players.
await writeFile(`${DIST}/index.html`, injectGate(await readFile('index.html', 'utf8')))
// The signage-app manifest lives at the well-known site-root path the app store
// and players fetch (see docs/app-manifest.md); GitHub Pages serves it as
// application/json with Access-Control-Allow-Origin:* out of the box.
await cp('.well-known', `${DIST}/.well-known`, { recursive: true })

// 3. Tailwind: compile the source CSS, then hand it to the kit's CSS pipeline,
// which flattens @layer into :not(#\#) specificity so the cascade survives on
// engines that drop @layer contents, then down-levels + minifies to the floor.
const cssOut = `${DIST}/static/styles/main.css`
const tailwind = Bun.spawn(
  [
    'node_modules/.bin/tailwindcss',
    '--input',
    'assets/static/styles/tailwind.css',
    '--output',
    cssOut
  ],
  { stdout: 'inherit', stderr: 'inherit' }
)
if ((await tailwind.exited) !== 0) {
  console.error('✗ Tailwind build failed')
  process.exit(1)
}
try {
  await writeFile(
    cssOut,
    await processCss(await readFile(cssOut, 'utf8'), { flattenLayers: true, filename: cssOut })
  )
} catch (error) {
  console.error(`✗ CSS build failed (${cssOut})`)
  console.error(error)
  process.exit(1)
}
console.log(`✓ CSS: ${cssOut}`)

// 4. Client TS -> the kit's bundler (self-contained IIFE at the floor's syntax
// level), so the output stays a classic script loadable from a plain <script>.
try {
  await bundleJs('assets/static/js/main.ts', `${DIST}/static/js/main.js`)
} catch (error) {
  console.error('✗ JS build failed')
  console.error(error)
  process.exit(1)
}
console.log(`✓ JS: ${DIST}/static/js/main.js`)

// 5. Cache-busting: hash every asset whose URL carries the ?v= token — the JS,
// CSS, fonts and logo — so the token changes exactly when any shipped, stamped
// asset changes, then stamp it into the page's asset URLs.
const fonts = (await readdir(`${DIST}/static/fonts`))
  .sort()
  .map((file) => `${DIST}/static/fonts/${file}`)
const fingerprintPaths = [
  `${DIST}/static/js/main.js`,
  `${DIST}/static/styles/main.css`,
  `${DIST}/static/images/screenly-logo.svg`,
  ...fonts
]
const fingerprint = await Promise.all(fingerprintPaths.map((path) => readFile(path)))
const hasher = new Bun.CryptoHasher('sha256')
for (const buf of fingerprint) hasher.update(buf)
const version = hasher.digest('hex').slice(0, 10)

const html = await readFile(`${DIST}/index.html`, 'utf8')
await writeFile(`${DIST}/index.html`, html.replaceAll('__ASSET_VERSION__', version))
console.log(`✓ Stamped asset version ${version}`)

// 6. Custom domain for GitHub Pages.
await writeFile(`${DIST}/CNAME`, `${DOMAIN}\n`)
console.log(`✓ CNAME: ${DOMAIN}`)

// 7. Disable Jekyll so Pages serves files as-is — without this marker a Jekyll
// build would skip dot-prefixed directories like .well-known/, 404-ing the
// manifest.
await writeFile(`${DIST}/.nojekyll`, '')
console.log('✓ .nojekyll')

console.log('Build complete → dist/')
