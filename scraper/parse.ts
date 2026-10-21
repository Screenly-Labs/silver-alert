// Turns FDLE's "Current Silver Alerts" HTML page into validated alerts. Pure (no
// network), so test/parse.test.ts runs it against fixtures.
//
// Scraping HTML is fragile, so this is deliberately strict. It parses with
// parse5 (the WHATWG HTML parser, the same algorithm browsers use) rather than
// regexes, and it refuses the whole page, by throwing a LayoutError, unless it
// looks exactly like the page it was written against:
//
//   - the page heading reads "Current Silver Alerts";
//   - there is exactly one results table (`table.DataTable`);
//   - its header row has exactly the eight expected column titles, in order;
//   - "nobody is missing" is only accepted with FDLE's own "No … Silver Alerts
//     are active at this time." notice (which replaces the table), so a page
//     that broke in a new way can't pass as an empty list.
//
// Then each row is checked on its own (`parseRow`). A row that fails any check
// is rejected with a reason, never patched up: ids must be digits and agree
// between the photo and name links, dates must be real, the age FDLE prints
// must match the one computed from the dates, and so on. The caller decides
// how many rejections are tolerable (see `assertHealthy`).
//
// Only plain text leaves this module. Photo and flyer URLs are never copied
// from the page; they are rebuilt from the validated numeric ids.

import { type DefaultTreeAdapterMap, parse } from 'parse5'
import {
  MAX_ALERTS,
  type SilverAlert,
  alertProblem,
  isPlausibleCity,
  isPlausibleName,
  parseUsDate,
  squash,
  tidyCase,
  yearsBetween
} from '../assets/static/js/alerts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

/** The page is not the page this parser knows. Nothing from it may be used. */
export class LayoutError extends Error {
  override name = 'LayoutError'
}

export const EXPECTED_HEADING = 'Current Silver Alerts'

export const EXPECTED_HEADERS = [
  'Click Photo for Flyer',
  'Missing Since',
  'Name',
  'Race / Sex',
  'Birth Date Age Today',
  'Age Missing',
  'Category',
  'Missing From'
]

// The only elements FDLE puts inside each column's cell.
const ALLOWED_TAGS: string[][] = [['a', 'img'], [], ['a', 'u'], ['br'], ['br'], [], [], []]

const EMPTY_NOTICE = /\bNo\b[\w\s-]*\bSilver Alerts? (?:are|is) active at this time\b/i

/** A scraped alert plus the FDLE photo id it came with (null: no photo). */
export interface ScrapedAlert extends Omit<SilverAlert, 'photo'> {
  photoFin: string | null
}

export interface RejectedRow {
  row: number
  reason: string
}

export interface ParseResult {
  alerts: ScrapedAlert[]
  rejected: RejectedRow[]
  /** Data rows seen, valid or not. */
  rows: number
}

const isElement = (node: Node): node is Element => 'tagName' in node

const children = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : [])

const attr = (el: Element, name: string): string | null =>
  el.attrs.find((a) => a.name === name)?.value ?? null

const hasClass = (el: Element, cls: string): boolean =>
  (attr(el, 'class') ?? '').split(/\s+/).includes(cls)

const walk = (node: Node, visit: (el: Element) => void): void => {
  for (const child of children(node)) {
    if (isElement(child)) visit(child)
    walk(child, visit)
  }
}

const findAll = (root: Node, test: (el: Element) => boolean): Element[] => {
  const out: Element[] = []
  walk(root, (el) => {
    if (test(el)) out.push(el)
  })
  return out
}

/** Text content, with `<br>` as a line break and scripts/styles skipped. */
const textOf = (node: Node): string => {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value
  if (isElement(node)) {
    if (node.tagName === 'br') return '\n'
    if (node.tagName === 'script' || node.tagName === 'style') return ''
  }
  return children(node).map(textOf).join('')
}

/** The direct `td`/`th` cells of a row. */
const cellsOf = (row: Element): Element[] =>
  row.childNodes.filter(
    (n): n is Element => isElement(n) && (n.tagName === 'td' || n.tagName === 'th')
  )

