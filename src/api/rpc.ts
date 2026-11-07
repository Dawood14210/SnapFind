/**
 * Typed wrappers for the contract's Postgres RPCs (called via supabase.rpc).
 * Permission checks happen on the server; the wrappers only shape the calls.
 *
 * IMPORTANT: PostgREST matches RPC arguments BY NAME against the SQL function
 * parameter names, which are p_-prefixed (p_room_id, p_nickname, ...). The
 * wrapper signatures stay plain; only the argument objects sent to the server
 * use the p_ names.
 */

import { getSupabase } from './client'
import { ApiError, rpcErrorToApi } from './errors'
import type {
  AdvanceRoundResult,
  CreateRoomResult,
  DevAddDummyPlayersResult,
  EndRoundResult,
  JoinRoomResult,
  KickPlayerResult,
  LeaveRoomResult,
  PauseRoundResult,
  RematchResult,
  ResumeRoundResult,
  SetPlayAreaResult,
  SetRoomSettingsResult,
  SetReadyResult,
  ServerNowResult,
  StartRoundResult,
} from './types'

async function rpc<T>(name: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, params ?? {})
  if (error) throw rpcErrorToApi(error)
  return data as T
}

// Room settings
export const setRoomSettings = (
  roomId: string,
  hideDurationMin: number,
  durationMin: number,
  maxPlayers: number,
) =>
  rpc<SetRoomSettingsResult>('set_room_settings', {
    p_room_id: roomId,
    p_hide_duration_min: hideDurationMin,
    p_duration_min: durationMin,
    p_max_players: maxPlayers,
  })

// Dev tool: dummy players for testing
export const devAddDummyPlayers = (roomId: string, count: number) =>
  rpc<DevAddDummyPlayersResult>('dev_add_dummy_players', { p_room_id: roomId, p_count: count })

// Phase 1 — lobby
export const createRoom = (nickname: string) =>
  rpc<CreateRoomResult>('create_room', { p_nickname: nickname })

export const joinRoom = (code: string, nickname: string) =>
  rpc<JoinRoomResult>('join_room', { p_code: code, p_nickname: nickname })

export const leaveRoom = (roomId: string) =>
  rpc<LeaveRoomResult>('leave_room', { p_room_id: roomId })

export const kickPlayer = (roomId: string, playerId: string) =>
  rpc<KickPlayerResult>('kick_player', { p_room_id: roomId, p_player_id: playerId })

export const setReady = (roomId: string, ready: boolean) =>
  rpc<SetReadyResult>('set_ready', { p_room_id: roomId, p_ready: ready })

// Phase 2 — play area, start, clock
export const setPlayArea = (roomId: string, centerLat: number, centerLng: number, radiusM: number) =>
  rpc<SetPlayAreaResult>('set_play_area', {
    p_room_id: roomId,
    p_lat: centerLat,
    p_lng: centerLng,
    p_radius_m: radiusM,
  })

export const startRound = (roomId: string, finderId: string | null) =>
  rpc<StartRoundResult>('start_round', { p_room_id: roomId, p_finder_id: finderId })

export const serverNow = () => rpc<ServerNowResult>('server_now')

export const advanceRound = (roomId: string) =>
  rpc<AdvanceRoundResult>('advance_round', { p_room_id: roomId })

export const pauseRound = (roomId: string) =>
  rpc<PauseRoundResult>('pause_round', { p_room_id: roomId })

export const resumeRound = (roomId: string) =>
  rpc<ResumeRoundResult>('resume_round', { p_room_id: roomId })

export const endRound = (roomId: string) =>
  rpc<EndRoundResult>('end_round', { p_room_id: roomId })

// Phase 7 — rematch
export const rematch = (roomId: string) =>
  rpc<RematchResult>('rematch', { p_room_id: roomId })
