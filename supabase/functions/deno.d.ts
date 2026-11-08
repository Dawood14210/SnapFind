// Minimal Deno global shims so `tsc -p supabase/functions` can type-check the
// Edge Functions. The real runtime is Deno (Supabase Edge Functions); these
// declarations only exist for the local type check.

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Promise<Response> | Response): void
}
