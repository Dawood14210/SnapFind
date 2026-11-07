import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The frontend imports shared game constants / round-state helpers through the
// `@shared` alias — the shared/ folder is the single source of truth, never
// copied into src/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@shared': new URL('./shared', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
  },
})
