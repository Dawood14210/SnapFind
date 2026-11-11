import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { STORAGE_BUCKET } from '../../../shared/constants.ts'
/** List before deleting: offset pagination over a shrinking list skips files. */
export async function purgeRoomPhotos(service: SupabaseClient, roomId: string): Promise<number> {
  const bucket = service.storage.from(STORAGE_BUCKET)
  const paths: string[] = []
  const walk = async (prefix: string): Promise<void> => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw error
      for (const item of data ?? []) {
        const path = `${prefix}/${item.name}`
        if (item.id) paths.push(path)
        else await walk(path)
      }
      if (!data || data.length < 100) break
    }
  }
  await walk(roomId)
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket.remove(paths.slice(i, i + 100))
    if (error) throw error
  }
  const { error } = await service.from('snapshots').delete().eq('room_id', roomId)
  if (error) throw error
  return paths.length
}
