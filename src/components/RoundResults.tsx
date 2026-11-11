import { useEffect, useState } from 'react'
import { finalizeScores, leaveRoom, rematch, snapshotUrls } from '@/api'
import type { FinalizeScoresResult, PlayerView, SnapshotWithUrl, TagView } from '@/api'
import { getSupabase } from '@/api/client'
import { friendlyError } from '@/lib/friendlyError'

export default function RoundResults({ roomId, players, isHost, onLobby, onLeave }: {
  roomId: string; players: PlayerView[]; isHost: boolean; onLobby: () => void; onLeave: () => void
}) {
  const [result, setResult] = useState<FinalizeScoresResult | null>(null)
  const [tags, setTags] = useState<TagView[]>([])
  const [photos, setPhotos] = useState<SnapshotWithUrl[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let stopped = false
    const load = async () => {
      try {
        // The persisted event is the source of truth after a reload or when
        // another member has already finalized the round.
        const read = async () => {
          const { data, error } = await getSupabase().from('events').select('payload').eq('room_id', roomId).eq('type', 'scores_finalized').order('created_at', { ascending: false }).limit(1)
          if (error) throw error
          return data?.[0]?.payload as Pick<FinalizeScoresResult, 'scores' | 'finder_won'> | undefined
        }
        let saved = await read()
        if (!saved) {
          try { saved = await finalizeScores(roomId) }
          catch (err) { saved = await read(); if (!saved) throw err }
        }
        if (!stopped) setResult({ ok: true, finalized: true, ...saved })
        const { data, error } = await getSupabase().from('tags').select('*').eq('room_id', roomId).order('created_at')
        if (error) throw error
        if (!stopped) setTags((data ?? []) as TagView[])
        const gallery = await snapshotUrls(roomId, null)
        if (!stopped) setPhotos(gallery.snapshots)
      } catch (err) { if (!stopped) setError(friendlyError(err)) }
    }
    void load()
    return () => { stopped = true }
  }, [roomId, retry])
  const act = async (action: () => Promise<unknown>, done: () => void) => {
    setBusy(true)
    try { await action(); done() } catch (err) { setError(friendlyError(err)) } finally { setBusy(false) }
  }
  const button = 'rounded-xl bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-40'
  return <section className="rounded-2xl bg-white p-5 shadow space-y-5" aria-label="Round results">
    <h2 className="text-3xl font-black">{result ? (result.finder_won ? 'Finder wins!' : 'Hiders win!') : 'Calculating results…'}</h2>
    {error && <div role="alert"><p>{error}</p><button className={button} onClick={() => { setError(''); setRetry(n => n + 1) }}>Retry</button></div>}
    <ol className="space-y-3">{result?.scores.map((score, index) => <li key={score.player_id} className="rounded-xl bg-slate-50 p-4">
      <details><summary className="cursor-pointer font-bold">{index + 1}. {score.nickname} — {score.points} points</summary>
        <ul className="mt-2 text-sm">{score.breakdown.map((entry, n) => <li key={n} className="flex justify-between gap-4"><span>{entry.label}</span><span>{entry.points > 0 ? '+' : ''}{entry.points}</span></li>)}</ul>
      </details>
    </li>)}</ol>
    <h3 className="text-lg font-bold">Tag timeline</h3>
    {tags.length === 0 && <p className="text-sm text-slate-500">No tag attempts this round.</p>}
    <ol>{tags.map(t => <li key={t.id} className="py-2 text-sm">{new Date(t.created_at).toLocaleTimeString()} — {players.find(p => p.id === t.hider_id)?.nickname ?? 'Hider'}: {t.status}</li>)}</ol>
    <h3 className="text-lg font-bold">Snapshot gallery</h3>
    {players.filter(p => p.role === 'hider').map(p => <div key={p.id}><h4 className="font-semibold">{p.nickname}</h4><div className="flex gap-2 overflow-x-auto py-2">{photos.filter(s => s.player_id === p.id).map(s => <a key={s.id} href={s.image_url} target="_blank" rel="noreferrer"><img className="h-24 w-24 rounded-lg object-cover" src={s.image_url} alt={`Snapshot by ${p.nickname}`} /></a>)}</div></div>)}
    <div className="flex flex-wrap gap-3">{isHost && <button disabled={busy || !result} className={button} onClick={() => void act(() => rematch(roomId), onLobby)}>Play again</button>}
      {!isHost && <p className="text-sm text-slate-500">Waiting for the host to start a rematch.</p>}
      <button disabled={busy} className={button} onClick={() => void act(() => leaveRoom(roomId), onLeave)}>Leave</button></div>
  </section>
}
