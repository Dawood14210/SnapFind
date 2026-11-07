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
