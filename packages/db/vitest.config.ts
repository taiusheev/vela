import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Each test file boots its own PGlite (Postgres compiled to WebAssembly), and each instance
    // reserves a large memory block up front. Running the files one at a time keeps the peak at one
    // instance, so a full `turbo test` alongside the other packages cannot fail to allocate.
    fileParallelism: false,
  },
});
