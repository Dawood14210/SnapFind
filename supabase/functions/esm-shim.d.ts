// Resolves the esm.sh import used by Edge Functions to the locally installed
// @supabase/supabase-js types. Deno resolves the URL at runtime; this shim
// only exists for the local type check.

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js'
}
