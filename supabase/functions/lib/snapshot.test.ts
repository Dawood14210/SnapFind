import { describe, expect, it } from 'vitest'
import {
  isValidSnapshotImagePath,
  roundSeconds,
  snapshotImagePath,
  windowPoints,
  windowState,
} from './snapshot'

const T0 = Date.parse('2026-11-07T18:00:00.000Z')

describe('windowState', () => {
  it('is not open before the window opens', () => {
    expect(windowState(299, 1)).toBe('not_open')
    expect(windowState(0, 1)).toBe('not_open')
  })

  it('is on time within 45 s of the opening', () => {
    expect(windowState(300, 1)).toBe('on_time')
    expect(windowState(345, 1)).toBe('on_time')
    expect(windowState(600, 2)).toBe('on_time')
  })

  it('is late within 2 min of the opening', () => {
    expect(windowState(346, 1)).toBe('late')
    expect(windowState(420, 1)).toBe('late')
    expect(windowState(700, 2)).toBe('late')
  })

  it('is closed after 2 min', () => {
    expect(windowState(421, 1)).toBe('closed')
    expect(windowState(3000, 1)).toBe('closed')
  })

  it('uses n * 300 s per window', () => {
    expect(windowState(299, 5)).toBe('not_open')
    expect(windowState(1500, 5)).toBe('on_time')
  })
})

describe('windowPoints', () => {
  it('awards 10 only for on time', () => {
    expect(windowPoints('on_time')).toBe(10)
    expect(windowPoints('late')).toBe(0)
    expect(windowPoints('closed')).toBe(0)
    expect(windowPoints('not_open')).toBe(0)
  })
})

describe('snapshotImagePath / isValidSnapshotImagePath', () => {
  const roomId = '11111111-1111-1111-1111-111111111111'
  const playerId = '22222222-2222-2222-2222-222222222222'

  it('builds {room_id}/{player_id}/{window_index}.jpg', () => {
    expect(snapshotImagePath(roomId, playerId, 2)).toBe(
      `${roomId}/${playerId}/2.jpg`,
    )
  })

  it('accepts exactly the own-folder path', () => {
    expect(isValidSnapshotImagePath(roomId, playerId, 2, `${roomId}/${playerId}/2.jpg`)).toBe(true)
  })

  it('rejects other folders, other windows and other files', () => {
    expect(isValidSnapshotImagePath(roomId, playerId, 2, `${roomId}/${playerId}/3.jpg`)).toBe(false)
    expect(isValidSnapshotImagePath(roomId, playerId, 2, `${roomId}/other-player/2.jpg`)).toBe(false)
    expect(isValidSnapshotImagePath(roomId, playerId, 2, `other-room/${playerId}/2.jpg`)).toBe(false)
    expect(isValidSnapshotImagePath(roomId, playerId, 2, `${roomId}/${playerId}/2.png`)).toBe(false)
  })
})

describe('roundSeconds', () => {
  it('subtracts the pause total from the round clock', () => {
    expect(roundSeconds(T0 + 600_000, new Date(T0).toISOString(), 0)).toBe(600)
    expect(roundSeconds(T0 + 600_000, new Date(T0).toISOString(), 120_000)).toBe(480)
  })

  it('is 0 before the round starts', () => {
    expect(roundSeconds(T0, null, 0)).toBe(0)
  })
})
