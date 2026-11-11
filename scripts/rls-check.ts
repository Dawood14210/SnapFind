/** Dedicated test project only. Service key seeds; user sessions test RLS. */
import { randomUUID } from 'node:crypto'
import { anonymousClient, serviceClient, testProjectOnly } from './env'
testProjectOnly()
const service = serviceClient()
const users: Awaited<ReturnType<typeof anonymousClient>>[] = []
const roomId = randomUUID()
let failures = 0
try {
  for (let i = 0; i < 4; i++) users.push(await anonymousClient())
  const [host, finder, hider, outsider] = users
  const seed = async (table: string, rows: object | object[]) => {
    const { error } = await service.from(table).insert(rows)
    if (error) throw new Error(`Fixture ${table}: ${error.message}`)
  }
  await seed('rooms', { id: roomId, code: randomUUID().slice(0, 8).toUpperCase(), host_id: host.id, finder_id: finder.id, status: 'hunting' })
  await seed('players', [host, finder, hider].map((u, i) => ({ id: u.id, room_id: roomId, nickname: `RLS-${i}`, role: i === 1 ? 'finder' : 'hider' })))
  const locs = [finder, hider].map(u => ({ id: randomUUID(), room_id: roomId, player_id: u.id, lat: 32, lng: 74 }))
  await seed('locations', locs)
  const taskId = randomUUID(), revealId = randomUUID(), abilityId = randomUUID(), sosId = randomUUID()
  await seed('tasks', { id: taskId, room_id: roomId, player_id: hider.id, type: 'photo', points: 20, params: {}, expires_at: new Date(Date.now() + 600_000).toISOString() })
  await seed('reveals', { id: revealId, room_id: roomId, player_id: finder.id, kind: 'pulse', lat: 32, lng: 74, expires_at: new Date(Date.now() + 10_000).toISOString() })
  await seed('ability_uses', { id: abilityId, room_id: roomId, player_id: finder.id, kind: 'pulse' })
  await seed('sos_alerts', { id: sosId, room_id: roomId, player_id: hider.id, lat: 32, lng: 74 })
  const read = async (label: string, who: typeof host, table: string, id: string, allowed: boolean) => {
    const { data, error } = await who.client.from(table).select('id').eq('id', id)
    const pass = !error && (allowed ? data?.length === 1 : data?.length === 0)
    console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${error ? ` (${error.message})` : ''}`)
    if (!pass) failures++
  }
  await read('hider own location positive control', hider, 'locations', locs[1].id, true)
  await read('finder denied hider location', finder, 'locations', locs[1].id, false)
  await read('hider denied finder location', hider, 'locations', locs[0].id, false)
  await read('hider own task positive control', hider, 'tasks', taskId, true)
  await read('finder denied hider task', finder, 'tasks', taskId, false)
  await read('finder own reveal positive control', finder, 'reveals', revealId, true)
  await read('hider denied reveal', hider, 'reveals', revealId, false)
  await read('finder own ability positive control', finder, 'ability_uses', abilityId, true)
  await read('hider denied ability', hider, 'ability_uses', abilityId, false)
  await read('host SOS positive control', host, 'sos_alerts', sosId, true)
  for (const [name, who] of [['finder', finder], ['hider', hider], ['outsider', outsider]] as const) await read(`${name} denied SOS`, who, 'sos_alerts', sosId, false)
  for (const [table, id] of [['locations', locs[1].id], ['tasks', taskId], ['reveals', revealId], ['ability_uses', abilityId]] as const) await read(`outsider denied ${table}`, outsider, table, id, false)
} finally {
  const { error } = await service.from('rooms').delete().eq('id', roomId)
  if (error) { console.error('FAIL room cleanup'); failures++ }
  for (const user of users) {
    const { error } = await service.auth.admin.deleteUser(user.id)
    if (error) { console.error('FAIL user cleanup'); failures++ }
  }
}
if (failures) process.exitCode = 1
