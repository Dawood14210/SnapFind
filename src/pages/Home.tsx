import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRoom, joinRoom } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { areRulesAccepted, getNickname, setNickname } from '@/lib/storage'

export default function Home() {
  const navigate = useNavigate()
  const [nickname, setNicknameState] = useState(getNickname())
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rulesAccepted = areRulesAccepted()

  const rememberNickname = (value: string) => {
    setNicknameState(value)
    setNickname(value)
  }

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

  if (!rulesAccepted) {
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-slate-50">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-black tracking-tight text-center text-slate-900">
          Snapfind
        </h1>
        <p className="mt-2 text-center text-slate-500">
          Hide-and-seek for your campus.
        </p>

        <div className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Nickname</span>
            <input
              value={nickname}
              onChange={(e) => rememberNickname(e.target.value)}
              maxLength={20}
              placeholder="e.g. Fox"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-500"
            />
          </label>

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={busy}
              className="flex-1 rounded-xl bg-emerald-600 py-3 font-semibold text-white shadow active:scale-95 disabled:opacity-50"
            >
              Create room
            </button>
          </div>

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
