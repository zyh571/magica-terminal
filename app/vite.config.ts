import { defineConfig } from "vite";

// Tauri serves the built files; in dev it points at this server.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
