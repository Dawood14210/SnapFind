import { describe, expect, it } from 'vitest'
import { haversineM } from './geo'
import {
  isTaskComplete,
  pickTaskType,
  randomPointInCircle,
  taskDurationSec,
  taskParams,
  type Reading,
  type TaskType,
} from './tasks'

const T0 = Date.parse('2026-11-07T18:00:00.000Z')
const AREA = { lat: 31.5204, lng: 74.3587, radiusM: 200 }

/** A reading at `offsetM` metres north of the area centre. */
function reading(atMs: number, offsetM = 0, accuracyM = 5): Reading {
  return { lat: AREA.lat + offsetM / 111320, lng: AREA.lng, accuracyM, atMs }
}

function readingsEvery(seconds: number, count: number, from = T0): Reading[] {
  return Array.from({ length: count }, (_, i) => reading(from + i * seconds * 1000))
}

describe('taskDurationSec', () => {
  it('is between 4 and 8 minutes', () => {
    for (let i = 0; i < 100; i++) {
      const sec = taskDurationSec()
      expect(sec).toBeGreaterThanOrEqual(240)
      expect(sec).toBeLessThanOrEqual(480)
    }
  })
})

describe('pickTaskType', () => {
  const ALL: TaskType[] = ['reach_zone', 'stay_put', 'distance', 'photo']

  it('picks any type with no history', () => {
    for (let i = 0; i < 100; i++) {
      expect(ALL).toContain(pickTaskType([]))
    }
  })

  it('forces a movement task when the last two were not movement', () => {
    for (let i = 0; i < 100; i++) {
      const type = pickTaskType(['stay_put', 'photo'])
      expect(['reach_zone', 'distance']).toContain(type)
    }
  })

  it('never repeats a type three times in a row', () => {
    for (let i = 0; i < 100; i++) {
      expect(pickTaskType(['reach_zone', 'reach_zone'])).not.toBe('reach_zone')
    }
  })

  it('does not force movement with only one previous task', () => {
    for (let i = 0; i < 100; i++) {
      expect(ALL).toContain(pickTaskType(['stay_put']))
    }
  })
})

describe('randomPointInCircle', () => {
  it('stays inside the circle', () => {
    for (let i = 0; i < 100; i++) {
      const p = randomPointInCircle(AREA, 100)
      expect(haversineM(p, AREA)).toBeLessThanOrEqual(100)
    }
  })
})

describe('taskParams', () => {
  it('reach_zone: a 30 m circle inside the play area', () => {
    const params = taskParams('reach_zone', AREA)
    expect(params.radius_m).toBe(30)
    expect(haversineM({ lat: params.lat ?? 0, lng: params.lng ?? 0 }, AREA)).toBeLessThanOrEqual(
      AREA.radiusM - 30,
    )
  })

  it('distance: the play area centre with an 80 m radius', () => {
    expect(taskParams('distance', AREA)).toEqual({
      lat: AREA.lat,
      lng: AREA.lng,
      radius_m: 80,
    })
  })

  it('stay_put and photo have no params', () => {
    expect(taskParams('stay_put', AREA)).toEqual({})
    expect(taskParams('photo', AREA)).toEqual({})
  })
})

describe('isTaskComplete', () => {
  const now = T0 + 200_000

  describe('reach_zone', () => {
    const task = { type: 'reach_zone' as const, params: { lat: AREA.lat, lng: AREA.lng, radius_m: 30 } }

    it('is done when every reading in the last 20 s is inside the circle', () => {
      const readings = readingsEvery(3, 7, now - 18_000)
      expect(isTaskComplete(task, readings, now)).toBe(true)
    })

    it('is not done when a reading in the window is outside', () => {
      const readings = readingsEvery(3, 7, now - 18_000)
      readings[3] = reading(now - 9_000, 50)
      expect(isTaskComplete(task, readings, now)).toBe(false)
    })

    it('ignores readings older than 20 s', () => {
      const readings = [reading(now - 60_000, 500), ...readingsEvery(3, 7, now - 18_000)]
      expect(isTaskComplete(task, readings, now)).toBe(true)
    })

    it('is not done without readings in the window', () => {
      expect(isTaskComplete(task, [], now)).toBe(false)
      expect(isTaskComplete(task, [reading(now - 60_000)], now)).toBe(false)
    })
  })

  describe('stay_put', () => {
    const task = { type: 'stay_put' as const, params: {} }

    it('is done when readings span 3 min and never move 10 m', () => {
      const readings = readingsEvery(10, 19, now - 180_000) // 180 s span
      expect(isTaskComplete(task, readings, now)).toBe(true)
    })

    it('is not done when a reading is 15 m away', () => {
      const readings = readingsEvery(10, 19, now - 180_000)
      readings[10] = reading(now - 80_000, 15)
      expect(isTaskComplete(task, readings, now)).toBe(false)
    })

    it('is not done when the span is under 3 minutes', () => {
      const readings = readingsEvery(10, 18, now - 170_000) // 170 s span
      expect(isTaskComplete(task, readings, now)).toBe(false)
    })

    it('ignores readings with accuracy worse than 25 m', () => {
      const readings = readingsEvery(10, 19, now - 180_000)
      readings[9] = reading(now - 90_000, 50, 40) // wild position, bad accuracy
      expect(isTaskComplete(task, readings, now)).toBe(true)
    })

    it('is not done with fewer than two valid readings', () => {
      expect(isTaskComplete(task, [], now)).toBe(false)
      expect(isTaskComplete(task, [reading(now, 0, 40)], now)).toBe(false)
    })
  })

  describe('distance', () => {
    const task = { type: 'distance' as const, params: { lat: AREA.lat, lng: AREA.lng, radius_m: 80 } }

    it('is done when the latest reading is 100 m away', () => {
      const readings = [reading(now, 100), reading(now - 5_000, 20)]
      expect(isTaskComplete(task, readings, now)).toBe(true)
    })

    it('is not done when the latest reading is inside', () => {
      const readings = [reading(now, 50)]
      expect(isTaskComplete(task, readings, now)).toBe(false)
    })

    it('is not done without readings', () => {
      expect(isTaskComplete(task, [], now)).toBe(false)
    })
  })

  it('photo is never completed by readings (checked against snapshots)', () => {
    expect(isTaskComplete({ type: 'photo', params: {} }, readingsEvery(3, 7, now - 18_000), now)).toBe(false)
  })
})
