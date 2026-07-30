import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Store logic is plain TS with the Tauri layer mocked, so no DOM is needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
