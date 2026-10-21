#!/usr/bin/env bun
// Fetches FDLE's current Silver Alerts and writes the dataset the board reads:
//
//   dist/data/alerts.json        the alerts (see assets/static/js/alerts.ts)
//   dist/data/photos/{id}.jpg    one photo per alert that has one (or .png)
//
// Run after `bun run build`, by the hourly deploy workflow. Any failure exits
// non-zero, which fails the job before the Pages deploy step, so a bad scrape is
// never published; the previous deploy stays up, and the board stops trusting
// it once it is older than MAX_DATA_AGE_MS.
//
// Safeguards on the way in: one fixed HTTPS URL, a timeout and retries on every
// request, a size cap, redirects refused, the content type checked, and the
// strict parser in ./parse.ts. On the way out: photos must be real JPEGs or PNGs within
// a size range, and the finished dataset must pass the same `parseDataset` the
// browser runs, with nothing dropped, before it is written.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import {
  type PhotoFormat,
  type SilverAlert,
  SCHEMA_VERSION,
  SOURCE_ORIGIN,
  SOURCE_URL,
  isoToday,
  parseDataset
} from '../assets/static/js/alerts'
import { assertHealthy, parseSilverAlerts } from './parse'
import { sniffPhoto } from './photo'

const OUT_DIR = process.env.SILVER_ALERT_OUT ?? 'dist/data'
const USER_AGENT = 'Screenly-Labs silver-alert (+https://github.com/Screenly-Labs/silver-alert)'
const TIMEOUT_MS = 30_000
const ATTEMPTS = 4
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MIN_PHOTO_BYTES = 1024
const MAX_PHOTO_BYTES = 2 * 1024 * 1024

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** GET with a timeout, a byte cap, no redirects, and retries with backoff. */
const fetchBytes = async (
  url: string,
  maxBytes: number
): Promise<Response & { bytes: Uint8Array }> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > maxBytes) throw new Error(`body is ${declared} bytes, over ${maxBytes}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength > maxBytes) throw new Error(`body is over ${maxBytes} bytes`)
      return Object.assign(res, { bytes })
    } catch (error) {
      lastError = error
      console.warn(`  attempt ${attempt}/${ATTEMPTS} for ${url} failed: ${error}`)
      if (attempt < ATTEMPTS) await sleep(2 ** attempt * 1000)
    }
  }
  throw new Error(`giving up on ${url}: ${lastError}`)
}

/** Downloads one photo, or returns null if it isn't a plausible image. */
const fetchPhoto = async (
  fin: string
): Promise<{ bytes: Uint8Array; format: PhotoFormat } | null> => {
  try {
    const res = await fetchBytes(`${SOURCE_ORIGIN}/GetImage.asp?FIN=${fin}`, MAX_PHOTO_BYTES)
    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) throw new Error(`content-type ${type}`)
    if (res.bytes.byteLength < MIN_PHOTO_BYTES) throw new Error('too small to be a photo')
    const format = sniffPhoto(res.bytes)
    if (!format) throw new Error('neither a JPEG nor a PNG')
    return { bytes: res.bytes, format }
  } catch (error) {
    // A missing photo is not fatal: the board shows initials instead.
    console.warn(`  photo ${fin} skipped: ${error}`)
    return null
  }
}

const main = async (): Promise<void> => {
  const now = new Date()
  const today = isoToday(now)
  console.log(`Fetching ${SOURCE_URL}`)
  const page = await fetchBytes(SOURCE_URL, MAX_PAGE_BYTES)
  const type = page.headers.get('content-type') ?? ''
  if (!type.startsWith('text/html')) throw new Error(`unexpected content-type ${type}`)
  // FDLE serves ISO-8859-1; windows-1252 is its superset, as browsers treat it.
  const html = new TextDecoder('windows-1252').decode(page.bytes)

  const result = parseSilverAlerts(html, today)
  for (const r of result.rejected) console.warn(`  row ${r.row} rejected: ${r.reason}`)
  assertHealthy(result)
  console.log(`✓ ${result.alerts.length} alerts (${result.rejected.length} rows rejected)`)

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(`${OUT_DIR}/photos`, { recursive: true })
  const alerts: SilverAlert[] = []
  for (const { photoFin, ...alert } of result.alerts) {
    const photo = photoFin ? await fetchPhoto(photoFin) : null
    if (photo) await writeFile(`${OUT_DIR}/photos/${alert.id}.${photo.format}`, photo.bytes)
    alerts.push({ ...alert, photo: photo?.format ?? null })
  }

  const dataset = {
    schema: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    source: SOURCE_URL,
    alerts
  }
  // The browser's own validator must accept every alert, or nothing ships.
  const check = parseDataset(JSON.parse(JSON.stringify(dataset)), now)
  if (!check.ok) throw new Error(`dataset failed validation: ${check.reason}`)
  if (check.dropped > 0) throw new Error(`dataset validation dropped ${check.dropped} alerts`)

  await writeFile(`${OUT_DIR}/alerts.json`, `${JSON.stringify(dataset, null, 2)}\n`)
  const photos = alerts.filter((a) => a.photo).length
  console.log(`✓ Wrote ${OUT_DIR}/alerts.json (${alerts.length} alerts, ${photos} photos)`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`✗ Scrape failed: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
