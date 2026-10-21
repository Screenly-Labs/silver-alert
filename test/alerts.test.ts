import { describe, expect, test } from 'bun:test'
import {
  MAX_DATA_AGE_MS,
  type SilverAlert,
  alertProblem,
  daysSince,
  displayUrl,
  flyerUrl,
  formatDate,
  formatDuration,
  formatPlace,
  isIsoDate,
  parseDataset,
  parseUsDate,
  photoPath,
  pickAlert,
  pickRandomIndex,
  tidyCase,
  yearsBetween
} from '../assets/static/js/alerts'

const NOW = new Date('2026-10-21T15:00:00Z')
const TODAY = '2026-10-21'

// Fictional.
const alert = (overrides: Partial<SilverAlert> = {}): SilverAlert => ({
  id: '100001',
  name: 'Jane Example',
  missingDate: '2026-10-19',
  birthDate: '1941-03-28',
  city: 'Springfield',
  state: 'FL',
  photo: 'jpg',
  ...overrides
})

const dataset = (overrides: Record<string, unknown> = {}) => ({
  schema: 1,
  generatedAt: '2026-10-21T14:17:00Z',
  source: 'https://mepic.fdle.state.fl.us/currentSilverAlerts.asp',
  alerts: [alert()],
  ...overrides
})

describe('dates', () => {
  test('isIsoDate accepts only real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-2-28')).toBe(false)
    expect(isIsoDate(20261021)).toBe(false)
  })

  test('parseUsDate', () => {
    expect(parseUsDate('3/8/1951')).toBe('1951-03-08')
    expect(parseUsDate(' 12/16/2016 ')).toBe('2016-12-16')
    expect(parseUsDate('2/30/2020')).toBeNull()
    expect(parseUsDate('3/8/51')).toBeNull()
  })

  test('yearsBetween counts whole years', () => {
    expect(yearsBetween('1941-03-28', '2026-03-27')).toBe(84)
    expect(yearsBetween('1941-03-28', '2026-03-28')).toBe(85)
  })

  test('daysSince and formatting', () => {
    expect(daysSince('2026-10-19', new Date(2026, 9, 21, 9))).toBe(2)
    expect(daysSince('2026-10-25', new Date(2026, 9, 21))).toBe(0)
    expect(formatDate('2026-10-19')).toBe('October 19, 2026')
    expect(formatDuration(0)).toBe('Missing since today')
    expect(formatDuration(1)).toBe('Missing 1 day')
    expect(formatDuration(90)).toBe('Missing 2 months')
    expect(formatDuration(3000)).toBe('Missing 8 years')
  })
})

describe('alertProblem', () => {
  test('a good alert has none', () => {
    expect(alertProblem(alert(), TODAY)).toBeNull()
    expect(alertProblem(alert({ photo: null }), TODAY)).toBeNull()
  })

  test('catches every malformed field', () => {
    expect(alertProblem(null, TODAY)).toBe('not an object')
    expect(alertProblem(alert({ id: '../1' }), TODAY)).toBe('bad id')
    expect(alertProblem(alert({ name: '<b>Jane</b>' }), TODAY)).toBe('bad name')
    expect(alertProblem(alert({ name: 'J'.repeat(81) }), TODAY)).toBe('bad name')
    expect(alertProblem(alert({ city: 'javascript:x' }), TODAY)).toBe('bad city')
    expect(alertProblem(alert({ state: 'Florida' }), TODAY)).toBe('bad state')
    expect(alertProblem({ ...alert(), photo: 'svg' }, TODAY)).toBe('bad photo')
    expect(alertProblem({ ...alert(), photo: undefined }, TODAY)).toBe('bad photo')
    expect(alertProblem(alert({ missingDate: '10/19/2026' }), TODAY)).toBe('bad missing date')
    expect(alertProblem(alert({ birthDate: '1941-02-30' }), TODAY)).toBe('bad birth date')
  })

  test('checks the dates make sense together', () => {
    expect(alertProblem(alert({ missingDate: '2026-10-23' }), TODAY)).toBe(
      'missing date in the future'
    )
    // One day ahead is allowed: FDLE is on Eastern time, the job on UTC.
    expect(alertProblem(alert({ missingDate: '2026-10-22' }), TODAY)).toBeNull()
    expect(alertProblem(alert({ missingDate: '2005-01-01' }), TODAY)).toBe('missing date too old')
    expect(alertProblem(alert({ birthDate: '2012-01-01' }), TODAY)).toBe('under 18 when missing')
    expect(alertProblem(alert({ birthDate: '1890-01-01' }), TODAY)).toBe('implausible age')
  })
})

