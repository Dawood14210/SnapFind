import { describe, expect, it } from 'vitest'
import type { RoundState } from '@shared/roundState'
import { countdownSeconds, formatSeconds, phaseColor, phaseLabel } from './roundDisplay'

function state(partial: Partial<RoundState>): RoundState {
  return {
    phase: 'lobby',
    round_seconds: 0,
    seconds_left_in_round: 0,
    seconds_left_in_phase: 0,
    hunt_seconds: 0,
    window: 0,
    ...partial,
  }
}

describe('phaseLabel', () => {
  it('maps every phase', () => {
    expect(phaseLabel('lobby')).toBe('LOBBY')
    expect(phaseLabel('hiding')).toBe('HIDE')
    expect(phaseLabel('hunting')).toBe('HUNT')
    expect(phaseLabel('paused')).toBe('PAUSED')
    expect(phaseLabel('ended')).toBe('ENDED')
  })
})

describe('formatSeconds', () => {
  it('formats as M:SS', () => {
    expect(formatSeconds(0)).toBe('0:00')
    expect(formatSeconds(59.9)).toBe('0:59')
    expect(formatSeconds(60)).toBe('1:00')
    expect(formatSeconds(123.4)).toBe('2:03')
    expect(formatSeconds(1800)).toBe('30:00')
  })

  it('clamps negatives to zero', () => {
    expect(formatSeconds(-5)).toBe('0:00')
  })
})

describe('countdownSeconds', () => {
  it('is zero for lobby and ended', () => {
    expect(countdownSeconds(state({ phase: 'lobby' }))).toBe(0)
    expect(countdownSeconds(state({ phase: 'ended' }))).toBe(0)
  })

  it('uses the phase countdown while active', () => {
    expect(countdownSeconds(state({ phase: 'hiding', seconds_left_in_phase: 100.5 }))).toBe(100.5)
    expect(countdownSeconds(state({ phase: 'hunting', seconds_left_in_phase: 42.2 }))).toBe(42.2)
  })
})

describe('phaseColor', () => {
  it('maps phases to accent colours', () => {
    expect(phaseColor('hiding')).toBe('text-emerald-700')
    expect(phaseColor('hunting')).toBe('text-red-700')
    expect(phaseColor('paused')).toBe('text-amber-700')
    expect(phaseColor('lobby')).toBe('text-slate-700')
    expect(phaseColor('ended')).toBe('text-slate-700')
  })
})
