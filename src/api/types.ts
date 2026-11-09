/**
 * Response shapes for every RPC and Edge Function in /docs/api-contract.md.
 * RoomView and RoundState come from @shared/roundState — the single source.
 */

import type { RoomView, RoundState } from '@shared/roundState'

export type { RoomView, RoundState }

export type PlayerRole = 'finder' | 'hider' | null
export type PlayerStatus = 'active' | 'tagged'
export type RoomStatus = 'lobby' | 'hiding' | 'hunting' | 'paused' | 'ended'

export interface PlayerView {
  id: string
  room_id: string
  nickname: string
  role: PlayerRole
  status: PlayerStatus
  points: number
  ready: boolean
  suspect: boolean
  joined_at: string
}

export interface PlayArea {
  center_lat: number
  center_lng: number
  radius_m: number
}

// ---------------------------------------------------------------------------
// RPC: create_room / join_room / leave_room / kick_player / set_ready
// ---------------------------------------------------------------------------

export interface CreateRoomResult {
  room: RoomView
  player: PlayerView
  host: true
}

export interface JoinRoomResult {
  room: RoomView
  player: PlayerView
}

export interface LeaveRoomResult {
  ok: true
}

export interface KickPlayerResult {
  ok: true
}

export interface SetReadyResult {
  ready: boolean
}

// ---------------------------------------------------------------------------
// RPC: set_room_settings
// ---------------------------------------------------------------------------

export interface SetRoomSettingsResult {
  ok: true
  room: RoomView
}

// ---------------------------------------------------------------------------
// RPC: dev_add_dummy_players
// ---------------------------------------------------------------------------

export interface DevAddDummyPlayersResult {
  ok: true
  added: number
}

// ---------------------------------------------------------------------------
// RPC: set_play_area / start_round / server_now / advance_round
// ---------------------------------------------------------------------------

export interface SetPlayAreaResult {
  ok: true
  play_area: PlayArea
}

export interface StartRoundResult {
  ok: true
  room: RoomView
  finder_id: string
}

export interface ServerNowResult {
  now: number
}

export interface AdvanceRoundResult {
  room: RoomView
  round: RoundState
}

// ---------------------------------------------------------------------------
// RPC: pause_round / resume_round / end_round / rematch
// ---------------------------------------------------------------------------

export interface PauseRoundResult {
  ok: true
  paused_at: string
}

export interface ResumeRoundResult {
  ok: true
  paused_total_ms: number
}

export interface EndRoundResult {
  ok: true
  room: RoomView
}

export interface RematchResult {
  ok: true
  finder_id: string
}

// ---------------------------------------------------------------------------
// Edge: round_status
// ---------------------------------------------------------------------------

export type ProximityBand = 'far' | 'near' | 'close' | 'unknown'

export interface RoundStatusResult {
  room: RoomView
  round: RoundState
  players: PlayerView[]
  finder_id: string | null
  /** Finder: a band per active hider. Hider: only their own band. */
  proximity: Record<string, ProximityBand>
  /** Seconds outside the play area per player. */
  out_of_bounds: Record<string, number>
  /** Present only for the finder. */
  abilities: { charges: number; cooldown_until: number | null } | null
  counts: { players: number; hiders: number; active_hiders: number; tagged: number }
}

// ---------------------------------------------------------------------------
// Edge: submit_snapshot / snapshot_urls / resolve_window
// ---------------------------------------------------------------------------

export interface SnapshotView {
  id: string
  room_id: string
  player_id: string
  window_index: number
  task_id: string | null
  image_path: string
  taken_at: string
  late: boolean
}

export interface SnapshotWithUrl extends SnapshotView {
  image_url: string
}

export interface SubmitSnapshotInput {
  room_id: string
  window_index: number
  task_id: string | null
  image_path: string
  taken_at: string
}

export interface SubmitSnapshotResult {
  ok: true
  snapshot_id: string
  late: boolean
  points_awarded: number
}

export interface SnapshotUrlsResult {
  snapshots: SnapshotWithUrl[]
}

export interface ResolveWindowResult {
  ok: true
  resolved: boolean
  reveals_created: number
}

// ---------------------------------------------------------------------------
// Edge: task_progress / skip_task
// ---------------------------------------------------------------------------

export type TaskType = 'reach_zone' | 'stay_put' | 'distance' | 'photo'
export type TaskStatus = 'pending' | 'active' | 'done' | 'skipped' | 'expired'

export interface TaskView {
  id: string
  room_id: string
  player_id: string
  type: TaskType
  params: Record<string, unknown>
  status: TaskStatus
  points: number
  assigned_at: string
  expires_at: string
}

export interface TaskProgressResult {
  tasks: TaskView[]
  skips_left: number
}

export interface SkipTaskResult {
  ok: true
  points_penalty: number
  skips_left: number
}

// ---------------------------------------------------------------------------
// Edge: use_ability
// ---------------------------------------------------------------------------

export type AbilityKind = 'pulse' | 'zone_scan' | 'clue_card'

export interface RevealView {
  id: string
  room_id: string
  kind: 'pulse' | 'zone_scan' | 'clue' | 'last_known' | 'out_of_bounds'
  lat: number
  lng: number
  radius_m: number | null
  count: number | null
  label: string
  expires_at: string
  window_index: number | null
  target_player_id: string | null
}

export interface UseAbilityInput {
  room_id: string
  kind: AbilityKind
  lat?: number | null
  lng?: number | null
  radius_m?: number | null
}

export interface UseAbilityResult {
  ok: true
  reveal: RevealView
  charges_left: number
  cooldown_until: number
}

// ---------------------------------------------------------------------------
// Edge: tags and scores
// ---------------------------------------------------------------------------

export type TagStatus = 'pending' | 'confirmed' | 'disputed'

export interface TagView {
  id: string
  room_id: string
  finder_id: string
  hider_id: string
  status: TagStatus
  created_at: string
}

export interface RequestTagResult {
  ok: true
  tag_id: string
  status: 'pending'
}

export interface ConfirmTagResult {
  ok: true
  hider_status: 'tagged'
  finder_points: number
}

export interface DisputeTagResult {
  ok: true
  status: 'disputed'
}

export interface FinalizeTagResult {
  ok: true
  confirmed: boolean
  points: number | null
}

export interface ResolveDisputeResult {
  ok: true
  confirmed: boolean
  points: number | null
}

export interface ScoreBreakdownEntry {
  label: string
  points: number
}

export interface ScoreEntry {
  player_id: string
  nickname: string
  points: number
  breakdown: ScoreBreakdownEntry[]
}

export interface FinalizeScoresResult {
  ok: true
  finalized: boolean
  scores: ScoreEntry[]
  finder_won: boolean
}

// ---------------------------------------------------------------------------
// Edge: sos / purge_photos
// ---------------------------------------------------------------------------

export interface SosResult {
  ok: true
  alert_id: string
  round_paused: true
}

export interface PurgePhotosResult {
  ok: true
  purged: number
}
