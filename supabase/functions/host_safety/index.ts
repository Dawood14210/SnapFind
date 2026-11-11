import { authenticated, corsHeaders, failure, json, caught } from '../lib/http.ts'
import { uuidPattern } from '../lib/safety.ts'
import { haversineM } from '../lib/geo.ts'
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 'Use POST', 405)
  try {
    const { caller, service } = await authenticated(req)
    const body = await req.json().catch(() => null)
    if (!body || typeof body.room_id !== 'string' || !uuidPattern.test(body.room_id)) return failure('BAD_REQUEST', 'Valid room_id required')
    const { data: room, error } = await service.from('rooms').select('host_id,center_lat,center_lng,radius_m').eq('id', body.room_id).maybeSingle()
    if (error) return failure('DB_ERROR', 'Could not read room', 500)
    if (!room || room.host_id !== caller) return failure('NOT_HOST', 'Host only', 403)
    const players = await service.from('players').select('id,nickname,status,suspect').eq('room_id', body.room_id)
    if (players.error) return failure('DB_ERROR', 'Could not read players', 500)
    const rows = []
    for (const player of players.data ?? []) {
      const location = await service.from('locations').select('lat,lng,reading_at').eq('room_id', body.room_id).eq('player_id', player.id).order('reading_at', { ascending: false }).limit(1)
      if (location.error) return failure('DB_ERROR', 'Could not read safety status', 500)
      const loc = location.data?.[0]
      rows.push({ ...player, last_reading_at: loc?.reading_at ?? null,
        out_of_area: loc && room.center_lat !== null && room.center_lng !== null && room.radius_m !== null
          ? haversineM({ lat: loc.lat, lng: loc.lng }, { lat: room.center_lat, lng: room.center_lng }) > room.radius_m : null })
    }
    return json({ players: rows })
  } catch (err) { return caught(err) }
})
