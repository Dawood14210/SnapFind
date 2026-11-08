/**
 * Snapfind — round_status Edge Function (Phase 3).
 *
 * POST { "room_id": string } with the caller's bearer token. The player comes
 * from the token. Returns the room, the round state (shared getRoundState —
 * identical to the advance_round RPC), the player list, proximity bands for
 * the finder (per active hider) or the hider's own band, per-player seconds
 * outside the play area, and counts. Never returns coordinates or distances.
 *
 * Server-side effects: inserts an out_of_bounds reveal (30 m, 10 s) after
 * 60 s out of bounds, and flags players whose readings imply > 12 m/s as
 * suspect (event for the host).
 *
 * Deploy with the Supabase CLI (local import graph must be bundled):
 *   supabase functions deploy round_status
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getRoundState, type RoomView } from './lib/round.ts'
import {
  OUT_OF_BOUNDS_REVEAL_RADIUS,
  OUT_OF_BOUNDS_REVEAL_SEC,
  SPEED_LIMIT,
  haversineM,
  impliedSpeedMps,
  proximityBand,
  secondsOutOfBounds,
  type LatLng,
  type ProximityBand,
  type Reading,
} from './lib/geo.ts'

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

function isActive(status: string): boolean {
  return status === 'hiding' || status === 'hunting' || status === 'paused'
}

/** Point on the play-area boundary (east of the centre) — used when a player
 * is out of bounds but has no reading. */
