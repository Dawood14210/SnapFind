import { useEffect, useState } from 'react'
import { confirmTag, disputeTag, finalizeTag, requestTag, resolveDispute } from '@/api'
import type { PlayerView, TagView } from '@/api'
import { getSupabase } from '@/api/client'
import { tagSecondsLeft } from '@/lib/tagDisplay'
import { friendlyError } from '@/lib/friendlyError'

export default function TagsPanel({ roomId, userId, players, isHost, isFinder, hunting, nowMs }: {
  roomId: string; userId: string; players: PlayerView[]; isHost: boolean; isFinder: boolean; hunting: boolean; nowMs: number
}) {
  const [tags, setTags] = useState<TagView[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  useEffect(() => {
    let stopped = false
    let running = false
    const poll = async () => {
      if (running) return
      running = true
      try {
        const { data, error } = await getSupabase().from('tags').select('*').eq('room_id', roomId).order('created_at')
        if (error) throw error
        if (stopped) return
        const rows = (data ?? []) as TagView[]
        setTags(rows)
        for (const tag of rows) {
          if (hunting && tag.status === 'pending' && Date.now() - Date.parse(tag.created_at) >= 10_000 && (isFinder || isHost)) {
            await finalizeTag(roomId, tag.id)
          }
        }
      } catch (err) { if (!stopped) setMessage(friendlyError(err)) }
      finally { running = false }
    }
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => { stopped = true; clearInterval(timer) }
  }, [roomId, hunting, isFinder, isHost])
  const act = async (action: () => Promise<unknown>, success: string, tagAttempt = false) => {
    setBusy(true)
    try { await action(); setMessage(success) }
    catch (err) {
      setMessage(friendlyError(err))
      // Conservative local gate; the server remains authoritative.
      if (tagAttempt) setRetryAt(nowMs + 20_000)
    } finally { setBusy(false) }
  }
  const hiders = players.filter(p => p.role === 'hider')
  const mine = tags.filter(t => t.hider_id === userId && t.status === 'pending')
  const nickname = (id: string) => players.find(p => p.id === id)?.nickname ?? 'Hider'
  const button = 'rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-40'
  return <section className="rounded-2xl bg-white p-5 shadow space-y-3" aria-label="Tags">
    <h2 className="text-xl font-bold">Found {hiders.filter(p => p.status === 'tagged').length} of {hiders.length}</h2>
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    {isFinder && hunting && <>
      <p className="text-sm text-slate-500">Tag a hider you have found within 15 m. No positions are shown.</p>
      {retryAt > nowMs && <p role="status">Try again in {Math.ceil((retryAt - nowMs) / 1000)} s</p>}
      {hiders.filter(p => p.status === 'active').map(p => <div key={p.id} className="flex justify-between items-center gap-3">
        <span>{p.nickname}</span><button className={button} disabled={busy || retryAt > nowMs || tags.some(t => t.hider_id === p.id && (t.status === 'pending' || t.status === 'disputed'))}
          onClick={() => void act(() => requestTag(roomId, p.id), `Tag requested for ${p.nickname}`, true)}>Tag</button>
      </div>)}
    </>}
    {mine.map(t => <div key={t.id} role="alert" className="rounded-xl bg-amber-50 p-4 space-y-3">
      <p className="font-bold">The finder says they found you.</p>
      <p>Auto-confirms in {tagSecondsLeft(t.created_at, nowMs)} s. Dispute if this is incorrect.</p>
      <div className="flex gap-3"><button disabled={busy} className={button} onClick={() => void act(() => confirmTag(roomId, t.id), 'Tag confirmed')}>Confirm</button>
        <button disabled={busy} className={button} onClick={() => void act(() => disputeTag(roomId, t.id), 'Disputed — waiting for the host')}>Dispute</button></div>
    </div>)}
    {tags.filter(t => t.status === 'disputed').map(t => <div key={t.id} className="rounded-xl bg-amber-50 p-4 space-y-3">
      <p>Disputed tag: {nickname(t.hider_id)} — waiting for host review.</p>
      {isHost && <div className="flex gap-3"><button disabled={busy} className={button} onClick={() => void act(() => resolveDispute(roomId, t.id, 'confirmed'), 'Tag accepted')}>Accept tag</button>
        <button disabled={busy} className={button} onClick={() => void act(() => resolveDispute(roomId, t.id, 'denied'), 'Tag rejected')}>Reject tag</button></div>}
    </div>)}
    {players.find(p => p.id === userId)?.status === 'tagged' && <p role="status">You are tagged. Spectate with the map, timer, and snapshot feed.</p>}
  </section>
}
