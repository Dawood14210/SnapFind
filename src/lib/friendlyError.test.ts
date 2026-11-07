import { describe, it, expect } from 'vitest'
import { ApiError } from '@/api'
import { friendlyError } from './friendlyError'

describe('friendlyError', () => {
  it('maps known contract codes to friendly messages', () => {
    expect(friendlyError(new ApiError('ROOM_FULL', 'ROOM_FULL', 400))).toBe(
      'Room is full (25 players max).',
    )
    expect(friendlyError(new ApiError('ROOM_NOT_FOUND', 'ROOM_NOT_FOUND', 400))).toBe(
      'No room with that code.',
    )
    expect(friendlyError(new ApiError('NICKNAME_DUPLICATE', 'NICKNAME_DUPLICATE', 400))).toBe(
      'That nickname is taken in this room.',
    )
    expect(friendlyError(new ApiError('ROOM_NOT_LOBBY', 'ROOM_NOT_LOBBY', 400))).toBe(
      'This room already started — ask for a new code.',
    )
  })

  it('maps the phase 2 codes', () => {
    expect(friendlyError(new ApiError('NO_PLAY_AREA', 'NO_PLAY_AREA', 422))).toBe(
      'Set a play area before starting the round.',
    )
    expect(friendlyError(new ApiError('NOT_ALL_READY', 'NOT_ALL_READY', 422))).toBe(
      'Waiting for all players to be ready.',
    )
    expect(friendlyError(new ApiError('MIN_PLAYERS', 'MIN_PLAYERS', 422))).toBe(
      'Need at least 4 players to start.',
    )
    expect(friendlyError(new ApiError('NOT_HOST', 'NOT_HOST', 403))).toBe(
      'Only the host can do that.',
    )
    expect(friendlyError(new ApiError('NOT_ACTIVE', 'NOT_ACTIVE', 422))).toBe(
      'The round is not active.',
    )
    expect(friendlyError(new ApiError('NOT_PAUSED', 'NOT_PAUSED', 422))).toBe(
      'The round is not paused.',
    )
    expect(friendlyError(new ApiError('INVALID_RADIUS', 'INVALID_RADIUS', 400))).toBe(
      'Play area radius must be 100–600 m.',
    )
    expect(friendlyError(new ApiError('INVALID_COORDS', 'INVALID_COORDS', 400))).toBe(
      'Invalid map coordinates.',
    )
  })

  it('falls back to the raw message for unknown codes', () => {
    expect(friendlyError(new ApiError('SOMETHING_NEW', 'SOMETHING_NEW', 400))).toBe(
      'SOMETHING_NEW',
    )
  })

  it('handles non-ApiError errors', () => {
    expect(friendlyError(new Error('network down'))).toBe('network down')
    expect(friendlyError('boom')).toBe('Something went wrong.')
  })
})
