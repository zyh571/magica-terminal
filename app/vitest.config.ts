import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "shell/tests/**/*.test.ts"], testTimeout: 20000 },
});
