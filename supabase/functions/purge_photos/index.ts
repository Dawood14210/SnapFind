import { authenticated, corsHeaders, failure, json, caught } from '../lib/http.ts'
import { uuidPattern } from '../lib/safety.ts'
import { purgeRoomPhotos } from '../lib/purge-photos.ts'
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 'Use POST', 405)
  try {
    const { caller, service } = await authenticated(req)
    let body
    try { body = await req.json() } catch { return failure('BAD_REQUEST', 'Expected JSON') }
    if (!body || typeof body.room_id !== 'string' || !uuidPattern.test(body.room_id)) return failure('BAD_REQUEST', 'Valid room_id required')
    const { data: room, error } = await service.from('rooms').select('host_id,status').eq('id', body.room_id).maybeSingle()
    if (error) return failure('DB_ERROR', 'Could not read room', 500)
    if (!room) return failure('ROOM_NOT_FOUND', 'Room not found', 404)
    if (room.host_id !== caller) return failure('NOT_HOST', 'Only the host can purge photos', 403)
    if (room.status !== 'ended') return failure('ROUND_NOT_ENDED', 'Round must be ended')
    try { return json({ ok: true, purged: await purgeRoomPhotos(service, body.room_id) }) }
    catch { return failure('PURGE_FAILED', 'Photo cleanup failed; retry', 500) }
  } catch (err) { return caught(err) }
})
