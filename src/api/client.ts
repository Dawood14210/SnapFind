import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    'Snapfind: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project values.',
  )
}

// The frontend uses ONLY the anon key. The service role key never appears here.
export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true, // session survives refresh via localStorage
    autoRefreshToken: true,
  },
})
