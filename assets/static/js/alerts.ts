// Pure, unit-tested helpers for the silver-alert app (no DOM). main.ts owns the
// fetch and rendering; everything that can be tested without a browser lives
// here so test/alerts.test.ts can import it directly.
//
// Data source: the Florida Department of Law Enforcement's list of current
// Silver Alerts, published by its Missing Endangered Persons Information
// Clearinghouse (MEPIC). FDLE only publishes an HTML table and doesn't answer
// CORS requests, so an hourly GitHub Actions job (scraper/scrape.ts) reads it,
// validates every field, and publishes `data/alerts.json` plus the photos next
// to this page. This module is the one definition of that dataset: the scraper
// checks its own output with `parseDataset` before publishing, and the browser
// checks it again before showing anything.

export const SOURCE_ORIGIN = 'https://mepic.fdle.state.fl.us'
export const SOURCE_URL = `${SOURCE_ORIGIN}/currentSilverAlerts.asp`

// FDLE's missing persons line, shown on every screen next to 911.
export const HOTLINE = '1-888-FL-MISSING'
export const HOTLINE_DIGITS = '1-888-356-4774'

export const DATASET_PATH = '/data/alerts.json'
export const SCHEMA_VERSION = 1

/**
 * How old the published dataset may be before the board stops trusting it. The
 * job runs hourly; this allows a few late or failed runs. Past it the board
 * shows the standing appeal instead: a stale list could show someone who has
 * already been found, and that is worse than showing nobody.
 */
export const MAX_DATA_AGE_MS = 4 * 60 * 60 * 1000
/** Clock skew tolerated for a `generatedAt` in the future. */
export const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000

/** Alerts issued within this many days are shown before older ones. */
export const RECENT_DAYS = 30

// Hard bounds, shared by the scraper and the browser. Anything outside them is
// a parsing fault, not a person.
export const MAX_ALERTS = 300
export const MAX_NAME_LENGTH = 80
export const MAX_CITY_LENGTH = 60
/** A Silver Alert is for an adult: 18 or over. */
export const MIN_AGE = 18
export const MAX_AGE = 120
/** FDLE's Silver Alert plan dates from 2008; nothing older is plausible. */
export const MIN_YEAR = 2008

export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

export type PhotoFormat = 'jpg' | 'png'
export const PHOTO_FORMATS: readonly PhotoFormat[] = ['jpg', 'png']

export interface SilverAlert {
  /** FDLE's flyer id (`Flyer.asp?ID=…`), digits only. */
  id: string
  /** Display name, "First Last". */
  name: string
  /** Calendar date the person went missing, `YYYY-MM-DD`. */
  missingDate: string
  /** Date of birth, `YYYY-MM-DD`; the age shown is computed from it. */
  birthDate: string
  city: string
  /** Two-letter state code, normally `FL`. */
  state: string
  /** Format of the published `data/photos/{id}.{photo}`, or null for none. */
  photo: PhotoFormat | null
}

export interface Dataset {
  generatedAt: string
  alerts: SilverAlert[]
}

const ID_RE = /^\d{1,9}$/
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
// Letters (any script, with combining marks), spaces, and the punctuation real
// names use. No digits, brackets, quotes or markup characters.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u
const STATE_RE = /^[A-Z]{2}$/

/** True for a real calendar date, `YYYY-MM-DD`. */
export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const m = ISO_DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/** `M/D/YYYY` (FDLE's format) → `YYYY-MM-DD`, or null if it isn't a real date. */
export const parseUsDate = (raw: string): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim())
  if (!m) return null
  const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return isIsoDate(iso) ? iso : null
}

const utcDay = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** `today` as a local calendar date, `YYYY-MM-DD`. */
export const isoToday = (today: Date): string =>
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

/** Whole years between two `YYYY-MM-DD` dates (age on `on` for a birth date). */
export const yearsBetween = (from: string, on: string): number => {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = on.split('-').map(Number)
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0)
}

/** Whole days between a `YYYY-MM-DD` date and `today` (local), never negative. */
export const daysSince = (iso: string, today: Date): number =>
  Math.max(0, Math.round((utcDay(isoToday(today)) - utcDay(iso)) / 86_400_000))

