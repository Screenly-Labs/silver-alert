import { describe, expect, test } from 'bun:test'
import {
  LayoutError,
  assertHealthy,
  displayName,
  parsePlace,
  parseSilverAlerts
} from '../scraper/parse'
import { HEADER, NO_ALERTS, page, row, table } from './fixture'

const TODAY = '2026-10-21'

const parse = (html: string) => parseSilverAlerts(html, TODAY)
const one = (overrides: Parameters<typeof row>[0] = {}) => parse(page(table(row(overrides))))

describe('a well-formed page', () => {
  test('yields the alert, with names, dates and place normalized', () => {
    const result = one()
    expect(result.rejected).toEqual([])
    expect(result.alerts).toEqual([
      {
        id: '100001',
        name: 'Jane Example',
        missingDate: '2026-10-19',
        birthDate: '1941-03-28',
        city: 'Springfield',
        state: 'FL',
        photoFin: '900001'
      }
    ])
  })

  test('keeps every row, in page order', () => {
    const html = page(
      table(
        row() +
          row({
            id: '100002',
            fin: '900002',
            name: 'Sample, John',
            since: '1/2/2020',
            ageMissing: '78 yrs'
          })
      )
    )
    expect(parse(html).alerts.map((a) => a.id)).toEqual(['100001', '100002'])
  })

  test('a row without a photo is kept, with no photo id', () => {
    expect(one({ fin: null }).alerts[0].photoFin).toBeNull()
  })

  test('no-break spaces and suffixes in names', () => {
    expect(one({ name: 'Example Jr, Jane&nbsp;Ann' }).alerts[0].name).toBe('Jane Ann Example Jr')
  })

  test('decodes entities instead of passing them through', () => {
    expect(one({ name: 'O&#39;Example, Jane' }).alerts[0].name).toBe("Jane O'Example")
  })

  test('"Age:" without months is fine', () => {
    expect(one({ ageToday: '85 yrs ' }).alerts).toHaveLength(1)
  })
})

describe('no active alerts', () => {
  test("FDLE's notice in place of the table means an empty list", () => {
    expect(parse(page(NO_ALERTS))).toEqual({ alerts: [], rejected: [], rows: 0 })
  })

  test('an empty table with the notice is also empty', () => {
    expect(parse(page(table('') + NO_ALERTS)).alerts).toEqual([])
  })

  test('an empty table without the notice is a layout change', () => {
    expect(() => parse(page(table('')))).toThrow(LayoutError)
  })

  test('no table and no notice is a layout change', () => {
    expect(() => parse(page('<p>Service unavailable</p>'))).toThrow(LayoutError)
  })
})

describe('refuses pages it does not recognise', () => {
  test('a different heading (wrong page, error page)', () => {
    expect(() => parse(page(table(row()), { heading: 'Current AMBER Alerts' }))).toThrow(
      LayoutError
    )
    expect(() => parse('<html><body>Runtime Error</body></html>')).toThrow(LayoutError)
  })

  test('not HTML at all', () => {
    expect(() => parse('')).toThrow(LayoutError)
    expect(() => parse('{"alerts": []}')).toThrow(LayoutError)
  })

  test('two results tables', () => {
    expect(() => parse(page(table(row()) + table(row())))).toThrow(LayoutError)
  })

  test('renamed, reordered, added or removed columns', () => {
    const variants = [
      HEADER.replace('Missing Since', 'Date Missing'),
      HEADER.replace('Category', '@')
        .replace('Age Missing', 'Category')
        .replace('@', 'Age Missing'),
      HEADER.replace('</tr>', '<td>County</td></tr>'),
      HEADER.replace(/<td>\s*Category\s*<\/td>/, '')
    ]
    for (const header of variants) {
      expect(() => parse(page(table(row(), header)))).toThrow(LayoutError)
    }
  })

  test('a table with no header row', () => {
    expect(() => parse(page(table(row(), '')))).toThrow(LayoutError)
  })

  test('an absurd number of rows', () => {
    expect(() => parse(page(table(row().repeat(301))))).toThrow(LayoutError)
  })
})

