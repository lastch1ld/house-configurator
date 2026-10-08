import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Pages serves the project site from /house-configurator/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  // Fixed dev port: saved builds live in localStorage, keyed by origin
  // (including port) — if Vite falls back to a different port because this
  // one's in use, previously saved builds silently stop showing up.
  server: {
    port: 5173,
  },
})
