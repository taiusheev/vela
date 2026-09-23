import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["postgres-tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ["verbose"],
  },
});
