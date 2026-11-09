/**
 * Snapfind — use_ability Edge Function (Phase 6).
 *
 * POST { "room_id": string, "kind": "pulse|zone_scan|clue_card",
 *        "lat": number|null, "lng": number|null, "radius_m": number|null }
 *
 * The finder spends a charge to get a location clue. The server owns
 * everything: caller is the finder, the round is hunting, charges via
 * getCharges (1 per 4 min of hunt time + 1 at 20:00, minus spent), a 30 s
 * cooldown between any two uses, and the reveal itself:
 *  - pulse: an 80 m circle centred up to 50 m away from the nearest hider,
 *    10 s; the same hider cannot be pulsed twice within 5 minutes;
 *  - zone_scan: the count of hiders inside a circle (lat/lng/radius_m,
 *    radius ≤ 100 m), 20 s;
 *  - clue_card: the current task type of one random active hider (no name),
 *    30 s.
 *
 * Writes an `ability_used` event containing only the ability name.
 *
 * Deploy with the Supabase CLI (local import graph must be bundled):
 *   supabase functions deploy use_ability
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  ABILITY_COST,
  ABILITY_COOLDOWN_SEC,
  CLUE_CARD_DURATION_SEC,
  PULSE_DURATION_SEC,
  PULSE_RADIUS_M,
  PULSE_REPEAT_COOLDOWN_SEC,
  ZONE_SCAN_DURATION_SEC,
} from '../../../shared/constants.ts'
import { getCharges } from '../../../shared/charges.ts'
import {
  clueLabel,
  isValidZoneScanRadius,
  pulseCentre,
  zoneScanCount,
  type AbilityKind,
  type HiderReading,
} from '../lib/abilities.ts'
import { haversineM, type LatLng } from '../lib/geo.ts'
import { roundSeconds } from '../lib/snapshot.ts'

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

const REVEAL_COLUMNS =
  'id, room_id, kind, lat, lng, radius_m, count, label, expires_at, target_player_id'

interface RoomRow {
  id: string
  status: string
  started_at: string | null
  paused_total_ms: number
  center_lat: number | null
  center_lng: number | null
}

interface PlayerRow {
  id: string
  role: string
  status: string
}

interface AbilityUseRow {
  id: string
  created_at: string
}

interface LocationRow {
  player_id: string
  lat: number
  lng: number
  reading_at: string
}

/**
 * The newest reading per player in the room, from a newest-first list of
 * readings (clients store a reading every ~3 s).
 */
