import { describe, expect, test } from 'bun:test'
// The signage-app manifest is the source of truth for how the app store and
// players render/launch this app (docs/app-manifest.md in the app-store repo).
// These assertions mirror the manifest schema's invariants so a malformed edit
// fails CI here rather than being rejected by the store's index build.
import manifest from '../.well-known/signage-app.json'

const BASE_URL = 'https://silver-alert.srly.io/'

describe('signage-app manifest', () => {
  test('declares the required top-level fields', () => {
    expect(manifest.manifestVersion).toBe('1')
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.description.length).toBeGreaterThan(0)
    expect(manifest.launch.baseUrl).toBe(BASE_URL)
  })

  test('id is a store-legal slug', () => {
    expect(manifest.id).toBe('silver-alert')
    expect(manifest.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  test('every declared URL is on the app origin or its repo', () => {
    for (const url of [manifest.homepage, manifest.source, manifest.support]) {
      expect(new URL(url).protocol).toBe('https:')
    }
    expect(manifest.homepage).toBe(BASE_URL)
    expect(manifest.source).toContain('github.com/Screenly-Labs/silver-alert')
    expect(manifest.support).toContain('github.com/Screenly-Labs/silver-alert')
  })

  test('tags are unique strings', () => {
    expect(new Set(manifest.tags).size).toBe(manifest.tags.length)
  })

  test('is single-shot with no settings', () => {
    // Florida only, one person per load: nothing to configure and nothing to
    // pace (the player's reload brings the next).
    expect('settings' in manifest).toBe(false)
    expect('playback' in manifest).toBe(false)
    expect('template' in manifest.launch).toBe(false)
  })
})
