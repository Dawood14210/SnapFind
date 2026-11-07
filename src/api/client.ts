import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/**
 * The frontend uses ONLY the anon key. The service role key never appears
 * here. The client is created lazily so the app shell renders even before
 * the Supabase env vars are configured.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error(
        'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
          'Copy .env.example to .env and fill in your Supabase project values.',
      )
    }
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true, // session survives refresh via localStorage
        autoRefreshToken: true,
      },
    })
  }
  return client
}
