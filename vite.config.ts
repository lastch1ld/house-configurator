import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Fixed dev port: saved builds live in localStorage, keyed by origin
  // (including port) — if Vite falls back to a different port because this
  // one's in use, previously saved builds silently stop showing up.
  server: {
    port: 5173,
  },
})
