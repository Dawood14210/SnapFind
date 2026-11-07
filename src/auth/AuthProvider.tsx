import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabase } from '@/api/client'

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, error: null })

/**
 * Anonymous sign-in with a session that survives refresh.
 *
 * supabase-js persists the session in localStorage and auto-refreshes the
 * token, so on load we first try to restore the existing session and only
 * sign in anonymously when there is none.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    let supabase
    try {
      supabase = getSupabase()
    } catch (err) {
      setState({ user: null, loading: false, error: err instanceof Error ? err.message : String(err) })
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) {
        setState({ user: data.session.user, loading: false, error: null })
      } else {
        supabase.auth.signInAnonymously().then(({ data: signIn, error }) => {
          if (cancelled) return
          if (error) {
            setState({ user: null, loading: false, error: error.message })
          } else {
            setState({ user: signIn.user ?? null, loading: false, error: null })
          }
        })
      }
    })

    // Keep the UI in sync with token refreshes / sign-outs.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, loading: false, error: null })
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
