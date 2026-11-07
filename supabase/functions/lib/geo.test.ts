import { describe, expect, it } from 'vitest'
import {
  OUT_OF_BOUNDS_REVEAL_RADIUS,
  OUT_OF_BOUNDS_REVEAL_SEC,
  SPEED_LIMIT,
  haversineM,
  impliedSpeedMps,
  isOutsideCircle,
  proximityBand,
  secondsOutOfBounds,
  type Reading,
} from './geo'

const centre = { lat: 31.52, lng: 74.35 }

function reading(lat: number, lng: number, atMs: number): Reading {
  return { lat, lng, readingAtMs: atMs }
}

describe('haversineM', () => {
  it('is zero for the same point', () => {
    expect(haversineM(centre, centre)).toBe(0)
  })

  it('is about 111 km per degree of latitude', () => {
    const d = haversineM({ lat: 31.52, lng: 74.35 }, { lat: 32.52, lng: 74.35 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })
})

describe('proximityBand', () => {
  it('classifies by distance', () => {
    expect(proximityBand(0, 0)).toBe('close')
    expect(proximityBand(49.9, 0)).toBe('close')
    expect(proximityBand(50, 0)).toBe('near')
    expect(proximityBand(150, 0)).toBe('near')
    expect(proximityBand(150.1, 0)).toBe('far')
  })

  it('is unknown without a distance or with a stale reading', () => {
    expect(proximityBand(null, 0)).toBe('unknown')
    expect(proximityBand(80, 29_000)).toBe('near')
    expect(proximityBand(80, 30_001)).toBe('unknown')
  })
})

describe('isOutsideCircle', () => {
  it('compares against the play-area radius', () => {
    expect(isOutsideCircle(centre, centre, 250)).toBe(false)
    expect(isOutsideCircle({ lat: 31.53, lng: 74.35 }, centre, 250)).toBe(true)
  })
})

describe('secondsOutOfBounds', () => {
  const now = Date.parse('2026-11-07T18:10:00.000Z')
  const t = (s: number) => now - s * 1000

  it('is zero with no readings or all inside', () => {
    expect(secondsOutOfBounds([], centre, 250, now)).toBe(0)
    expect(secondsOutOfBounds([reading(centre.lat, centre.lng, t(5))], centre, 250, now)).toBe(0)
  })

  it('measures the current out-of-bounds streak from the newest reading', () => {
    const readings = [
      reading(centre.lat, centre.lng, t(5)), // inside — newest, breaks the streak
      reading(31.53, 74.35, t(10)), // out
      reading(31.53, 74.35, t(15)), // out
    ]
    expect(secondsOutOfBounds(readings, centre, 250, now)).toBe(0)

    const streak = [
      reading(31.53, 74.35, t(10)),
      reading(31.53, 74.35, t(15)),
      reading(31.53, 74.35, t(20)),
    ]
    expect(secondsOutOfBounds(streak, centre, 250, now)).toBe(20)
  })
})

describe('impliedSpeedMps', () => {
  it('computes the speed between consecutive readings', () => {
    const t0 = Date.parse('2026-11-07T18:00:00.000Z')
    const readings = [
      reading(31.52, 74.35, t0),
      reading(31.521, 74.35, t0 + 10_000), // ~111 m in 10 s
    ]
    expect(impliedSpeedMps(readings)).toBeGreaterThan(10)
    expect(impliedSpeedMps(readings)).toBeLessThan(12)
  })

  it('flags teleport-like speeds over the limit', () => {
    const t0 = Date.parse('2026-11-07T18:00:00.000Z')
    const readings = [
      reading(31.52, 74.35, t0),
      reading(32.0, 74.35, t0 + 1_000), // ~53 km in 1 s
    ]
    expect(impliedSpeedMps(readings)).toBeGreaterThan(SPEED_LIMIT)
  })

  it('skips pairs with a gap over 60 s (device offline)', () => {
    const t0 = Date.parse('2026-11-07T18:00:00.000Z')
    const readings = [
      reading(31.52, 74.35, t0),
      reading(32.0, 74.35, t0 + 120_000), // 2 min gap — skipped
    ]
    expect(impliedSpeedMps(readings)).toBe(0)
  })
})

describe('out-of-bounds reveal constants', () => {
  it('match the contract (30 m circle, 10 s)', () => {
    expect(OUT_OF_BOUNDS_REVEAL_RADIUS).toBe(30)
    expect(OUT_OF_BOUNDS_REVEAL_SEC).toBe(10)
  })
})
