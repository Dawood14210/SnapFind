import { authenticated, corsHeaders, failure, json, caught } from '../lib/http.ts'
import { uuidPattern, validCoordinates } from '../lib/safety.ts'
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 'Use POST', 405)
  try {
    const { caller, service } = await authenticated(req)
    let body
    try { body = await req.json() } catch { return failure('BAD_REQUEST', 'Expected JSON') }
    if (!body || typeof body.room_id !== 'string' || !uuidPattern.test(body.room_id) || !validCoordinates(body.lat, body.lng)) return failure('BAD_REQUEST', 'Valid room_id, lat and lng required')
    const { data, error } = await service.rpc('record_sos', { p_room_id: body.room_id, p_player_id: caller, p_lat: body.lat, p_lng: body.lng })
    if (error) {
      const code = /ROOM_NOT_FOUND|NOT_IN_ROOM|ROUND_NOT_ACTIVE/.exec(error.message)?.[0]
      return code ? failure(code, code) : failure('DB_ERROR', 'Could not record SOS', 500)
    }
    return json(data)
  } catch (err) { return caught(err) }
})
