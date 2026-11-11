import { useEffect, useRef, useState } from 'react'
import { freshForSos, holdForSos, outsideDaylight } from '@/lib/safety'
import { sos, resumeRound } from '@/api'
import { getSupabase } from '@/api/client'
import { friendlyError } from '@/lib/friendlyError'
import type { LocationReading } from '@/hooks/useLocation'
type SafetyRow = { id: string; nickname: string; status: string; suspect: boolean; last_reading_at: string | null; out_of_area: boolean | null }
type Alert = { id: string; player_id: string; created_at: string }
export default function SafetyPanel({ roomId, isHost, active, paused, pausedAt, reading, nowMs, onRefresh }: {
  roomId: string; isHost: boolean; active: boolean; paused: boolean; pausedAt: string | null; reading: LocationReading | null; nowMs: number; onRefresh: () => Promise<void>
}) {
  const [online, setOnline] = useState(navigator.onLine)
  const [batteryLow, setBatteryLow] = useState(false)
  const [holding, setHolding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<SafetyRow[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [sound, setSound] = useState(false)
  const audio = useRef<AudioContext | null>(null)
  const timer = useRef<(() => void) | null>(null)
  const latestReading = useRef(reading); latestReading.current = reading
  const cancel = () => { if (timer.current) timer.current(); timer.current = null; setHolding(false) }
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); if (timer.current) timer.current(); void audio.current?.close() }
  }, [])
  useEffect(() => {
    type Battery = EventTarget & { level: number; charging: boolean }
    let battery: Battery | undefined, stopped = false
    const update = () => { if (battery && !stopped) setBatteryLow(battery.level <= 0.2 && !battery.charging) }
    const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> }
    void nav.getBattery?.().then(b => { if (stopped) return; battery = b; update(); b.addEventListener('levelchange', update); b.addEventListener('chargingchange', update) }).catch(() => {})
    return () => { stopped = true; battery?.removeEventListener('levelchange', update); battery?.removeEventListener('chargingchange', update) }
  }, [])
  useEffect(() => {
    if (!active || !isHost) return
    let stopped = false, running = false
    const poll = async () => {
      if (running) return; running = true
      try {
        const client = getSupabase()
        const result = await client.functions.invoke('host_safety', { body: { room_id: roomId } })
        if (result.error) throw result.error
        const alertsResult = await client.from('sos_alerts').select('id,player_id,created_at').eq('room_id', roomId).order('created_at', { ascending: false }).limit(10)
        if (alertsResult.error) throw alertsResult.error
        if (!stopped) { setRows(result.data.players); setAlerts(alertsResult.data ?? []) }
      } catch (err) { if (!stopped) setError(friendlyError(err)) }
      finally { running = false }
    }
    void poll(); const id = setInterval(() => void poll(), 5000)
    return () => { stopped = true; clearInterval(id) }
  }, [roomId, isHost, active])
  const lastAlert = alerts.find(a => pausedAt && Date.parse(a.created_at) >= Date.parse(pausedAt) - 1000)
  const sounded = useRef('')
  useEffect(() => {
    if (!paused || !lastAlert || sounded.current === lastAlert.id) return
    sounded.current = lastAlert.id
    navigator.vibrate?.([200, 100, 200])
    if (sound && audio.current) {
      const ctx = audio.current, oscillator = ctx.createOscillator(), gain = ctx.createGain()
      oscillator.connect(gain); gain.connect(ctx.destination); gain.gain.value = 0.15
      oscillator.frequency.value = 660; oscillator.start(); oscillator.stop(ctx.currentTime + 0.4)
    }
  }, [paused, lastAlert, sound])
  const send = async () => {
    cancel()
    const current = latestReading.current
    if (!current || !freshForSos(current.atMs, Date.now())) { setError('SOS needs a fresh GPS reading. Enable location. If in danger, contact the host or local emergency services directly.'); return }
    setBusy(true)
    try { await sos(roomId, current.lat, current.lng); navigator.vibrate?.(200); setError('SOS sent. Stay safe and contact your host.'); await onRefresh() }
    catch (err) { setError(`SOS not confirmed: ${friendlyError(err)}. Contact your host directly.`) }
    finally { setBusy(false) }
  }
  const start = () => { if (busy || timer.current) return; setHolding(true); timer.current = holdForSos(() => void send()) }
  const dark = reading ? outsideDaylight(nowMs, reading.lat, reading.lng) : false
  const button = 'min-h-12 rounded-xl bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-50'
  return <section className="space-y-3 rounded-2xl border-2 border-slate-300 bg-white p-4" aria-label="Safety">
    {!online && <p role="alert" className="rounded-lg bg-amber-100 p-3 font-bold">Offline — GPS uploads and SOS may not reach the host. Contact them directly.</p>}
    {batteryLow && <p role="status">Battery at or below 20%. Save power and tell your host.</p>}
    {dark && <p role="status" className="font-bold text-amber-900">Outside daylight hours. Stop play if visibility is unsafe.</p>}
    <div className="flex flex-wrap gap-3"><a className={button} href="/rules" target="_blank" rel="noreferrer">Rules ↗</a>
      <button className={button} onClick={() => { try { if (!audio.current) audio.current = new AudioContext(); void audio.current.resume().catch(() => setError('Sound unavailable.')); setSound(v => !v) } catch { setError('Sound is not supported on this device.') } }}>Sound {sound ? 'on' : 'off'}</button></div>
    {active && <button disabled={busy || !online} className="min-h-16 w-full touch-none select-none rounded-xl bg-red-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
      onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); start() }} onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel}
      onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start() } }} onKeyUp={cancel}>
      {busy ? 'Sending SOS…' : holding ? 'Keep holding…' : 'Hold 2 seconds for SOS'}
    </button>}
    {error && <p role="status" className="text-sm font-semibold">{error}</p>}
    {isHost && active && <details><summary className="min-h-12 cursor-pointer py-3 font-bold">Host safety status</summary>
      <p className="text-xs text-slate-600">No coordinates. Refreshed every 5 seconds. Unknown or stale readings are not proof of safety.</p>
      {!rows.length && <p>Loading safety status…</p>}
      <ul>{rows.map(row => <li key={row.id} className="border-t py-3"><strong>{row.nickname}</strong> · {row.status} · {row.last_reading_at ? `${Math.max(0, Math.floor((nowMs - Date.parse(row.last_reading_at)) / 1000))}s since GPS` : 'No GPS'} · {row.out_of_area === null ? 'Area unknown' : row.out_of_area ? 'Outside area' : 'Inside area'}{row.suspect ? ' · Speed flagged' : ''}</li>)}</ul>
    </details>}
    {isHost && paused && lastAlert && <div role="alertdialog" aria-modal="true" aria-label="SOS alert" onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); e.currentTarget.querySelector('button')?.focus() } }} className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-red-950 p-8 text-center text-white">
      {!online && <p className="font-bold">Offline — contact the player directly. Resume cannot reach the server yet.</p>}
      <h2 className="text-5xl font-black">SOS — check on your player</h2><p className="text-2xl">{rows.find(p => p.id === lastAlert.player_id)?.nickname ?? 'A player'} requested help.</p><p>Round paused. Contact the player and confirm everyone is safe before resuming. This does not contact emergency services.</p>
      <button autoFocus className="min-h-16 rounded-xl bg-white px-6 py-4 font-black text-red-950" disabled={busy || !online} onClick={async () => { setBusy(true); try { await resumeRound(roomId); await onRefresh() } catch (err) { setError(friendlyError(err)) } finally { setBusy(false) } }}>Everyone safe — Resume</button>
      {error && <p>{error}</p>}
    </div>}
  </section>
}
