import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
export const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
export function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: corsHeaders }) }
export function failure(code: string, message: string, status = 400): Response { return json({ error: { code, message } }, status) }
export async function authenticated(req: Request) {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false } })
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('NOT_AUTHENTICATED')
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data.user) throw new Error('NOT_AUTHENTICATED')
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  return { caller: data.user.id, service }
}
export function caught(err: unknown): Response {
  return err instanceof Error && err.message === 'NOT_AUTHENTICATED'
    ? failure('NOT_AUTHENTICATED', 'Sign in required', 401)
    : failure('INTERNAL_ERROR', 'Request failed; please retry', 500)
}
