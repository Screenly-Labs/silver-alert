// Browser entry. @screenly-labs/signage-kit bundles this (inlining ./alerts)
// into a self-contained classic script with no exports, so it loads from a
// plain <script>. Keep it export-free and free of top-level await.
//
// Single-shot, like missing-children and quotes: each page load shows one
// person from Florida's current Silver Alerts. There is no rotation and no
// refresh timer; the player's reload is what brings the next person.
//
// Flow: fetch data/alerts.json (published next to this page by the hourly
// scrape) → check it is fresh and well-formed (parseDataset) → pick one alert,
// newest first (pickAlert) → render. If the file is missing, stale, malformed or
// empty, the standing appeal stays up instead. There is deliberately no bundled
// fallback list: a stale record could show someone who has since been found.

// Side-effect import: installs the replaceChildren shim for the older-browser
// degraded mode. Must stay first so the shim is in place before any render.
import '@screenly-labs/signage-kit/polyfills'
import { trackPlayer } from '@screenly-labs/signage-kit/analytics'
import { removeScreenlyBranding } from '@screenly-labs/signage-kit/branding'
import { detectPlayer } from '@screenly-labs/signage-kit/profiler'
import qrcode from 'qrcode-generator'
import {
  DATASET_PATH,
  type SilverAlert,
  daysSince,
  displayUrl,
  flyerUrl,
  formatDate,
  formatDuration,
  formatPlace,
  isoToday,
  parseDataset,
  photoPath,
  pickAlert,
  yearsBetween
} from './alerts'

const FETCH_TIMEOUT_MS = 10_000
// The card shrinks in FIT_STEP steps down to MIN_FIT of its designed size.
const MIN_FIT = 0.45
const FIT_STEP = 0.05

const el = (id: string): HTMLElement | null => document.getElementById(id)

// Every value from the dataset goes on screen through textContent, never as
// markup.
const text = (id: string, value: string): void => {
  const node = el(id)
  if (node) node.textContent = value
}

const initials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

// QR SVG for the flyer link, built locally: the URL is encoded into modules,
// never injected as markup, and it is rebuilt from the validated numeric id.
const qrSvg = (link: string): string => {
  const qr = qrcode(0, 'L')
  qr.addData(link)
  qr.make()
  return qr.createSvgTag({ scalable: true, margin: 0 })
}

const renderPhoto = (alert: SilverAlert): void => {
  const frame = el('sa-photo-frame')
  const img = el('sa-photo') as HTMLImageElement | null
  if (!frame || !img) return
  text('sa-initials', initials(alert.name))
  const src = photoPath(alert)
  if (!src) {
    img.removeAttribute('src')
    frame.dataset.state = 'empty'
    return
  }
  // Show the initials card until the photo has loaded, and keep it if the photo
  // fails, so a broken image never sits on screen.
  frame.dataset.state = 'loading'
  img.onload = () => {
    frame.dataset.state = 'ready'
  }
  img.onerror = () => {
    frame.dataset.state = 'empty'
  }
  img.alt = `Photo of ${alert.name}`
  img.src = src
}

// Does the card's content (photo + details) fit inside its own content box?
// Measured from the children's boxes rather than scrollHeight, because a
// centred flex column overflows upwards too, which scrollHeight never counts.
const cardFits = (card: HTMLElement): boolean => {
  const box = card.getBoundingClientRect()
  const cs = getComputedStyle(card)
  const top = box.top + Number.parseFloat(cs.paddingTop)
  const bottom = box.bottom - Number.parseFloat(cs.paddingBottom)
  const left = box.left + Number.parseFloat(cs.paddingLeft)
  const right = box.right - Number.parseFloat(cs.paddingRight)
  for (const child of Array.from(card.children)) {
    const r = child.getBoundingClientRect()
    if (r.top < top - 1 || r.bottom > bottom + 1 || r.left < left - 1 || r.right > right + 1) {
      return false
    }
  }
  return true
}

// Scale the card (every size inside it is in --u = 1rem * --fit) down until it
// fits the space between the masthead and the hotline band. This only ever
// shrinks, so the band and the badge stay put at any window shape.
const fitCard = (): void => {
  const card = el('sa-card')
  if (!card || document.documentElement.dataset.state !== 'ready') return
  let fit = 1
  card.style.setProperty('--fit', '1')
  while (fit > MIN_FIT && !cardFits(card)) {
    fit = Math.max(MIN_FIT, Math.round((fit - FIT_STEP) * 100) / 100)
    card.style.setProperty('--fit', String(fit))
  }
}

const render = (alert: SilverAlert, today: Date): void => {
  text('sa-name', alert.name)
  text('sa-age', String(yearsBetween(alert.birthDate, isoToday(today))))
  text('sa-place', formatPlace(alert))
  text('sa-date', formatDate(alert.missingDate))
  text('sa-duration', formatDuration(daysSince(alert.missingDate, today)))
  const link = flyerUrl(alert.id)
  const flyer = el('sa-flyer') as HTMLAnchorElement | null
  if (flyer) flyer.href = link
  const qr = el('sa-qr')
  if (qr) qr.innerHTML = qrSvg(link)
  text('sa-flyer-url', displayUrl(link))
  renderPhoto(alert)
  document.documentElement.dataset.state = 'ready'
  fitCard()
  // Webfont metrics differ from the fallback's, so fit again once they land.
  if (document.fonts?.ready) document.fonts.ready.then(fitCard)
}

// The server's clock, from the response's Date header, so the freshness check
// doesn't depend on the player's clock (players without a battery-backed clock
// can be far off). Falls back to the local clock.
const serverNow = (res: Response): Date => {
  const header = Date.parse(res.headers.get('date') ?? '')
  return Number.isFinite(header) ? new Date(header) : new Date()
}

const loadAlert = async (): Promise<{ alert: SilverAlert; today: Date } | null> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    // Bypass the HTTP cache: the file changes hourly and freshness matters.
    const res = await fetch(DATASET_PATH, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const now = serverNow(res)
    const result = parseDataset(await res.json(), now)
    if (!result.ok) throw new Error(`dataset rejected: ${result.reason}`)
    if (result.dropped > 0) console.warn(`Silver Alert: dropped ${result.dropped} invalid alerts`)
    const alert = pickAlert(result.dataset.alerts, now)
    return alert ? { alert, today: now } : null
  } finally {
    clearTimeout(timer)
  }
}

// Nothing to show (offline, stale or bad data, or no active alerts): reveal the
// standing appeal. It is hidden while loading, so a normal load goes straight
// from the empty frame to the person.
const showAppeal = (): void => {
  document.documentElement.dataset.state = 'offline'
}

const init = (): void => {
  removeScreenlyBranding()
  // Report which player is showing this. A static app can only profile from the
  // user agent and referrer.
  trackPlayer(detectPlayer(), { app: 'silver-alert', sendPageView: true })
  // Re-fit when the window or the screen's orientation changes, at most once
  // per frame.
  let fitQueued = false
  window.addEventListener('resize', () => {
    if (fitQueued) return
    fitQueued = true
    window.requestAnimationFrame(() => {
      fitQueued = false
      fitCard()
    })
  })
  loadAlert()
    .then((picked) => {
      if (picked) render(picked.alert, picked.today)
      else showAppeal() // no active alerts
    })
    .catch((error) => {
      console.error('Silver Alert: load failed, showing the appeal —', error)
      showAppeal()
    })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
