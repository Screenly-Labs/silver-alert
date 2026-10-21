import { describe, expect, test } from 'bun:test'
import { sniffPhoto } from '../scraper/photo'

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0])

describe('sniffPhoto', () => {
  test('goes by the file signature', () => {
    expect(sniffPhoto(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpg')
    expect(sniffPhoto(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png')
  })

  test('refuses anything else', () => {
    expect(sniffPhoto(new TextEncoder().encode('<html>Not found</html>'))).toBeNull()
    expect(sniffPhoto(new TextEncoder().encode('<svg onload="x()"/>'))).toBeNull()
    expect(sniffPhoto(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull()
    expect(sniffPhoto(new Uint8Array())).toBeNull()
  })
})
