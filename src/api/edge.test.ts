import { describe, expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) }))
vi.mock('@/api/client', () => ({ getSupabase: () => ({ functions: { invoke } }) }))
import { rematch } from './edge'
describe('rematch cleanup path', () => {
  it('uses Edge cleanup rather than direct SQL reset', async () => {
    await rematch('room-1')
    expect(invoke).toHaveBeenCalledWith('rematch', { body: { room_id: 'room-1' } })
  })
})
