import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Development proxies API traffic same-origin; no credentialed cross-origin
// access exists (ADR-0069).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
      "/readyz": "http://127.0.0.1:8080",
    },
  },
  build: { outDir: "dist", sourcemap: false },
  test: { environment: "jsdom" },
});
