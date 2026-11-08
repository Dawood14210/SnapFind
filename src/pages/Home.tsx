import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRoom, joinRoom, leaveRoom } from '@/api'
import type { PlayerView, RoomView } from '@/api'
import { getSupabase } from '@/api/client'
import { friendlyError } from '@/lib/friendlyError'
import { areRulesAccepted, getNickname, setNickname } from '@/lib/storage'
import { useAuth } from '@/auth/AuthProvider'

/**
 * Home screen — three stages:
 *
 * 1. Rules gate (one-time): the rules must be read before the app is used.
 * 2. Name entry: the player picks a nickname (remembered locally).
 * 3. Room area: detects whether the player is already a member of a room
 *    (RLS: members can read their own players row, then their room) and
 *    shows Join/Leave for that room — or Create room / Join by code
 *    otherwise. This is what stops the "you are already in a room" error
 *    when a player comes back to the site inside an active room.
 */
export default function Home() {
  if (!areRulesAccepted()) {
    return <RulesGate />
  }
  return <RoomArea />
}

function RulesGate() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 bg-slate-50">
      <h1 className="text-5xl font-black tracking-tight text-slate-900">Snapfind</h1>
      <p className="text-lg text-slate-600 max-w-md">
        Hide-and-seek for your campus. Create a room, share the code, hide.
      </p>
      <a
        href="/rules"
        className="rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow active:scale-95"
      >
        Read the rules first
      </a>
    </div>
  )
}

function RoomArea() {
  const [nickname, setNicknameState] = useState(getNickname())
  const [stage, setStage] = useState<'name' | 'room'>('name')

  const rememberNickname = (value: string) => {
    setNicknameState(value)
    setNickname(value)
  }

  if (stage === 'name') {
    return (
      <NameEntry
        nickname={nickname}
        onChange={rememberNickname}
        onContinue={() => setStage('room')}
      />
    )
  }
  return <RoomScreen nickname={nickname} onBackToName={() => setStage('name')} />
}

function NameEntry({
  nickname,
  onChange,
  onContinue,
}: {
  nickname: string
  onChange: (value: string) => void
  onContinue: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-slate-50">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-black tracking-tight text-center text-slate-900">Snapfind</h1>
        <p className="mt-2 text-center text-slate-500">Hide-and-seek for your campus.</p>

        <div className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Nickname</span>
            <input
              value={nickname}
              onChange={(e) => onChange(e.target.value)}
              maxLength={20}
              placeholder="e.g. Fox"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-500"
            />
          </label>
          <button
            onClick={onContinue}
            className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white shadow active:scale-95"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

interface RoomScreenState {
  loading: boolean
  room: RoomView | null
  players: PlayerView[]
}

function RoomScreen({
  nickname,
  onBackToName,
}: {
  nickname: string
  onBackToName: () => void
}) {
  const navigate = useNavigate()
  const { user, loading: authLoading, error: authError } = useAuth()
  const [state, setState] = useState<RoomScreenState>({
    loading: true,
    room: null,
    players: [],
  })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) return
    setState((s) => ({ ...s, loading: true }))
    const supabase = getSupabase()
    // RLS: a member can read their own players row, then the room and its
    // players. No row means the player is not in any room.
    const { data: mine } = await supabase
      .from('players')
      .select('room_id')
      .eq('id', user.id)
      .maybeSingle()
    if (!mine) {
      setState({ loading: false, room: null, players: [] })
      return
    }
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', mine.room_id)
      .maybeSingle()
    if (!roomData) {
      setState({ loading: false, room: null, players: [] })
      return
    }
    const { data: playerData } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomData.id)
    setState({ loading: false, room: roomData, players: playerData ?? [] })
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleCreate = async () => {
    setError(null)
    if (!nickname.trim()) {
      setError('Pick a nickname first.')
      return
    }
    setBusy(true)
    try {
      const result = await createRoom(nickname.trim())
      navigate(`/room/${result.room.code}`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleJoin = async () => {
    setError(null)
    if (!nickname.trim()) {
      setError('Pick a nickname first.')
      return
    }
    if (!code.trim()) {
      setError('Enter the room code.')
      return
    }
    setBusy(true)
    try {
      const result = await joinRoom(code.trim().toUpperCase(), nickname.trim())
      navigate(`/room/${result.room.code}`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleLeave = async () => {
    if (!state.room) return
    setError(null)
    setBusy(true)
    try {
      await leaveRoom(state.room.id)
      await refresh()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    )
  }

  if (authError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-semibold text-slate-900">{friendlyError(authError)}</p>
      </div>
    )
  }

  if (state.room) {
    // Already in a room — Join to re-enter, or Leave (lobby only).
    const room = state.room
    const host = state.players.find((p) => p.id === room.host_id)?.nickname
    const running = room.status !== 'lobby' && room.status !== 'ended'
    const canLeave = !running
    const statusLabel =
      room.status === 'lobby' ? 'Lobby' : room.status === 'ended' ? 'Round ended' : 'Round in progress'
    const statusClass =
      room.status === 'lobby'
        ? 'bg-emerald-100 text-emerald-700'
        : room.status === 'ended'
          ? 'bg-slate-200 text-slate-700'
          : 'bg-amber-100 text-amber-700'

    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-slate-50">
        <div className="w-full max-w-md space-y-4">
          <div className="bg-white rounded-2xl shadow p-6">
            <p className="text-sm font-semibold text-slate-500">You are in room</p>
            <p className="mt-1 text-4xl font-black tracking-widest text-slate-900">
              {room.code}
            </p>
            <p className={`mt-4 w-fit rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusClass}`}>
              {statusLabel}
            </p>
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
              <span>Host: {host ?? '—'}</span>
              <span>·</span>
              <span>{state.players.length} players</span>
            </div>
            {running && (
              <p className="mt-2 text-sm font-semibold text-amber-600">
                The round is running — join to jump back in.
              </p>
            )}
            {room.status === 'ended' && (
              <p className="mt-2 text-sm font-semibold text-slate-500">
                The round has ended — leave to start a new one.
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/room/${room.code}`)}
              className="flex-1 rounded-xl bg-emerald-600 py-3 font-semibold text-white shadow active:scale-95 disabled:opacity-50"
            >
              Join room
            </button>
            {canLeave && (
              <button
                onClick={handleLeave}
                disabled={busy}
                className="flex-1 rounded-xl bg-slate-900 py-3 font-semibold text-white shadow active:scale-95 disabled:opacity-50"
              >
                Leave room
              </button>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  // Not in a room — create one or join by code.
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-slate-50">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-black tracking-tight text-center text-slate-900">Snapfind</h1>
        <p className="mt-2 text-center text-slate-500">Hide-and-seek for your campus.</p>

        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Playing as</p>
              <p className="text-slate-500">{nickname || '—'}</p>
            </div>
            <button
              onClick={onBackToName}
              className="text-sm font-semibold text-emerald-700 active:scale-95"
            >
              Change
            </button>
          </div>

          <button
            onClick={handleCreate}
            disabled={busy}
            className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white shadow active:scale-95 disabled:opacity-50"
          >
            Create room
          </button>

          <div className="border-t border-slate-200 pt-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Room code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                placeholder="ABC123"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 uppercase tracking-widest outline-none focus:border-emerald-500"
              />
            </label>
            <button
              onClick={handleJoin}
              disabled={busy}
              className="mt-3 w-full rounded-xl bg-slate-900 py-3 font-semibold text-white shadow active:scale-95 disabled:opacity-50"
            >
              Join room
            </button>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
