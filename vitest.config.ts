import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: the tests here are pure-function
// unit tests over the geometry/domain modules (no React rendering), so they
// don't need the react plugin or a DOM environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
