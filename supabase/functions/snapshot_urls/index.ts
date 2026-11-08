/**
 * Snapfind — snapshot_urls Edge Function (Phase 4).
 *
 * POST { "room_id": string, "window_index": number | null }
 *
 * Returns the snapshots the caller may see (finder: all; tagged player: all;
 * a hider: own; anyone once the round has ended) with 60-second signed
 * image URLs (service key — the anon key can never sign). The player comes
 * from the token; visibility is filtered server-side.
 *
 * Deploy with the Supabase CLI (local import graph must be bundled):
 *   supabase functions deploy snapshot_urls
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SNAPSHOT_URL_TTL_SEC } from '../lib/snapshot.ts'

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

interface SnapshotRow {
  id: string
  player_id: string
  window_index: number
  task_id: string | null
  taken_at: string
  late: boolean
  image_path: string
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
  let windowIndex: number | null = null
  if (body.window_index !== null && body.window_index !== undefined) {
    if (typeof body.window_index !== 'number' || !Number.isInteger(body.window_index)) {
      return errorJson('INVALID_WINDOW', 'window_index must be an integer or null', 400)
    }
    windowIndex = body.window_index
  }

  // Room + membership (service key reads; checks happen server-side).
  const { data: roomData } = await service
    .from('rooms')
    .select('id, status')
    .eq('id', roomId)
    .maybeSingle()
  if (!roomData) return errorJson('ROOM_NOT_FOUND', 'Room not found', 404)

  const { data: memberData } = await service
    .from('players')
    .select('role, status')
    .eq('room_id', roomId)
    .eq('id', userId)
    .maybeSingle()
  if (!memberData) return errorJson('NOT_IN_ROOM', 'You are not in this room', 403)

  // Visibility: finder and tagged players see all; everyone sees all once
  // the round has ended; a hider sees only their own snapshots.
  const seesAll =
    memberData.role === 'finder' || memberData.status === 'tagged' || roomData.status === 'ended'

  let query = service
    .from('snapshots')
    .select('id, player_id, window_index, task_id, taken_at, late, image_path')
    .eq('room_id', roomId)
    .order('taken_at', { ascending: false })
  if (windowIndex !== null) {
    query = query.eq('window_index', windowIndex)
  }
  const { data: snapshotsData, error: queryError } = await query
  if (queryError) return errorJson('INTERNAL', 'Could not load snapshots', 500)

  const rows = (snapshotsData ?? []).filter(
    (row) => seesAll || (row.player_id as string) === userId,
  ) as SnapshotRow[]

  const out: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const { data: signed, error: signError } = await service.storage
      .from('snapshots')
      .createSignedUrl(row.image_path, SNAPSHOT_URL_TTL_SEC)
    if (signError || !signed?.signedUrl) {
      return errorJson('INTERNAL', 'Could not sign image URL', 500)
    }
    out.push({
      id: row.id,
      player_id: row.player_id,
      window_index: row.window_index,
      task_id: row.task_id,
      taken_at: row.taken_at,
      late: row.late,
      image_url: signed.signedUrl,
    })
  }

  return json({ snapshots: out })
})
