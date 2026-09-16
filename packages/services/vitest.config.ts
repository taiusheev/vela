import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Each test file boots one PGlite (Postgres compiled to WebAssembly) through the harness, and
    // each instance reserves a large memory block up front that is only given back when its fork
    // ends. One worker keeps the peak at one instance, so a full `turbo test` beside `@vela/db`,
    // which runs its own files one at a time for the same reason, cannot fail to allocate.
    maxWorkers: 1,
  },
});
