import { beforeEach, describe, expect, it, vi } from 'vitest'

// Record every call made to supabase.rpc so tests can assert the exact
// argument object (PostgREST matches arguments by name — the p_ prefixes are
// the contract).
const { rpcCalls } = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; params: unknown }>,
}))

vi.mock('@/api/client', () => ({
  getSupabase: () => ({
    rpc: async (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { data: null, error: null }
    },
  }),
}))

import * as api from './rpc'

beforeEach(() => {
  rpcCalls.length = 0
})

describe('rpc parameter names', () => {
  it('create_room sends p_nickname', async () => {
    await api.createRoom('Fox')
    expect(rpcCalls).toEqual([{ name: 'create_room', params: { p_nickname: 'Fox' } }])
  })

  it('set_room_settings sends the p_ settings', async () => {
    await api.setRoomSettings('room-1', 5, 20, 10)
    expect(rpcCalls).toEqual([
      {
        name: 'set_room_settings',
        params: {
          p_room_id: 'room-1',
          p_hide_duration_min: 5,
          p_duration_min: 20,
          p_max_players: 10,
        },
      },
    ])
  })

  it('dev_add_dummy_players sends p_room_id and p_count', async () => {
    await api.devAddDummyPlayers('room-1', 3)
    expect(rpcCalls).toEqual([
      { name: 'dev_add_dummy_players', params: { p_room_id: 'room-1', p_count: 3 } },
    ])
  })

  it('join_room sends p_code and p_nickname', async () => {
    await api.joinRoom('ABC123', 'Fox')
    expect(rpcCalls).toEqual([
      { name: 'join_room', params: { p_code: 'ABC123', p_nickname: 'Fox' } },
    ])
  })

  it('leave_room sends p_room_id', async () => {
    await api.leaveRoom('room-1')
    expect(rpcCalls).toEqual([{ name: 'leave_room', params: { p_room_id: 'room-1' } }])
  })

  it('kick_player sends p_room_id and p_player_id', async () => {
    await api.kickPlayer('room-1', 'player-1')
    expect(rpcCalls).toEqual([
      { name: 'kick_player', params: { p_room_id: 'room-1', p_player_id: 'player-1' } },
    ])
  })

  it('set_ready sends p_room_id and p_ready', async () => {
    await api.setReady('room-1', true)
    expect(rpcCalls).toEqual([{ name: 'set_ready', params: { p_room_id: 'room-1', p_ready: true } }])
  })

  it('set_play_area sends p_room_id, p_lat, p_lng, p_radius_m', async () => {
    await api.setPlayArea('room-1', 31.5, 74.3, 250)
    expect(rpcCalls).toEqual([
      {
        name: 'set_play_area',
        params: { p_room_id: 'room-1', p_lat: 31.5, p_lng: 74.3, p_radius_m: 250 },
      },
    ])
  })

  it('start_round sends p_room_id and p_finder_id (null for random)', async () => {
    await api.startRound('room-1', null)
    expect(rpcCalls).toEqual([
      { name: 'start_round', params: { p_room_id: 'room-1', p_finder_id: null } },
    ])
  })

  it('server_now sends no arguments', async () => {
    await api.serverNow()
    expect(rpcCalls).toEqual([{ name: 'server_now', params: {} }])
  })

  it('advance_round sends p_room_id', async () => {
    await api.advanceRound('room-1')
    expect(rpcCalls).toEqual([{ name: 'advance_round', params: { p_room_id: 'room-1' } }])
  })

  it('pause_round sends p_room_id', async () => {
    await api.pauseRound('room-1')
    expect(rpcCalls).toEqual([{ name: 'pause_round', params: { p_room_id: 'room-1' } }])
  })

  it('resume_round sends p_room_id', async () => {
    await api.resumeRound('room-1')
    expect(rpcCalls).toEqual([{ name: 'resume_round', params: { p_room_id: 'room-1' } }])
  })

  it('end_round sends p_room_id', async () => {
    await api.endRound('room-1')
    expect(rpcCalls).toEqual([{ name: 'end_round', params: { p_room_id: 'room-1' } }])
  })

  it('rematch sends p_room_id', async () => {
    await api.rematch('room-1')
    expect(rpcCalls).toEqual([{ name: 'rematch', params: { p_room_id: 'room-1' } }])
  })
})
