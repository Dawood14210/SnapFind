import { useNavigate } from 'react-router-dom'
import { acceptRules } from '@/lib/storage'

const RULES = [
  { title: 'Stay inside the area', body: 'The play area is set by the host before the round starts.' },
  { title: 'Stay off roads', body: 'Play on paths and lawns, never on roads or bike lanes.' },
  { title: 'No photos of faces', body: 'Snapshots are for finding hiding spots — no identifiable faces.' },
]

export default function Rules() {
  const navigate = useNavigate()

  const handleAccept = () => {
    acceptRules()
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-black text-slate-900">Snapfind rules</h1>
        <p className="mt-2 text-sm text-slate-500">
          Read these once before you play. You can review them any time from the
          in-round Rules button.
        </p>
        <ul className="mt-6 space-y-5">
          {RULES.map((rule) => (
            <li key={rule.title} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-white">
                !
              </span>
              <div>
                <p className="font-semibold text-slate-900">{rule.title}</p>
                <p className="text-sm text-slate-600">{rule.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <button
          onClick={handleAccept}
          className="mt-6 w-full rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white active:scale-95"
        >
          Accept and continue
        </button>
      </div>
    </div>
  )
}
