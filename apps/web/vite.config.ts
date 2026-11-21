import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Development proxies API traffic same-origin; no credentialed cross-origin
// access exists (ADR-0069).
export default defineConfig({
  plugins: [react()],
  server: {
    // Unit tests read the server's engine-profile constants to prove the two sides agree; never widened for `vite dev`.
    fs: process.env.VITEST ? { allow: ["../.."] } : undefined,
    // The development proxy keeps the browser same-origin: cookies and the CSRF header pass through unchanged.
    // LITARA_DEV_API points it at a server other than the default (the browser tests use their own).
    proxy: {
      "/api": process.env.LITARA_DEV_API ?? "http://127.0.0.1:8080",
      "/healthz": process.env.LITARA_DEV_API ?? "http://127.0.0.1:8080",
      "/readyz": process.env.LITARA_DEV_API ?? "http://127.0.0.1:8080",
      "/app-config.json": process.env.LITARA_DEV_API ?? "http://127.0.0.1:8080",
    },
  },
  build: { outDir: "dist", sourcemap: false },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"] },
});