/** The direct rows of a table, looking through the implied `tbody`. */
const rowsOf = (table: Element): Element[] =>
  table.childNodes
    .filter(isElement)
    .flatMap((n) => (n.tagName === 'tr' ? [n] : n.tagName === 'tbody' ? n.childNodes : []))
    .filter((n): n is Element => isElement(n) && n.tagName === 'tr')

/** The flyer ids a cell links to (`OpenWindow('Flyer.asp?ID=…')`). */
const flyerIds = (cell: Element): string[] =>
  findAll(cell, (el) => el.tagName === 'a').flatMap((a) => {
    const m = /^OpenWindow\('Flyer\.asp\?ID=(\d{1,9})'/.exec((attr(a, 'onclick') ?? '').trim())
    return m ? [m[1]] : []
  })

/** Text after a `Label:` inside a cell (`Race: White` / `DOB: 3/28/1937`). */
const labelled = (text: string, label: string): string | null => {
  const m = new RegExp(`(?:^|\\n)\\s*${label}:\\s*([^\\n]*)`).exec(text)
  return m ? squash(m[1]) : null
}

/** "Young Jr, Robert" → "Robert Young Jr", or null if it isn't "Last, First". */
export const displayName = (raw: string): string | null => {
  const parts = squash(raw).split(',')
  if (parts.length !== 2) return null
  const [last, first] = parts.map(squash)
  if (!last || !first) return null
  const name = tidyCase(`${first} ${last}`)
  return isPlausibleName(name) ? name : null
}

/** "Cutler Bay,FL" → { city, state }, or null. */
export const parsePlace = (raw: string): { city: string; state: string } | null => {
  const m = /^(.+?)\s*,\s*([A-Za-z]{2})$/.exec(squash(raw))
  if (!m) return null
  const city = tidyCase(m[1])
  return isPlausibleCity(city) ? { city, state: m[2].toUpperCase() } : null
}

/**
 * One data row → an alert, or the reason it was rejected. `today` is
 * `YYYY-MM-DD`.
 */
export const parseRow = (row: Element, today: string): ScrapedAlert | string => {
  const cells = cellsOf(row)
  if (cells.length !== EXPECTED_HEADERS.length) return `expected 8 cells, got ${cells.length}`
  const [photoCell, sinceCell, nameCell, , dobCell, ageCell, , fromCell] = cells
  // Each cell may only hold the markup FDLE uses there. Anything else (a
  // script, an extra link, an image in the name) means the row isn't what it
  // seems, so it is rejected rather than reduced to its text.
  for (const [i, cell] of cells.entries()) {
    const stray = findAll(cell, (el) => !ALLOWED_TAGS[i].includes(el.tagName))
    if (stray.length > 0) return `unexpected <${stray[0].tagName}> in column ${i + 1}`
  }

  // The same flyer id must be the only link target in both the photo and the
  // name cell; anything else means the columns no longer line up.
  const ids = new Set([...flyerIds(photoCell), ...flyerIds(nameCell)])
  if (ids.size !== 1) return `expected one flyer id, got ${ids.size}`
  const [id] = ids
  if (flyerIds(nameCell).length === 0) return 'name is not linked to the flyer'

  const imgs = findAll(photoCell, (el) => el.tagName === 'img')
  if (imgs.length > 1) return 'more than one photo'
  let photoFin: string | null = null
  if (imgs.length === 1) {
    const m = /^GetImage\.asp\?FIN=(\d{1,9})$/.exec((attr(imgs[0], 'src') ?? '').trim())
    if (!m) return 'unexpected photo source'
    photoFin = m[1]
  }

  const name = displayName(textOf(nameCell))
  if (!name) return 'name is not "Last, First"'

  const missingDate = parseUsDate(squash(textOf(sinceCell)))
  if (!missingDate) return 'bad missing date'

  const dobText = textOf(dobCell)
  const dob = labelled(dobText, 'DOB')
  const birthDate = dob ? parseUsDate(dob) : null
  if (!birthDate) return 'bad date of birth'
  // FDLE's own "Age:" line must agree with the date of birth.
  const ageToday = /^(\d{1,3}) yrs\b/.exec(labelled(dobText, 'Age') ?? '')
  if (!ageToday) return 'bad age today'
  if (Math.abs(Number(ageToday[1]) - yearsBetween(birthDate, today)) > 1) {
    return 'age today does not match date of birth'
  }
  // And so must "Age Missing", against the missing date.
  const ageMissing = /^(\d{1,3}) yrs$/.exec(squash(textOf(ageCell)))
  if (!ageMissing) return 'bad age missing'
  if (Math.abs(Number(ageMissing[1]) - yearsBetween(birthDate, missingDate)) > 1) {
    return 'age missing does not match dates'
  }

  const place = parsePlace(textOf(fromCell))
  if (!place) return 'bad place'

  const alert = { id, name, missingDate, birthDate, ...place, photoFin }
  const problem = alertProblem({ ...alert, photo: null }, today)
  return problem ?? alert
}

/**
 * Parses the whole page. Throws LayoutError if the page isn't the one this
 * parser knows; otherwise returns the valid alerts and the rejected rows.
 */
export const parseSilverAlerts = (html: string, today: string): ParseResult => {
  const doc = parse(html)

  const headings = findAll(doc, (el) => attr(el, 'id') === 'SecondaryPageRightColumnHeading')
  if (headings.length !== 1 || squash(textOf(headings[0])) !== EXPECTED_HEADING) {
    throw new LayoutError(`page heading is not "${EXPECTED_HEADING}"`)
  }

  const tables = findAll(doc, (el) => el.tagName === 'table' && hasClass(el, 'DataTable'))
  // With no alerts FDLE drops the table and prints a notice in its place.
  // Only that notice makes a missing table mean "nobody".
  if (tables.length === 0 && EMPTY_NOTICE.test(squash(textOf(doc)))) {
    return { alerts: [], rejected: [], rows: 0 }
  }
  if (tables.length !== 1) throw new LayoutError(`expected 1 results table, found ${tables.length}`)
  const [header, ...rows] = rowsOf(tables[0])
  if (!header || !hasClass(header, 'TableHeaderRow')) {
    throw new LayoutError('results table has no header row')
  }
  const titles = cellsOf(header).map((c) => squash(textOf(c)))
  if (JSON.stringify(titles) !== JSON.stringify(EXPECTED_HEADERS)) {
    throw new LayoutError(`unexpected columns: ${JSON.stringify(titles)}`)
  }

  // Spacer rows (no data cells) are layout, not alerts.
  const dataRows = rows.filter((r) => cellsOf(r).some((c) => hasClass(c, 'TableDataCell')))
  if (dataRows.length > MAX_ALERTS) {
    throw new LayoutError(`${dataRows.length} rows is more than the ${MAX_ALERTS} allowed`)
  }
  if (dataRows.length === 0 && !EMPTY_NOTICE.test(squash(textOf(doc)))) {
    throw new LayoutError('no alert rows and no "no active alerts" notice')
  }

  const alerts: ScrapedAlert[] = []
  const rejected: RejectedRow[] = []
  const seen = new Set<string>()
  dataRows.forEach((row, i) => {
    const result = parseRow(row, today)
    if (typeof result === 'string') rejected.push({ row: i + 1, reason: result })
    else if (seen.has(result.id)) rejected.push({ row: i + 1, reason: `duplicate id ${result.id}` })
    else {
      seen.add(result.id)
      alerts.push(result)
    }
  })
  return { alerts, rejected, rows: dataRows.length }
}

/** Above this share of rejected rows, assume the parser is wrong, not the rows. */
export const MAX_REJECTED_SHARE = 0.25

/**
 * Throws LayoutError when too many rows failed: one odd record can be skipped,
 * but a quarter of them failing means the page changed under us.
 */
export const assertHealthy = (result: ParseResult): void => {
  if (result.rows > 0 && result.alerts.length === 0) {
    throw new LayoutError(`all ${result.rows} rows were rejected`)
  }
  if (result.rejected.length > result.rows * MAX_REJECTED_SHARE) {
    throw new LayoutError(`${result.rejected.length} of ${result.rows} rows were rejected`)
  }
}