describe('rejects bad rows, with a reason', () => {
  const reason = (overrides: Parameters<typeof row>[0]) => {
    const result = one(overrides)
    expect(result.alerts).toEqual([])
    expect(result.rejected).toHaveLength(1)
    return result.rejected[0].reason
  }

  test('a missing or extra cell', () => {
    const html = page(
      table(row().replace(/<td class="TableDataCell">\s*Missing Person\s*<\/td>/, ''))
    )
    expect(parse(html).rejected[0].reason).toBe('expected 8 cells, got 7')
  })

  test('photo and name linking to different flyers', () => {
    const html = page(table(row().replace("Flyer.asp?ID=100001'", "Flyer.asp?ID=100009'")))
    expect(parse(html).rejected[0].reason).toBe('expected one flyer id, got 2')
  })

  test('a non-numeric flyer id', () => {
    expect(reason({ id: '1000x1' })).toBe('expected one flyer id, got 0')
  })

  test('a photo from anywhere but GetImage.asp', () => {
    const html = page(table(row().replace('GetImage.asp?FIN=900001', 'https://example.com/x.jpg')))
    expect(parse(html).rejected[0].reason).toBe('unexpected photo source')
  })

  test('markup or script smuggled into a cell', () => {
    expect(reason({ name: 'Example, <script>alert(1)</script>Jane' })).toBe(
      'unexpected <script> in column 3'
    )
    expect(reason({ name: 'Example, Jane<img src=x onerror=alert(1)>' })).toBe(
      'unexpected <img> in column 3'
    )
    expect(reason({ from: '<a href="https://example.com">Springfield,FL</a>' })).toBe(
      'unexpected <a> in column 8'
    )
  })

  test('a name that is not "Last, First"', () => {
    expect(reason({ name: 'Jane Example' })).toBe('name is not "Last, First"')
    expect(reason({ name: 'Example, Jane, Ann' })).toBe('name is not "Last, First"')
    expect(reason({ name: 'Example2, Jane' })).toBe('name is not "Last, First"')
  })

  test('impossible or malformed dates', () => {
    expect(reason({ since: '2/30/2026' })).toBe('bad missing date')
    expect(reason({ since: '2026-10-19' })).toBe('bad missing date')
    expect(reason({ dob: '13/1/1941' })).toBe('bad date of birth')
  })

  test("FDLE's ages disagreeing with the dates (columns shifted)", () => {
    expect(reason({ ageToday: '60 yrs' })).toBe('age today does not match date of birth')
    expect(reason({ ageMissing: '60 yrs' })).toBe('age missing does not match dates')
    expect(reason({ ageMissing: 'Missing Person' })).toBe('bad age missing')
  })

  test('a child (not a Silver Alert)', () => {
    expect(reason({ dob: '3/28/2015', ageToday: '11 yrs 6 months', ageMissing: '11 yrs' })).toBe(
      'under 18 when missing'
    )
  })

  test('a missing date in the future or before the plan existed', () => {
    expect(reason({ since: '12/1/2026', ageMissing: '85 yrs' })).toBe('missing date in the future')
    expect(reason({ since: '1/5/2001', ageMissing: '59 yrs' })).toBe('missing date too old')
  })

  test('a place that is not "City,ST"', () => {
    expect(reason({ from: 'Springfield' })).toBe('bad place')
    expect(reason({ from: 'Springfield,Florida' })).toBe('bad place')
  })

  test('a duplicate flyer id', () => {
    const result = parse(page(table(row() + row())))
    expect(result.alerts).toHaveLength(1)
    expect(result.rejected).toEqual([{ row: 2, reason: 'duplicate id 100001' }])
  })
})

describe('assertHealthy', () => {
  const many = (bad: number, good: number) =>
    parse(
      page(
        table(
          Array.from({ length: good }, (_, i) =>
            row({ id: String(200000 + i), fin: String(800000 + i) })
          ).join('') +
            Array.from({ length: bad }, (_, i) => row({ id: String(300000 + i), since: 'x' })).join(
              ''
            )
        )
      )
    )

  test('tolerates a few bad rows', () => {
    expect(() => assertHealthy(many(1, 9))).not.toThrow()
  })

  test('fails when more than a quarter are bad', () => {
    expect(() => assertHealthy(many(3, 7))).toThrow(LayoutError)
  })

  test('fails when every row is bad', () => {
    expect(() => assertHealthy(many(1, 0))).toThrow(LayoutError)
  })

  test('an empty list is healthy', () => {
    expect(() => assertHealthy(parse(page(NO_ALERTS)))).not.toThrow()
  })
})

describe('field helpers', () => {
  test('displayName', () => {
    expect(displayName('EXAMPLE, JANE')).toBe('Jane Example')
    expect(displayName('McExample, Jane')).toBe('Jane McExample')
    expect(displayName(',Jane')).toBeNull()
  })

  test('parsePlace', () => {
    expect(parsePlace('Cape Example,FL')).toEqual({ city: 'Cape Example', state: 'FL' })
    expect(parsePlace(' Port St. Example , fl ')).toEqual({ city: 'Port St. Example', state: 'FL' })
    expect(parsePlace('Nowhere')).toBeNull()
  })
})
