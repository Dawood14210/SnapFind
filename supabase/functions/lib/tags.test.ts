/**
 * Vitest for lib/tags.ts (Phase 7).
 * Run from the repo root: npm test
 * (scripts/vitest.config.ts includes supabase/functions/lib tests.)
 */

import { describe, expect, it } from 'vitest'
import {
  accuracyOk,
  finderWon,
  lockoutActive,
  readingFresh,
  tagPoints,
  untaggedAtWindow,
  untaggedEndBonus,
  windowBonus,
  windowOpenMs,
} from './tags.ts'

const NOW = 1_700_000_000_000
const STARTED = NOW - 40 * 60_000 // round started 40 min ago

describe('readingFresh', () => {
  it('accepts a reading 14 s old and rejects one 16 s old', () => {
    expect(readingFresh(NOW - 14_000, NOW)).toBe(true)
    expect(readingFresh(NOW - 16_000, NOW)).toBe(false)
  })
})

describe('accuracyOk', () => {
  it('accepts accuracy at the 15 m cap and rejects worse or unknown', () => {
    expect(accuracyOk(15)).toBe(true)
    expect(accuracyOk(5)).toBe(true)
    expect(accuracyOk(16)).toBe(false)
    expect(accuracyOk(null)).toBe(false)
  })
})

describe('lockoutActive', () => {
  it('covers the 20 s window after a failed attempt', () => {
    expect(lockoutActive(NOW - 5_000, NOW)).toBe(true)
    expect(lockoutActive(NOW - 25_000, NOW)).toBe(false)
    expect(lockoutActive(null, NOW)).toBe(false)
  })
})

describe('tagPoints', () => {
  it('pays 60 base + 1 per full minute left', () => {
    expect(tagPoints(1800)).toBe(90) // 30 min left
    expect(tagPoints(90)).toBe(61) // 1 min left
    expect(tagPoints(0)).toBe(60)
  })
})

describe('window helpers', () => {
  it('windows open every SNAPSHOT_WINDOW_SEC', () => {
    expect(windowOpenMs(STARTED, 0, 1)).toBe(STARTED + 300_000)
    expect(windowOpenMs(STARTED, 0, 5)).toBe(STARTED + 1500_000)
  })

  it('untaggedAtWindow counts tagged-after-open as untagged at open', () => {
    const open = windowOpenMs(STARTED, 0, 1)
    expect(untaggedAtWindow(null, open)).toBe(true)
    expect(untaggedAtWindow(open + 1, open)).toBe(true) // tagged during window 1
    expect(untaggedAtWindow(open - 1, open)).toBe(false) // tagged before window 1
  })

  it('a tagged hider scores one window bonus per earlier window; a tagged-late hider none', () => {
    // tagged just after window 3 opened: windows 1, 2 and 3 counted (the tag
    // landed after window 3's opening, so the hider was untagged at that open).
    expect(windowBonus(STARTED + 3 * 300_000 + 1, STARTED, 0)).toBe(45)
    // tagged just before window 3 opened: windows 1 and 2 counted.
    expect(windowBonus(STARTED + 3 * 300_000 - 1, STARTED, 0)).toBe(30)
    // tagged at round start: no window counted.
    expect(windowBonus(STARTED + 1, STARTED, 0)).toBe(0)
    // never tagged: all five windows counted.
    expect(windowBonus(null, STARTED, 0)).toBe(75)
    // paused minutes shift the window opens.
    expect(windowBonus(null, STARTED, 600_000)).toBe(75)
    expect(untaggedEndBonus(null)).toBe(50)
    expect(untaggedEndBonus(STARTED)).toBe(0)
  })
})

describe('finderWon', () => {
  it('requires every hider tagged', () => {
    expect(finderWon(3, 3)).toBe(true)
    expect(finderWon(2, 3)).toBe(false)
    expect(finderWon(0, 0)).toBe(false)
  })
})
