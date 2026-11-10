/**
 * finalize_scores — finalise the round's hider bonuses (Phase 7).
 *
 * Runs once when the round has ended (rooms.status = 'ended'). Hiders earn
 * +WINDOW_UNTAGGED_BONUS for each snapshot window (1..SNAPSHOT_WINDOW_COUNT)
 * in which they were still untagged at the window's opening, and +50 if they
 * were untagged at the end. The finder's tag points (and the 100 round-clear
 * bonus) were credited live during the round; this function only adds the
 * hider bonuses and writes the full breakdown to an events row
 * (type scores_finalized).
 *
 * Idempotent via rooms.scores_finalized: a repeated call returns
 * { finalized: true } with no score changes. The finder wins only if every
 * hider was tagged.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SNAPSHOT_WINDOW_COUNT,
  SNAPSHOT_WINDOW_SEC,
  UNTAGGED_END_BONUS,
  UNTAGGED_END_POINTS,
  WINDOW_UNTAGGED_BONUS,
} from '../../../shared/constants.ts'
import { finderWon, type TagRow } from '../lib/tags.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

interface PlayerRow {
  id: string
  role: string
  nickname: string
  points: number
  status: string
}

interface ScoreLine {
  label: string
  points: number
}

interface ScoreView {
  player_id: string
  nickname: string
  points: number
  breakdown: ScoreLine[]
}

function jsonError(code: string, message: string, status = 400): Response {
  return Response.json({ error: { code, message } }, { status })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  }
  if (req.method !== 'POST') return jsonError('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const auth = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!auth) return jsonError('NOT_AUTHENTICATED', 'Sign in required', 401)
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userError } = await anon.auth.getUser(auth)
  if (userError || !userData?.user) return jsonError('NOT_AUTHENTICATED', 'Sign in required', 401)
  const caller = userData.user.id
  const service = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('BAD_REQUEST', 'Expected a JSON body')
  }
  const roomId = String(body.room_id ?? '')
  if (!roomId) return jsonError('BAD_REQUEST', 'room_id is required')

  // 1. Membership first — any member of the room can poll this.
  const { data: playerRows, error: playerError } = await service
    .from('players')
    .select('id, room_id, role, nickname, points, status')
    .eq('room_id', roomId)
  if (playerError) return jsonError('DB_ERROR', playerError.message, 500)
  const players = (playerRows ?? []) as PlayerRow[]
  if (!players.some((p) => p.id === caller)) {
    return jsonError('NOT_A_PLAYER', 'Not a player in this room')
  }

  // 2. Room must be ended; already-finalised rooms return immediately.
  const { data: roomRows, error: roomError } = await service
    .from('rooms')
    .select('id, status, scores_finalized, started_at, paused_total_ms')
    .eq('id', roomId)
    .maybeSingle()
  if (roomError) return jsonError('DB_ERROR', roomError.message, 500)
  const room = roomRows
  if (!room) return jsonError('ROOM_NOT_FOUND', 'Room not found', 404)
  if (room.scores_finalized) {
    return jsonError('ALREADY_FINALIZED', 'Scores are already finalised', 409)
  }
  if (room.status !== 'ended') return jsonError('ROUND_NOT_ENDED', 'The round has not ended yet')

  // 3. Confirmed tags give each hider their tag time (for window bonuses).
  const { data: tagRows, error: tagError } = await service
    .from('tags')
    .select('id, room_id, finder_id, hider_id, status, points, created_at')
    .eq('room_id', roomId)
    .eq('status', 'confirmed')
  if (tagError) return jsonError('DB_ERROR', tagError.message, 500)
  const tags = (tagRows ?? []) as TagRow[]

  const startedAtMs = Date.parse(room.started_at ?? '') || 0
  const pausedTotalMs = room.paused_total_ms ?? 0

  // 4. Compute per-hider bonuses.
  const hiders = players.filter((p) => p.role === 'hider')
  const taggedAtByHider = new Map<string, number>()
  for (const tag of tags) {
    const ms = Date.parse(tag.created_at)
    if (!Number.isNaN(ms)) {
      taggedAtByHider.set(tag.hider_id, Math.max(taggedAtByHider.get(tag.hider_id) ?? 0, ms))
    }
  }

  const scores: ScoreView[] = []
  const updates: Array<{ id: string; points: number }> = []

  for (const hider of hiders) {
    const taggedAtMs = taggedAtByHider.get(hider.id) ?? null
    const breakdown: ScoreLine[] = []
    let bonus = 0

    for (let n = 1; n <= SNAPSHOT_WINDOW_COUNT; n++) {
      const windowOpenMs = startedAtMs + pausedTotalMs + n * SNAPSHOT_WINDOW_SEC * 1000
      const untaggedAtOpen = taggedAtMs === null || taggedAtMs > windowOpenMs
      if (untaggedAtOpen) {
        breakdown.push({ label: `Window ${n}`, points: WINDOW_UNTAGGED_BONUS })
        bonus += WINDOW_UNTAGGED_BONUS
      }
    }

    if (hider.status === 'active') {
      breakdown.push({ label: 'Untagged end', points: UNTAGGED_END_POINTS })
      bonus += UNTAGGED_END_POINTS
    }

    const finalPoints = hider.points + bonus
    updates.push({ id: hider.id, points: finalPoints })
    scores.push({ player_id: hider.id, nickname: hider.nickname, points: finalPoints, breakdown })
  }

  const finder = players.find((p) => p.role === 'finder')
  const finderTags = tags.filter((t) => t.finder_id === finder?.id)
  const finderBreakdown: ScoreLine[] = finderTags.map((t) => ({ label: 'Tag', points: t.points ?? 0 }))
  const taggedCount = hiders.filter((h) => h.status === 'tagged').length
  const won = finderWon(taggedCount, hiders.length)
  if (won) {
    finderBreakdown.push({ label: 'Round clear', points: UNTAGGED_END_BONUS })
  }
  if (finder) {
    scores.push({
      player_id: finder.id,
      nickname: finder.nickname,
      points: finder.points,
      breakdown: finderBreakdown,
    })
  }

  // Leaderboard order: points desc, nickname asc for determinism.
  scores.sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname))

  // 5. Apply hider bonuses and mark the room finalised.
  for (const update of updates) {
    const { error: updateError } = await service
      .from('players')
      .update({ points: update.points })
      .eq('id', update.id)
    if (updateError) return jsonError('DB_ERROR', updateError.message, 500)
  }

  const { error: eventError } = await service.from('events').insert({
    room_id: roomId,
    type: 'scores_finalized',
    payload: { scores, finder_won: won },
  })
  if (eventError) return jsonError('DB_ERROR', eventError.message, 500)
  const { error: finalizeError } = await service
    .from('rooms')
    .update({ scores_finalized: true })
    .eq('id', roomId)
  if (finalizeError) return jsonError('DB_ERROR', finalizeError.message, 500)

  return Response.json({ ok: true, finalized: true, scores, finder_won: won })
})
