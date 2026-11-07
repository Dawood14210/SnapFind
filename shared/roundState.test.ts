import { describe, it, expect } from 'vitest'
import { getRoundState, RoomView } from './roundState'
import { HIDE_DURATION_SEC, ROUND_DURATION_SEC } from './constants'

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
    started_at: null,
    paused_at: null,
    paused_total_ms: 0,
    finder_id: null,
    scores_finalized: false,
    ...overrides,
  }
}

describe('getRoundState', () => {
  it('lobby: zero state', () => {
    const s = getRoundState(room(), at(0))
    expect(s.phase).toBe('lobby')
    expect(s.round_seconds).toBe(0)
    expect(s.seconds_left_in_round).toBe(0)
    expect(s.seconds_left_in_phase).toBe(0)
    expect(s.hunt_seconds).toBe(0)
    expect(s.window).toBe(0)
  })

  it('hide phase starts at 0:00', () => {
    const s = getRoundState(
      room({ status: 'hiding', started_at: new Date(T0).toISOString() }),
      at(0),
    )
    expect(s.phase).toBe('hiding')
    expect(s.round_seconds).toBe(0)
    expect(s.seconds_left_in_phase).toBe(HIDE_DURATION_SEC)
    expect(s.seconds_left_in_round).toBe(ROUND_DURATION_SEC)
    expect(s.hunt_seconds).toBe(0)
    expect(s.window).toBe(0)
  })

  it('3:00 — hide phase boundary', () => {
    const s = getRoundState(
      room({ status: 'hiding', started_at: new Date(T0).toISOString() }),
      at(180),
    )
    expect(s.phase).toBe('hiding')
    expect(s.round_seconds).toBe(180)
    expect(s.seconds_left_in_phase).toBe(0)
    expect(s.hunt_seconds).toBe(0)
    expect(s.window).toBe(0)
  })

  it('just after 3:00, hunt starts', () => {
    const s = getRoundState(
      room({ status: 'hunting', started_at: new Date(T0).toISOString() }),
      at(181),
    )
    expect(s.phase).toBe('hunting')
    expect(s.hunt_seconds).toBe(1)
    expect(s.window).toBe(0)
  })

  it('5:00 — first snapshot window opens', () => {
    const s = getRoundState(
      room({ status: 'hunting', started_at: new Date(T0).toISOString() }),
      at(300),
    )
    expect(s.phase).toBe('hunting')
    expect(s.round_seconds).toBe(300)
    expect(s.hunt_seconds).toBe(120)
    expect(s.seconds_left_in_round).toBe(1500)
    expect(s.window).toBe(1)
  })

  it('15:00 — third snapshot window', () => {
    const s = getRoundState(
      room({ status: 'hunting', started_at: new Date(T0).toISOString() }),
      at(900),
    )
    expect(s.window).toBe(3)
    expect(s.hunt_seconds).toBe(720)
  })

  it('25:00 — last snapshot window', () => {
    const s = getRoundState(
      room({ status: 'hunting', started_at: new Date(T0).toISOString() }),
      at(1500),
    )
    expect(s.window).toBe(5)
    expect(s.hunt_seconds).toBe(1320)
    expect(s.seconds_left_in_round).toBe(300)
  })

  it('30:00 — round over (hunting until advance_round flips it)', () => {
    const s = getRoundState(
      room({ status: 'hunting', started_at: new Date(T0).toISOString() }),
      at(1800),
    )
    expect(s.phase).toBe('hunting')
    expect(s.round_seconds).toBe(1800)
    expect(s.hunt_seconds).toBe(1620)
    expect(s.seconds_left_in_round).toBe(0)
    expect(s.window).toBe(5)
  })

  it('ended: fixed full-round state', () => {
    const s = getRoundState(
      room({ status: 'ended', started_at: new Date(T0).toISOString() }),
      at(2000),
    )
    expect(s.phase).toBe('ended')
    expect(s.round_seconds).toBe(1800)
    expect(s.hunt_seconds).toBe(1620)
    expect(s.window).toBe(0)
  })

  it('paused at 10:00: clock frozen at paused_at', () => {
    const r = room({
      status: 'paused',
      started_at: new Date(T0).toISOString(),
      paused_at: new Date(at(600)).toISOString(),
      paused_total_ms: 0,
    })
    const s = getRoundState(r, at(900))
    expect(s.phase).toBe('paused')
    expect(s.round_seconds).toBe(600)
    expect(s.hunt_seconds).toBe(420)
    expect(s.window).toBe(2)
  })

  it('paused clock does not advance while paused', () => {
    const r = room({
      status: 'paused',
      started_at: new Date(T0).toISOString(),
      paused_at: new Date(at(600)).toISOString(),
      paused_total_ms: 0,
    })
    const later = getRoundState(r, at(1200))
    expect(later.round_seconds).toBe(600)
    expect(later.phase).toBe('paused')
  })

  it('resume: paused_total_ms accounts for the pause', () => {
    const r = room({
      status: 'hunting',
      started_at: new Date(T0).toISOString(),
      paused_at: null,
      paused_total_ms: 120000,
    })
    const s = getRoundState(r, at(720))
    expect(s.phase).toBe('hunting')
    expect(s.round_seconds).toBe(600)
    expect(s.hunt_seconds).toBe(420)
  })

  it('paused during the hide phase', () => {
    const r = room({
      status: 'paused',
      started_at: new Date(T0).toISOString(),
      paused_at: new Date(at(100)).toISOString(),
      paused_total_ms: 0,
    })
    const s = getRoundState(r, at(300))
    expect(s.phase).toBe('paused')
    expect(s.round_seconds).toBe(100)
    expect(s.seconds_left_in_phase).toBe(80)
    expect(s.hunt_seconds).toBe(0)
    expect(s.window).toBe(0)
  })
})