/** `2026-10-13` → `October 13, 2026`. */
export const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS_LONG[m - 1]} ${d}, ${y}`
}

/** "Missing 3 days" / "Missing 1 year" style duration, coarsened as it grows. */
export const formatDuration = (days: number): string => {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days < 1) return 'Missing since today'
  if (days < 60) return `Missing ${plural(days, 'day')}`
  if (days < 730) return `Missing ${plural(Math.floor(days / 30.44), 'month')}`
  return `Missing ${plural(Math.floor(days / 365.25), 'year')}`
}

/** Collapse runs of whitespace (including no-break spaces) and trim. */
export const squash = (raw: string): string => raw.replace(/[\s ]+/g, ' ').trim()

/**
 * Names arrive in mixed casing. Title-case only the words that are entirely
 * upper- or lower-case, so deliberate casing like "McKenzie" survives.
 */
export const tidyCase = (raw: string): string =>
  squash(raw)
    .split(' ')
    .map((word) =>
      word === word.toUpperCase() || word === word.toLowerCase()
        ? word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
        : word
    )
    .join(' ')

/** True for a name made only of letters and name punctuation, within bounds. */
export const isPlausibleName = (value: string): boolean =>
  value.length >= 2 && value.length <= MAX_NAME_LENGTH && NAME_RE.test(value)

export const isPlausibleCity = (value: string): boolean =>
  value.length >= 2 && value.length <= MAX_CITY_LENGTH && NAME_RE.test(value)

/**
 * Checks one alert against every rule the board relies on and returns the
 * reason it fails, or null when it is fine. `today` is a `YYYY-MM-DD` date.
 */
export const alertProblem = (raw: unknown, today: string): string | null => {
  if (!raw || typeof raw !== 'object') return 'not an object'
  const a = raw as Record<string, unknown>
  if (typeof a.id !== 'string' || !ID_RE.test(a.id)) return 'bad id'
  if (typeof a.name !== 'string' || !isPlausibleName(a.name)) return 'bad name'
  if (typeof a.city !== 'string' || !isPlausibleCity(a.city)) return 'bad city'
  if (typeof a.state !== 'string' || !STATE_RE.test(a.state)) return 'bad state'
  if (a.photo !== null && !PHOTO_FORMATS.includes(a.photo as PhotoFormat)) return 'bad photo'
  if (!isIsoDate(a.missingDate)) return 'bad missing date'
  if (!isIsoDate(a.birthDate)) return 'bad birth date'
  if (Number(a.missingDate.slice(0, 4)) < MIN_YEAR) return 'missing date too old'
  // One day of slack: FDLE dates are Eastern, the job runs on UTC.
  if (utcDay(a.missingDate) > utcDay(today) + 86_400_000) return 'missing date in the future'
  const ageMissing = yearsBetween(a.birthDate, a.missingDate)
  if (ageMissing < MIN_AGE) return 'under 18 when missing'
  if (yearsBetween(a.birthDate, today) > MAX_AGE) return 'implausible age'
  return null
}

/** The alert, normalized to exactly the known fields, or null if it fails a rule. */
export const toAlert = (raw: unknown, today: string): SilverAlert | null => {
  if (alertProblem(raw, today) !== null) return null
  const a = raw as SilverAlert
  return {
    id: a.id,
    name: a.name,
    missingDate: a.missingDate,
    birthDate: a.birthDate,
    city: a.city,
    state: a.state,
    photo: a.photo
  }
}

export type DatasetResult =
  | { ok: true; dataset: Dataset; dropped: number }
  | { ok: false; reason: string }

/**
 * Validates the published dataset. `now` is the trusted current time (the
 * server's `Date` header when the browser has one, see main.ts). Rejects the
 * whole file when it is the wrong schema, stale, from the future, or too
 * large; drops individual alerts that fail a rule.
 */
export const parseDataset = (data: unknown, now: Date): DatasetResult => {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'not an object' }
  const d = data as Record<string, unknown>
  if (d.schema !== SCHEMA_VERSION) return { ok: false, reason: `unknown schema ${d.schema}` }
  if (typeof d.generatedAt !== 'string') return { ok: false, reason: 'no generatedAt' }
  const generated = Date.parse(d.generatedAt)
  if (!Number.isFinite(generated)) return { ok: false, reason: 'bad generatedAt' }
  const age = now.getTime() - generated
  if (age > MAX_DATA_AGE_MS) return { ok: false, reason: 'stale' }
  if (age < -MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'generatedAt in the future' }
  if (!Array.isArray(d.alerts)) return { ok: false, reason: 'no alerts array' }
  if (d.alerts.length > MAX_ALERTS) return { ok: false, reason: 'too many alerts' }
  const today = isoToday(now)
  const seen = new Set<string>()
  const alerts: SilverAlert[] = []
  for (const raw of d.alerts) {
    const alert = toAlert(raw, today)
    if (!alert || seen.has(alert.id)) continue
    seen.add(alert.id)
    alerts.push(alert)
  }
  return {
    ok: true,
    dataset: { generatedAt: d.generatedAt, alerts },
    dropped: d.alerts.length - alerts.length
  }
}

/** A uniform integer in [0, length). Clamped, so rng() === 1 stays in range. */
export const pickRandomIndex = (length: number, rng: () => number = Math.random): number => {
  if (!Number.isFinite(length) || length < 1) return 0
  return Math.min(length - 1, Math.floor(rng() * length))
}

/**
 * Picks one alert at random. Alerts issued in the last RECENT_DAYS come first:
 * a new Silver Alert is the one where a sighting is most likely to help, while
 * FDLE keeps older ones listed for years. Within that pool, alerts with a photo
 * are preferred, since a face is what a passerby can recognise.
 */
export const pickAlert = (
  alerts: SilverAlert[],
  today: Date,
  rng: () => number = Math.random
): SilverAlert | null => {
  if (alerts.length === 0) return null
  const recent = alerts.filter((a) => daysSince(a.missingDate, today) <= RECENT_DAYS)
  const base = recent.length > 0 ? recent : alerts
  const withPhoto = base.filter((a) => a.photo)
  const pool = withPhoto.length > 0 ? withPhoto : base
  return pool[pickRandomIndex(pool.length, rng)]
}

/** FDLE's printable flyer for an alert (the QR code target). */
export const flyerUrl = (id: string): string => `${SOURCE_ORIGIN}/Flyer.asp?ID=${id}`

/** The published photo for an alert, on this site. */
export const photoPath = (alert: Pick<SilverAlert, 'id' | 'photo'>): string | null =>
  alert.photo ? `/data/photos/${alert.id}.${alert.photo}` : null

/** "Cutler Bay, FL". */
export const formatPlace = (alert: Pick<SilverAlert, 'city' | 'state'>): string =>
  `${alert.city}, ${alert.state}`

/** A URL without the scheme, for printing on screen. */
export const displayUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '')
