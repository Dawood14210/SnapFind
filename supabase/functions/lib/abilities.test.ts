import { describe, expect, it } from 'vitest'
import { haversineM } from './geo'
import {
  clueLabel,
  isValidZoneScanRadius,
  pulseCentre,
  zoneScanCount,
  type HiderReading,
} from './abilities'

const T0 = Date.parse('2026-11-07T18:00:00.000Z')
const HIDERS_CENTRE = { lat: 31.5204, lng: 74.3587 }

/** A hider with a reading `offsetM` metres north of the centre. */
function hider(playerId: string, offsetM = 0): HiderReading {
  return {
    playerId,
    reading: { lat: HIDERS_CENTRE.lat + offsetM / 111320, lng: HIDERS_CENTRE.lng, atMs: T0 },
  }
}

describe('pulseCentre', () => {
  it('stays within the max offset of the hider', () => {
    for (let i = 0; i < 100; i++) {
      const c = pulseCentre(HIDERS_CENTRE, 50)
      expect(haversineM(c, HIDERS_CENTRE)).toBeLessThanOrEqual(50)
    }
  })

  it("never returns the hider's exact position", () => {
    const c = pulseCentre(HIDERS_CENTRE, 50)
    expect(haversineM(c, HIDERS_CENTRE)).toBeGreaterThan(0)
  })
})

describe('zoneScanCount', () => {
  const centre = { lat: 31.5204, lng: 74.3587 }

  it('counts only hiders whose reading is inside the circle', () => {
    const hiders = [hider('a', 0), hider('b', 50), hider('c', 200)]
    expect(zoneScanCount(hiders, centre, 80)).toBe(2)
  })

  it('ignores hiders without a reading', () => {
    const hiders: HiderReading[] = [{ playerId: 'a', reading: null }, hider('b', 10)]
    expect(zoneScanCount(hiders, centre, 80)).toBe(1)
  })

  it('counts zero when the circle is empty', () => {
    expect(zoneScanCount([hider('a', 500)], centre, 80)).toBe(0)
    expect(zoneScanCount([], centre, 80)).toBe(0)
  })
})

describe('isValidZoneScanRadius', () => {
  it('accepts 1..100 and rejects everything else', () => {
    expect(isValidZoneScanRadius(1)).toBe(true)
    expect(isValidZoneScanRadius(100)).toBe(true)
    expect(isValidZoneScanRadius(0)).toBe(false)
    expect(isValidZoneScanRadius(-5)).toBe(false)
    expect(isValidZoneScanRadius(101)).toBe(false)
  })
})

describe('clueLabel', () => {
  it('names the task type, never a hider', () => {
    expect(clueLabel('reach_zone')).toBe('clue: reach_zone')
    expect(clueLabel('photo')).toBe('clue: photo')
  })
})
