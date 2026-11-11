import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { purgeRoomPhotos } from './purge-photos'
function fixture(fail = false) {
  const remove = vi.fn(async (_paths: string[]) => ({ error: fail ? new Error('storage failure') : null }))
  const eq = vi.fn(async () => ({ error: null }))
  const list = vi.fn(async (prefix: string, options: { offset: number }) => ({
    data: prefix === 'room' ? [{ name: 'player', id: null }] : options.offset === 0
      ? Array.from({ length: 100 }, (_, i) => ({ name: `${i}.jpg`, id: `${i}` }))
      : [{ name: 'orphan.jpg', id: 'orphan' }], error: null,
  }))
  const service = { storage: { from: () => ({ list, remove }) }, from: () => ({ delete: () => ({ eq }) }) } as unknown as SupabaseClient
  return { service, list, remove, eq }
}
describe('purgeRoomPhotos', () => {
  it('walks folders, pages listings and batches removals', async () => {
    const f = fixture()
    expect(await purgeRoomPhotos(f.service, 'room')).toBe(101)
    expect(f.list).toHaveBeenCalledWith('room/player', expect.objectContaining({ offset: 100 }))
    expect(f.remove).toHaveBeenCalledTimes(2)
    expect(f.remove.mock.calls[1][0]).toEqual(['room/player/orphan.jpg'])
    expect(f.eq).toHaveBeenCalledWith('room_id', 'room')
  })
  it('preserves metadata on storage failure', async () => {
    const f = fixture(true)
    await expect(purgeRoomPhotos(f.service, 'room')).rejects.toThrow('storage failure')
    expect(f.eq).not.toHaveBeenCalled()
  })
})
