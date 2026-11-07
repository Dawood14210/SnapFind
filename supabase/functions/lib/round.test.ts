import { describe, expect, it } from 'vitest'
import { getRoundState, type RoomView } from './round'

const T0 = Date.parse('2026-11-07T18:00:00.000Z')
const at = (sec: number) => T0 + sec * 1000

function room(overrides: Partial<RoomView> = {}): RoomView {
  return {
    id: 'room-1',
    code: 'ABC123',
    host_id: 'user-1',
    status: 'lobby',
    center_lat: 31.5,
    center_lng: 74.3,
    radius_m: 300,
    duration_min: 30,
    hide_duration_min: 3,
    max_players: 25,
    started_at: null,
    paused_at: null,
    paused_total_ms: 0,
    finder_id: null,
    scores_finalized: false,
    ...overrides,
  }
}

describe('round bridge (Edge Function getRoundState)', () => {
  it('matches the contract for the default 3 + 30 minute room', () => {
    const hiding = room({ status: 'hiding', started_at: new Date(T0).toISOString() })
    const s = getRoundState(hiding, at(60))
    expect(s.phase).toBe('hiding')
    expect(s.round_seconds).toBe(60)
    expect(s.seconds_left_in_phase).toBe(120) // 3:00 hide time
    expect(s.seconds_left_in_round).toBe(1740) // 30:00 round
    expect(s.hunt_seconds).toBe(0)

    const hunting = getRoundState(hiding, at(200))
    expect(hunting.phase).toBe('hiding')
    expect(hunting.seconds_left_in_phase).toBe(0)

    // hunting state comes from the room status
    const huntingRoom = room({ status: 'hunting', started_at: new Date(T0).toISOString() })
    const h = getRoundState(huntingRoom, at(200))
    expect(h.hunt_seconds).toBe(20)
    expect(h.seconds_left_in_phase).toBe(1600)
  })

  it('honours custom per-room durations (hide 5, round 20)', () => {
    const r = room({
      status: 'hunting',
      started_at: new Date(T0).toISOString(),
      hide_duration_min: 5,
      duration_min: 20,
    })
    const s = getRoundState(r, at(400))
    expect(s.hunt_seconds).toBe(100)
    expect(s.seconds_left_in_round).toBe(800)

    const ended = getRoundState(r, at(1300))
    expect(ended.seconds_left_in_round).toBe(0)
  })

  it('freezes the clock while paused', () => {
    const r = room({
      status: 'paused',
      started_at: new Date(T0).toISOString(),
      paused_at: new Date(at(600)).toISOString(),
      paused_total_ms: 0,
    })
    expect(getRoundState(r, at(900)).round_seconds).toBe(600)
    expect(getRoundState(r, at(1500)).round_seconds).toBe(600)
  })
})
