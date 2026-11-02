/** Explicit adversarial evaluation; policy mismatches must remain visible, outside regular CI. */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["evaluations/weekly-report/*.eval.ts"],
    maxWorkers: 1,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