describe('parseDataset', () => {
  test('accepts a fresh, well-formed dataset', () => {
    const result = parseDataset(dataset(), NOW)
    expect(result).toEqual({
      ok: true,
      dataset: { generatedAt: '2026-10-21T14:17:00Z', alerts: [alert()] },
      dropped: 0
    })
  })

  test('strips fields it does not know', () => {
    const result = parseDataset(dataset({ alerts: [{ ...alert(), html: '<b>x</b>' }] }), NOW)
    expect(result.ok && result.dataset.alerts[0]).toEqual(alert())
  })

  test('drops bad and duplicate alerts, keeping the rest', () => {
    const result = parseDataset(
      dataset({ alerts: [alert(), alert(), alert({ id: '2', name: '' }), alert({ id: '3' })] }),
      NOW
    )
    expect(result.ok && result.dataset.alerts.map((a) => a.id)).toEqual(['100001', '3'])
    expect(result.ok && result.dropped).toBe(2)
  })

  test('refuses stale data', () => {
    const old = new Date(NOW.getTime() - MAX_DATA_AGE_MS - 1000).toISOString()
    expect(parseDataset(dataset({ generatedAt: old }), NOW)).toEqual({ ok: false, reason: 'stale' })
  })

  test('refuses data from the future, beyond clock skew', () => {
    expect(parseDataset(dataset({ generatedAt: '2026-10-21T16:00:00Z' }), NOW)).toEqual({
      ok: false,
      reason: 'generatedAt in the future'
    })
    expect(parseDataset(dataset({ generatedAt: '2026-10-21T15:05:00Z' }), NOW).ok).toBe(true)
  })

  test('refuses the wrong shape', () => {
    expect(parseDataset(null, NOW).ok).toBe(false)
    expect(parseDataset([], NOW).ok).toBe(false)
    expect(parseDataset(dataset({ schema: 2 }), NOW).ok).toBe(false)
    expect(parseDataset(dataset({ generatedAt: 'yesterday' }), NOW).ok).toBe(false)
    expect(parseDataset(dataset({ alerts: {} }), NOW).ok).toBe(false)
    expect(parseDataset(dataset({ alerts: Array(301).fill(alert()) }), NOW).ok).toBe(false)
  })

  test('an empty list is valid', () => {
    expect(parseDataset(dataset({ alerts: [] }), NOW)).toEqual({
      ok: true,
      dataset: { generatedAt: '2026-10-21T14:17:00Z', alerts: [] },
      dropped: 0
    })
  })
})

describe('pickAlert', () => {
  const today = new Date(2026, 9, 21)

  test('nothing to pick', () => {
    expect(pickAlert([], today)).toBeNull()
  })

  test('prefers alerts from the last 30 days', () => {
    const old = alert({ id: '1', missingDate: '2020-01-01' })
    const recent = alert({ id: '2', missingDate: '2026-10-01' })
    for (const r of [0, 0.5, 0.99])
      expect(pickAlert([old, recent, old], today, () => r)).toBe(recent)
  })

  test('falls back to older alerts when none are recent', () => {
    const a = alert({ id: '1', missingDate: '2020-01-01' })
    const b = alert({ id: '2', missingDate: '2021-01-01' })
    expect(pickAlert([a, b], today, () => 0)).toBe(a)
    expect(pickAlert([a, b], today, () => 0.99)).toBe(b)
  })

  test('prefers a photo within the pool', () => {
    const faceless = alert({ id: '1', photo: null })
    const face = alert({ id: '2', photo: 'png' })
    expect(pickAlert([faceless, face], today, () => 0)).toBe(face)
    expect(pickAlert([faceless], today, () => 0)).toBe(faceless)
  })

  test('pickRandomIndex stays in range', () => {
    expect(pickRandomIndex(3, () => 1)).toBe(2)
    expect(pickRandomIndex(0)).toBe(0)
  })
})

describe('links and display', () => {
  test('the flyer and photo are rebuilt from the id', () => {
    expect(flyerUrl('526')).toBe('https://mepic.fdle.state.fl.us/Flyer.asp?ID=526')
    expect(photoPath(alert())).toBe('/data/photos/100001.jpg')
    expect(photoPath(alert({ photo: 'png' }))).toBe('/data/photos/100001.png')
    expect(photoPath(alert({ photo: null }))).toBeNull()
  })

  test('formatting helpers', () => {
    expect(formatPlace(alert())).toBe('Springfield, FL')
    expect(displayUrl(flyerUrl('526'))).toBe('mepic.fdle.state.fl.us/Flyer.asp?ID=526')
    expect(tidyCase('MARY  ANNE O’EXAMPLE')).toBe('Mary Anne O’Example')
    expect(tidyCase('DeShawn')).toBe('DeShawn')
  })
})
