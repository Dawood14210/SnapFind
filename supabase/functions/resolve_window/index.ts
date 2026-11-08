/**
 * Snapfind — resolve_window Edge Function (Phase 4).
 *
 * POST { "room_id": string, "window_index": number }
 *
 * Idempotent: safe to call repeatedly once a window is due (the client calls
 * it 2 minutes after a window closes). For each active hider with no
 * snapshot in that window, inserts a last_known reveal — 60 m / 15 s (first
 * miss in the round) or 40 m / 30 s (second miss) — centred on the stored
 * position at check time (latest reading; play-area edge if unknown), with a
 * label noting the missed window. A hider is revealed at most once per
 * missed window (reveals.window_index dedupe).
 *
 * The player comes from the token. The server validates everything:
 * membership, round state (hunting) and that the window is ≥ 2 minutes past
 * its close.
 *
 * Deploy with the Supabase CLI (local import graph must be bundled):
 *   supabase functions deploy resolve_window
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SNAPSHOT_LATE_TOLERANCE_SEC,
  SNAPSHOT_WINDOW_SEC,
  lastKnownLabel,
  lastKnownReveal,
  playAreaEdge,
  roundSeconds,
} from '../lib/snapshot.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorJson(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status)
}

interface RoomRow {
  id: string
  status: string
  started_at: string | null
  paused_total_ms: number
  finder_id: string | null
  center_lat: number | null
  center_lng: number | null
  radius_m: number | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return errorJson('METHOD_NOT_ALLOWED', 'POST required', 405)
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const service = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The player comes from the token — never from the request body.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return errorJson('UNAUTHENTICATED', 'Missing token', 401)
  const { data: userData, error: userError } = await anon.auth.getUser(token)
  if (userError || !userData.user) return errorJson('UNAUTHENTICATED', 'Invalid token', 401)
  const userId = userData.user.id

  let body: { room_id?: unknown; window_index?: unknown }
  try {
    body = await req.json()
  } catch {
    return errorJson('BAD_REQUEST', 'JSON body required', 400)
  }
  if (typeof body.room_id !== 'string' || !body.room_id) {
    return errorJson('BAD_REQUEST', 'room_id required', 400)
  }
  const roomId = body.room_id

  if (
    typeof body.window_index !== 'number' ||
    !Number.isInteger(body.window_index) ||
    body.window_index < 0
  ) {
    return errorJson('INVALID_WINDOW', 'window_index must be a non-negative integer', 400)
  }
  const windowIndex = body.window_index

  // Room + membership (service key reads; checks happen server-side).
  const { data: roomData } = await service
    .from('rooms')
    .select('id, status, started_at, paused_total_ms, finder_id, center_lat, center_lng, radius_m')
    .eq('id', roomId)
    .maybeSingle()
  if (!roomData) return errorJson('ROOM_NOT_FOUND', 'Room not found', 404)
  const room = roomData as RoomRow

  const { data: memberData } = await service
    .from('players')
    .select('id')
    .eq('room_id', roomId)
    .eq('id', userId)
    .maybeSingle()
  if (!memberData) return errorJson('NOT_IN_ROOM', 'You are not in this room', 403)

  if (room.status !== 'hunting') {
    return errorJson('ROUND_NOT_HUNTING', 'The round is not hunting', 422)
  }

  // The window must be at least 2 minutes past its close.
  const roundSecondsValue = roundSeconds(Date.now(), room.started_at, room.paused_total_ms)
  const windowCloseSec = windowIndex * SNAPSHOT_WINDOW_SEC + SNAPSHOT_LATE_TOLERANCE_SEC
  if (roundSecondsValue < windowCloseSec) {
    return errorJson(
      'WINDOW_NOT_DUE',
      `Window ${windowIndex} is not due yet`,
      422,
    )
  }

  // Active hiders.
  const { data: hidersData } = await service
    .from('players')
    .select('id')
    .eq('room_id', roomId)
    .eq('role', 'hider')
    .eq('status', 'active')
  const hiders = (hidersData ?? []).map((h) => h.id as string)
  if (hiders.length === 0 || !room.finder_id) {
    return json({ ok: true, resolved: false, reveals_created: 0 })
  }

  // Snapshots per hider (window indices they already submitted).
  const { data: snapshotsData } = await service
    .from('snapshots')
    .select('player_id, window_index')
    .eq('room_id', roomId)
  const submittedByPlayer = new Map<string, Set<number>>()
  for (const s of snapshotsData ?? []) {
    const set = submittedByPlayer.get(s.player_id as string) ?? new Set<number>()
    set.add(s.window_index as number)
    submittedByPlayer.set(s.player_id as string, set)
  }

  // Reveals already created for this window (idempotency).
  const { data: revealsData } = await service
    .from('reveals')
    .select('target_player_id')
    .eq('room_id', roomId)
    .eq('kind', 'last_known')
    .eq('window_index', windowIndex)
  const revealedForWindow = new Set(
    (revealsData ?? []).map((r) => r.target_player_id as string).filter((id): id is string => !!id),
  )

  // Latest reading per hider (newest first).
  const { data: readingsData } = await service
    .from('locations')
    .select('player_id, lat, lng, reading_at')
    .eq('room_id', roomId)
    .order('reading_at', { ascending: false })
    .limit(200)
  const latestByPlayer = new Map<string, { lat: number; lng: number }>()
  for (const r of readingsData ?? []) {
    if (!latestByPlayer.has(r.player_id as string)) {
      latestByPlayer.set(r.player_id as string, { lat: r.lat, lng: r.lng })
    }
  }

  const playArea =
    room.center_lat !== null && room.center_lng !== null && room.radius_m !== null
      ? { lat: room.center_lat, lng: room.center_lng, radiusM: room.radius_m }
      : null

  const revealInserts: Array<Record<string, unknown>> = []
  for (const hiderId of hiders) {
    const submitted = submittedByPlayer.get(hiderId)
    if (submitted?.has(windowIndex)) continue
    if (revealedForWindow.has(hiderId)) continue

    // Misses before this window (windows 1..n-1 without a snapshot).
    let missedBefore = 0
    for (let w = 1; w < windowIndex; w += 1) {
      if (!submitted?.has(w)) missedBefore += 1
    }
    const secondMiss = missedBefore >= 1
    const reveal = lastKnownReveal(secondMiss)

    const latest = latestByPlayer.get(hiderId)
    const centre = latest ?? (playArea ? playAreaEdge(playArea) : null)
    if (!centre) continue

    revealInserts.push({
      room_id: roomId,
      player_id: room.finder_id,
      target_player_id: hiderId,
      kind: 'last_known',
      window_index: windowIndex,
      lat: centre.lat,
      lng: centre.lng,
      radius_m: reveal.radiusM,
      label: lastKnownLabel(windowIndex, secondMiss),
      expires_at: new Date(Date.now() + reveal.durationSec * 1000).toISOString(),
    })
    revealedForWindow.add(hiderId)
  }

  if (revealInserts.length > 0) {
    const { error: insertError } = await service.from('reveals').insert(revealInserts)
    if (insertError) return errorJson('INTERNAL', 'Could not insert reveals', 500)
  }

  return json({
    ok: true,
    resolved: revealInserts.length > 0,
    reveals_created: revealInserts.length,
  })
})
