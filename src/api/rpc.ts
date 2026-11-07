/**
 * Typed wrappers for the contract's Postgres RPCs (called via supabase.rpc).
 * Permission checks happen on the server; the wrappers only shape the calls.
 */

import { supabase } from './client'
import { ApiError, rpcErrorToApi } from './errors'
import type {
  AdvanceRoundResult,
  CreateRoomResult,
  EndRoundResult,
  JoinRoomResult,
  KickPlayerResult,
  LeaveRoomResult,
  PauseRoundResult,
  RematchResult,
  ResumeRoundResult,
  SetPlayAreaResult,
  SetReadyResult,
  ServerNowResult,
  StartRoundResult,
} from './types'

async function rpc<T>(name: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params ?? {})
  if (error) throw rpcErrorToApi(error)
  return data as T
}

// Phase 1 — lobby
export const createRoom = (nickname: string) =>
  rpc<CreateRoomResult>('create_room', { nickname })

export const joinRoom = (code: string, nickname: string) =>
  rpc<JoinRoomResult>('join_room', { code, nickname })

export const leaveRoom = (roomId: string) =>
  rpc<LeaveRoomResult>('leave_room', { room_id: roomId })

export const kickPlayer = (roomId: string, playerId: string) =>
  rpc<KickPlayerResult>('kick_player', { room_id: roomId, player_id: playerId })

export const setReady = (roomId: string, ready: boolean) =>
  rpc<SetReadyResult>('set_ready', { room_id: roomId, ready })

// Phase 2 — play area, start, clock
export const setPlayArea = (roomId: string, centerLat: number, centerLng: number, radiusM: number) =>
  rpc<SetPlayAreaResult>('set_play_area', {
    room_id: roomId,
    center_lat: centerLat,
    center_lng: centerLng,
    radius_m: radiusM,
  })

export const startRound = (roomId: string, finderId: string | null) =>
  rpc<StartRoundResult>('start_round', { room_id: roomId, finder_id: finderId })

export const serverNow = () => rpc<ServerNowResult>('server_now')

export const advanceRound = (roomId: string) =>
  rpc<AdvanceRoundResult>('advance_round', { room_id: roomId })

export const pauseRound = (roomId: string) =>
  rpc<PauseRoundResult>('pause_round', { room_id: roomId })

export const resumeRound = (roomId: string) =>
  rpc<ResumeRoundResult>('resume_round', { room_id: roomId })

export const endRound = (roomId: string) =>
  rpc<EndRoundResult>('end_round', { room_id: roomId })

// Phase 7 — rematch
export const rematch = (roomId: string) =>
  rpc<RematchResult>('rematch', { room_id: roomId })
