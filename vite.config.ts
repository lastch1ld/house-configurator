import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Pages serves the project site from /house-configurator/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the big vendor libraries into their own files: they change rarely, so returning visitors reuse
        // them from cache when only the app code is redeployed, and the browser fetches them in parallel.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/node_modules[\/]three[\/]/.test(id)) return "three";
          if (/node_modules[\/](@react-three|postprocessing|n8ao|three-stdlib|three-mesh-bvh|maath|meshline|troika-[^\/]+|detect-gpu|camera-controls|stats-gl|its-fine|suspend-react|zustand)[\/]/.test(id)) return "r3f";
          if (/node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) return "react";
          if (/node_modules[\/](@radix-ui|@lastch1ld|@untitledui|@floating-ui|class-variance-authority|clsx|tailwind-merge)[\/]/.test(id)) return "ui";
        },
      },
    },
  },
  // Fixed dev port: saved builds live in localStorage, keyed by origin
  // (including port) — if Vite falls back to a different port because this
  // one's in use, previously saved builds silently stop showing up.
  server: {
    port: 5173,
  },
})
