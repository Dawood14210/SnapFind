/** Disposable test project only. Uses actual anonymous users, bounded ticks. */
import { randomBytes } from 'node:crypto'
import { anonymousClient, required, serviceClient, testProjectOnly } from './env'
testProjectOnly()
const service = serviceClient(), roomId = required('BOT_ROOM_ID')
const lat = Number(required('BOT_CENTER_LAT')), lng = Number(required('BOT_CENTER_LNG'))
const ticks = Number(process.env.BOT_TICKS ?? 12)
if (!Number.isFinite(lat) || Math.abs(lat) > 89 || !Number.isFinite(lng) || Math.abs(lng) > 179 || !Number.isInteger(ticks) || ticks < 1 || ticks > 720) throw new Error('Invalid coordinates or BOT_TICKS (1..720)')
const bots: Awaited<ReturnType<typeof anonymousClient>>[] = [], paths: string[] = []
const assert = (error: { message: string } | null) => { if (error) throw new Error(error.message) }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
try {
  assert((await service.from('rooms').select('id').eq('id', roomId).single()).error)
  const run = randomBytes(3).toString('hex')
  for (let i = 0; i < 8; i++) {
    const bot = await anonymousClient(); bots.push(bot)
    assert((await service.from('players').insert({ id: bot.id, room_id: roomId, nickname: `Bot-${run}-${i + 1}`, role: 'hider' })).error)
    const path = `${roomId}/${bot.id}/0.png`; paths.push(path)
    assert((await service.storage.from('snapshots').upload(path, png, { contentType: 'image/png' })).error)
    assert((await service.from('snapshots').insert({ room_id: roomId, player_id: bot.id, window_index: 0, image_path: path })).error)
  }
  const positions = bots.map(() => ({ lat, lng }))
  for (let tick = 0; tick < ticks; tick++) {
    for (let i = 0; i < bots.length; i++) {
      const p = positions[i]
      p.lat = Math.max(lat - 0.0004, Math.min(lat + 0.0004, p.lat + (Math.random() - 0.5) * 0.00005))
      p.lng = Math.max(lng - 0.0004, Math.min(lng + 0.0004, p.lng + (Math.random() - 0.5) * 0.00005))
      assert((await service.from('locations').insert({ room_id: roomId, player_id: bots[i].id, ...p, accuracy_m: 5, reading_at: new Date().toISOString() })).error)
    }
    console.log(`Bot tick ${tick + 1}/${ticks}`)
    if (tick + 1 < ticks) await new Promise(resolve => setTimeout(resolve, 5000))
  }
} finally {
  let failed = false
  if (paths.length && (await service.storage.from('snapshots').remove(paths)).error) { console.error('FAIL bot photo cleanup'); failed = true }
  for (const bot of bots) if ((await service.auth.admin.deleteUser(bot.id)).error) { console.error('FAIL bot user cleanup'); failed = true }
  if (failed) process.exitCode = 1
}