function latestReadings(rows: LocationRow[]): Map<string, LatLng & { atMs: number }> {
  const map = new Map<string, LatLng & { atMs: number }>()
  for (const r of rows) {
    if (!map.has(r.player_id)) {
      map.set(r.player_id, { lat: r.lat, lng: r.lng, atMs: Date.parse(r.reading_at) })
    }
  }
  return map
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

  let body: {
    room_id?: unknown
    kind?: unknown
    lat?: unknown
    lng?: unknown
    radius_m?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return errorJson('BAD_REQUEST', 'JSON body required', 400)
  }
  if (typeof body.room_id !== 'string' || !body.room_id) {
    return errorJson('BAD_REQUEST', 'room_id required', 400)
  }
  const roomId = body.room_id

  // Membership first: an unknown room simply has no member row, so the
  // caller is not the finder there.
  const { data: memberData } = await service
    .from('players')
    .select('id, role, status')
    .eq('room_id', roomId)
    .eq('id', userId)
    .maybeSingle()
  if (!memberData || memberData.role !== 'finder') {
    return errorJson('NOT_FINDER', 'Only the finder uses abilities', 403)
  }

  const { data: roomData } = await service
    .from('rooms')
    .select('id, status, started_at, paused_total_ms, center_lat, center_lng')
    .eq('id', roomId)
    .maybeSingle()
  if (!roomData) return errorJson('NOT_FINDER', 'Only the finder uses abilities', 403)
  const room = roomData as RoomRow

  if (room.status !== 'hunting') {
    return errorJson('ROUND_NOT_HUNTING', 'The round is not hunting', 422)
  }

  if (
    body.kind !== 'pulse' &&
    body.kind !== 'zone_scan' &&
    body.kind !== 'clue_card'
  ) {
    return errorJson('INVALID_PARAMS', 'kind must be pulse, zone_scan or clue_card', 400)
  }
  const kind = body.kind as AbilityKind

  const nowMs = Date.now()
  const huntSeconds = roundSeconds(nowMs, room.started_at, room.paused_total_ms)

  // Charges: 1 per 4 min of hunt time + 1 at 20:00, minus spent.
  const { count: spentData } = await service
    .from('ability_uses')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .eq('player_id', userId)
  const charges = getCharges(huntSeconds, spentData ?? 0)
  const cost = ABILITY_COST[kind]
  if (charges < cost) {
    return errorJson('NOT_ENOUGH_CHARGES', 'Not enough charges', 409)
  }

  // 30 s cooldown between any two ability uses.
  const { data: lastUse } = await service
    .from('ability_uses')
    .select('id, created_at')
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
  const last = (lastUse ?? [])[0] as AbilityUseRow | undefined
  if (last) {
    const cooldownUntil = Date.parse(last.created_at) + ABILITY_COOLDOWN_SEC * 1000
    if (nowMs < cooldownUntil) {
      return errorJson('ON_COOLDOWN', 'Ability on cooldown', 429)
    }
  }

  // Recent readings for everyone in the room (newest first).
  const { data: locData } = await service
    .from('locations')
    .select('player_id, lat, lng, reading_at')
    .eq('room_id', roomId)
    .order('reading_at', { ascending: false })
    .limit(100)
  const readings = latestReadings((locData ?? []) as LocationRow[])
  const finderPos = readings.get(userId) ?? null

  // Active hiders with their latest reading.
  const { data: hiderData } = await service
    .from('players')
    .select('id, role, status')
    .eq('room_id', roomId)
    .eq('role', 'hider')
    .eq('status', 'active')
  const hiders: HiderReading[] = (hiderData ?? []).map((p) => ({
    playerId: p.id,
    reading: readings.get(p.id) ?? null,
  }))

  let revealLat: number
  let revealLng: number
  let revealRadius: number | null
  let revealCount: number | null
  let revealLabel: string
  let revealExpires: Date
  let revealTarget: string | null

  if (kind === 'pulse') {
    // Nearest hider to the finder.
    if (!finderPos) {
      return errorJson('INVALID_PARAMS', 'Your position is unknown', 400)
    }
    const withReading = hiders.filter((h) => h.reading !== null)
    if (withReading.length === 0) {
      return errorJson('INVALID_PARAMS', 'No hider position available', 400)
    }
    const nearest = withReading.reduce((a, b) => {
      const da = haversineM(finderPos, a.reading!)
      const db = haversineM(finderPos, b.reading!)
      return da <= db ? a : b
    })
    // The same hider cannot be pulsed twice within 5 minutes.
    const { data: recentPulse } = await service
      .from('reveals')
      .select('id')
      .eq('room_id', roomId)
      .eq('kind', 'pulse')
      .eq('target_player_id', nearest.playerId)
      .gt('created_at', new Date(nowMs - PULSE_REPEAT_COOLDOWN_SEC * 1000).toISOString())
      .maybeSingle()
    if (recentPulse) {
      return errorJson('PULSE_SAME_HIDERS', 'That hider was pulsed recently', 409)
    }
    const centre = pulseCentre(nearest.reading!)
    revealLat = centre.lat
    revealLng = centre.lng
    revealRadius = PULSE_RADIUS_M
    revealCount = null
    revealLabel = 'pulse: nearest hider (80 m circle)'
    revealExpires = new Date(nowMs + PULSE_DURATION_SEC * 1000)
    revealTarget = nearest.playerId
  } else if (kind === 'zone_scan') {
    if (
      typeof body.lat !== 'number' ||
      typeof body.lng !== 'number' ||
      typeof body.radius_m !== 'number' ||
      !isValidZoneScanRadius(body.radius_m)
    ) {
      return errorJson(
        'INVALID_PARAMS',
        'zone_scan needs lat, lng and radius_m (1..100 m)',
        400,
      )
    }
    const count = zoneScanCount(hiders, { lat: body.lat, lng: body.lng }, body.radius_m)
    revealLat = body.lat
    revealLng = body.lng
    revealRadius = body.radius_m
    revealCount = count
    revealLabel = `${count} hider${count === 1 ? '' : 's'} in the zone`
    revealExpires = new Date(nowMs + ZONE_SCAN_DURATION_SEC * 1000)
    revealTarget = null
  } else {
    // clue_card: the task type of one random active hider (no name).
    const { data: taskData } = await service
      .from('tasks')
      .select('player_id, type')
      .eq('room_id', roomId)
      .eq('status', 'active')
    const hidersWithTask = (taskData ?? []).filter((t) =>
      hiders.some((h) => h.playerId === t.player_id),
    )
    if (hidersWithTask.length === 0) {
      return errorJson('INVALID_PARAMS', 'No active hider has a task', 400)
    }
    const chosen = hidersWithTask[Math.floor(Math.random() * hidersWithTask.length)]
    revealLat = finderPos?.lat ?? room.center_lat ?? 0
    revealLng = finderPos?.lng ?? room.center_lng ?? 0
    revealRadius = null
    revealCount = null
    revealLabel = clueLabel(chosen.type)
    revealExpires = new Date(nowMs + CLUE_CARD_DURATION_SEC * 1000)
    revealTarget = null
  }

  // The reveal (service key), the charge spend and the event.
  const { data: revealData, error: revealError } = await service
    .from('reveals')
    .insert({
      room_id: roomId,
      player_id: userId,
      target_player_id: revealTarget,
      kind: kind === 'clue_card' ? 'clue' : kind,
      lat: revealLat,
      lng: revealLng,
      radius_m: revealRadius,
      count: revealCount,
      label: revealLabel,
      expires_at: revealExpires.toISOString(),
    })
    .select(REVEAL_COLUMNS)
    .maybeSingle()
  if (revealError || !revealData) {
    return errorJson('INTERNAL', 'Could not create the reveal', 500)
  }

  const { error: useError } = await service
    .from('ability_uses')
    .insert({ room_id: roomId, player_id: userId, kind })
  if (useError) return errorJson('INTERNAL', 'Could not spend the charge', 500)

  // The event carries only the ability name — never coordinates or hiders.
  const { error: eventError } = await service.from('events').insert({
    room_id: roomId,
    type: 'ability_used',
    payload: { kind },
  })
  if (eventError) return errorJson('INTERNAL', 'Could not write the event', 500)

  return json({
    ok: true,
    reveal: revealData,
    charges_left: charges - cost,
    cooldown_until: nowMs + ABILITY_COOLDOWN_SEC * 1000,
  })
})
