import { describe, it, expect } from 'vitest'
import * as c from './constants'

describe('constants — game numbers', () => {
  it('round and hide durations', () => {
    expect(c.ROUND_DURATION_SEC).toBe(1800)
    expect(c.HIDE_DURATION_SEC).toBe(180)
    expect(c.HUNT_DURATION_SEC).toBe(1620)
    expect(c.ROUND_DURATION_MIN).toBe(30)
    expect(c.HIDE_DURATION_MIN).toBe(3)
  })

  it('snapshot windows', () => {
    expect(c.SNAPSHOT_WINDOW_SEC).toBe(300)
    expect(c.SNAPSHOT_WINDOW_COUNT).toBe(5)
    expect(c.SNAPSHOT_ON_TIME_TOLERANCE_SEC).toBe(45)
    expect(c.SNAPSHOT_LATE_TOLERANCE_SEC).toBe(120)
    expect(c.SNAPSHOT_ON_TIME_POINTS).toBe(10)
    expect(c.RESOLVE_WINDOW_DELAY_SEC).toBe(120)
  })

  it('room size and code alphabet', () => {
    expect(c.MIN_PLAYERS).toBe(4)
    expect(c.MAX_PLAYERS).toBe(25)
    expect(c.CODE_LENGTH).toBe(6)
    expect(c.CODE_ALPHABET).toHaveLength(23) // 26 letters minus O, I, L
    expect(c.CODE_ALPHABET).not.toContain('O')
    expect(c.CODE_ALPHABET).not.toContain('I')
    expect(c.CODE_ALPHABET).not.toContain('L')
  })

  it('play area bounds', () => {
    expect(c.PLAY_AREA_RADIUS_MIN_M).toBe(100)
    expect(c.PLAY_AREA_RADIUS_MAX_M).toBe(600)
  })

  it('tag rules and scoring', () => {
    expect(c.TAG_DISTANCE_M).toBe(15)
    expect(c.TAG_LOCATION_MAX_AGE_SEC).toBe(15)
    expect(c.TAG_ACCURACY_MAX_M).toBe(15)
    expect(c.TAG_LOCKOUT_SEC).toBe(20)
    expect(c.TAG_POINTS_BASE).toBe(60)
    expect(c.TAG_POINTS_PER_MIN).toBe(1)
    expect(c.UNTAGGED_END_BONUS).toBe(100)
    expect(c.WINDOW_UNTAGGED_BONUS).toBe(15)
    expect(c.UNTAGGED_END_POINTS).toBe(50)
    expect(c.FINALIZE_TAG_SILENCE_SEC).toBe(10)
  })

  it('task values', () => {
    expect(c.TASK_MIN_DURATION_SEC).toBe(240)
    expect(c.TASK_MAX_DURATION_SEC).toBe(480)
    expect(c.REACH_ZONE_POINTS).toBe(35)
    expect(c.REACH_ZONE_RADIUS_M).toBe(30)
    expect(c.REACH_ZONE_DURATION_SEC).toBe(20)
    expect(c.STAY_PUT_POINTS).toBe(10)
    expect(c.STAY_PUT_MOVE_TOLERANCE_M).toBe(10)
    expect(c.STAY_PUT_ACCURACY_IGNORE_M).toBe(25)
    expect(c.DISTANCE_TASK_POINTS).toBe(20)
    expect(c.DISTANCE_TASK_RADIUS_M).toBe(80)
    expect(c.PHOTO_TASK_POINTS).toBe(20)
    expect(c.MAX_SKIPS_PER_ROUND).toBe(2)
    expect(c.SKIP_POINTS_PENALTY).toBe(5)
    expect(c.PHOTO_PROMPTS.length).toBeGreaterThan(0)
  })

  it('ability costs, charges and cooldown', () => {
    expect(c.ABILITY_COST).toEqual({ pulse: 1, zone_scan: 2, clue_card: 1 })
    expect(c.ABILITY_CHARGE_INTERVAL_SEC).toBe(240)
    expect(c.ABILITY_EXTRA_CHARGE_AT_ROUND_SEC).toBe(1200)
    expect(c.ABILITY_COOLDOWN_SEC).toBe(30)
    expect(c.PULSE_RADIUS_M).toBe(80)
    expect(c.PULSE_MAX_OFFSET_M).toBe(50)
    expect(c.PULSE_DURATION_SEC).toBe(10)
    expect(c.PULSE_REPEAT_COOLDOWN_SEC).toBe(300)
    expect(c.ZONE_SCAN_MAX_RADIUS_M).toBe(100)
    expect(c.ZONE_SCAN_DURATION_SEC).toBe(20)
  })

  it('proximity bands and speed check', () => {
    expect(c.PROXIMITY_FAR_OVER_M).toBe(150)
    expect(c.PROXIMITY_NEAR_MIN_M).toBe(50)
    expect(c.PROXIMITY_NEAR_MAX_M).toBe(150)
    expect(c.PROXIMITY_CLOSE_MAX_M).toBe(50)
    expect(c.PROXIMITY_READING_MAX_AGE_SEC).toBe(30)
    expect(c.SPEED_LIMIT_M_PER_S).toBe(12)
  })

  it('out of bounds and last-known reveals', () => {
    expect(c.OUT_OF_BOUNDS_SEC).toBe(60)
    expect(c.OUT_OF_BOUNDS_REVEAL_RADIUS_M).toBe(30)
    expect(c.OUT_OF_BOUNDS_REVEAL_DURATION_SEC).toBe(10)
    expect(c.LAST_KNOWN_REVEAL_RADIUS_M).toBe(60)
    expect(c.LAST_KNOWN_REVEAL_DURATION_SEC).toBe(15)
    expect(c.LAST_KNOWN_SECOND_RADIUS_M).toBe(40)
    expect(c.LAST_KNOWN_SECOND_DURATION_SEC).toBe(30)
  })

  it('storage and misc', () => {
    expect(c.STORAGE_BUCKET).toBe('snapshots')
    expect(c.SNAPSHOT_URL_TTL_SEC).toBe(60)
    expect(c.NICKNAME_MAX_LEN).toBe(20)
  })
})
