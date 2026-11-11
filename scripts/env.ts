import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
config({ path: fileURLToPath(new URL('.env', import.meta.url)) })
export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in scripts/.env`)
  return value
}
export function serviceClient() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
}
export async function anonymousClient() {
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw new Error('Anonymous sign-in failed; enable it on the test project')
  return { client, id: data.user.id }
}
export function testProjectOnly() {
  if (process.env.CONFIRM_TEST_PROJECT !== 'yes') throw new Error('Set CONFIRM_TEST_PROJECT=yes for a disposable test project')
}