function playAreaEdge(area: { lat: number; lng: number; radiusM: number }): LatLng {
  const lngOffset = area.radiusM / (111320 * Math.cos((area.lat * Math.PI) / 180))
  return { lat: area.lat, lng: area.lng + lngOffset }
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

  let body: { room_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return errorJson('BAD_REQUEST', 'JSON body required', 400)
  }
  if (typeof body.room_id !== 'string' || !body.room_id) {
    return errorJson('BAD_REQUEST', 'room_id required', 400)
  }
  const roomId = body.room_id

  // Room + membership (service key reads; the caller's membership is checked
  // against the players table — RLS never trusts the client).
  const { data: roomData } = await service.from('rooms').select('*').eq('id', roomId).maybeSingle()
  if (!roomData) return errorJson('ROOM_NOT_FOUND', 'Room not found', 404)
  const room = roomData as RoomView

  const { data: memberData } = await service
    .from('players')
    .select('id')
    .eq('room_id', roomId)
    .eq('id', userId)
    .maybeSingle()
  if (!memberData) return errorJson('NOT_IN_ROOM', 'You are not in this room', 403)

  const { data: playersData } = await service
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true })
  const players = playersData ?? []

  // Recent readings (newest first), grouped per player.
  const { data: readingsData } = await service
    .from('locations')
    .select('player_id, lat, lng, reading_at')
    .eq('room_id', roomId)
    .order('reading_at', { ascending: false })
    .limit(100)
  const byPlayer = new Map<string, Reading[]>()
  for (const r of readingsData ?? []) {
    const list = byPlayer.get(r.player_id) ?? []
    list.push({ lat: r.lat, lng: r.lng, readingAtMs: Date.parse(r.reading_at) })
    byPlayer.set(r.player_id, list)
  }

  const nowMs = Date.now()
  const playArea =
    room.center_lat !== null && room.center_lng !== null && room.radius_m !== null
      ? { lat: room.center_lat, lng: room.center_lng, radiusM: room.radius_m }
      : null

  // ---- out of bounds + reveal insertion ----
  const outOfBounds: Record<string, number> = {}
  const revealInserts: Array<Record<string, unknown>> = []
  if (playArea) {
    // Existing unexpired out_of_bounds reveals for this room (dedupe).
    const { data: revealData } = await service
      .from('reveals')
      .select('target_player_id')
      .eq('room_id', roomId)
      .eq('kind', 'out_of_bounds')
      .gt('expires_at', new Date(nowMs).toISOString())
    const activeRevealTargets = new Set(
      (revealData ?? []).map((r) => r.target_player_id).filter((id): id is string => !!id),
    )

    for (const player of players) {
      const playerReadings = byPlayer.get(player.id) ?? []
      const seconds = secondsOutOfBounds(playerReadings, playArea, playArea.radiusM, nowMs)
      outOfBounds[player.id] = seconds

      if (seconds < OUT_OF_BOUNDS_REVEAL_SEC) continue
      if (activeRevealTargets.has(player.id)) continue
      // Only during a live round, and only if there is a finder to see it.
      if (!isActive(room.status) || !room.finder_id) continue

      const latest = playerReadings[0]
      const centre: LatLng = latest
        ? { lat: latest.lat, lng: latest.lng }
        : playAreaEdge(playArea)
      revealInserts.push({
        room_id: roomId,
        player_id: room.finder_id,
        target_player_id: player.id,
        kind: 'out_of_bounds',
        lat: centre.lat,
        lng: centre.lng,
        radius_m: OUT_OF_BOUNDS_REVEAL_RADIUS,
        label: 'out of bounds',
        expires_at: new Date(nowMs + OUT_OF_BOUNDS_REVEAL_SEC * 1000).toISOString(),
      })
      activeRevealTargets.add(player.id)
    }

    if (revealInserts.length > 0) {
      const { error: insertError } = await service.from('reveals').insert(revealInserts)
      if (insertError) return errorJson('INTERNAL', 'Could not insert reveal', 500)
    }
  } else {
    for (const player of players) outOfBounds[player.id] = 0
  }

  // ---- speed check (> 12 m/s -> suspect + event for the host) ----
  if (isActive(room.status)) {
    for (const player of players) {
      const playerReadings = (byPlayer.get(player.id) ?? []).slice(0, 20)
      const speed = impliedSpeedMps(playerReadings)
      if (speed <= SPEED_LIMIT || player.suspect) continue
      const { data: updated } = await service
        .from('players')
        .update({ suspect: true })
        .eq('room_id', roomId)
        .eq('id', player.id)
        .select('id')
        .maybeSingle()
      if (updated) {
        // Best-effort: the event notifies the host.
        await service.from('events').insert({
          room_id: roomId,
          type: 'speed_check',
          payload: { player_id: player.id, speed_mps: speed },
        })
      }
    }
  }

  // ---- proximity bands (never coordinates or distances) ----
  const proximity: Record<string, ProximityBand> = {}
  const myRole = players.find((p) => p.id === userId)?.role ?? null
  if (userId === room.finder_id && room.finder_id) {
    // Finder: one band per active hider.
    for (const player of players) {
      if (player.role !== 'hider' || player.status !== 'active') continue
      const band = bandBetween(byPlayer, room.finder_id, player.id, nowMs)
      proximity[player.id] = band
    }
  } else if (myRole === 'hider') {
    // Hider: only their own band (distance to the finder).
    proximity[userId] = bandBetween(byPlayer, room.finder_id ?? '', userId, nowMs)
  }

  const counts = {
    players: players.length,
    hiders: players.filter((p) => p.role === 'hider').length,
    active_hiders: players.filter((p) => p.role === 'hider' && p.status === 'active').length,
    tagged: players.filter((p) => p.status === 'tagged').length,
  }

  return json({
    room,
    round: getRoundState(room, nowMs),
    players,
    finder_id: room.finder_id,
    proximity,
    out_of_bounds: outOfBounds,
    abilities: null,
    counts,
  })
})

/** Proximity band between two players from their latest readings. */
function bandBetween(
  byPlayer: Map<string, Reading[]>,
  a: string,
  b: string,
  nowMs: number,
): ProximityBand {
  if (!a) return 'unknown'
  const ra = byPlayer.get(a)?.[0]
  const rb = byPlayer.get(b)?.[0]
  if (!ra || !rb) return 'unknown'
  const age = nowMs - Math.min(ra.readingAtMs, rb.readingAtMs)
  return proximityBand(haversineM(ra, rb), age)
}
