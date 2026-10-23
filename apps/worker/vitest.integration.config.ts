/** HTTP plus real migrations needs Node's filesystem/WASM; runtime-specific tests stay in workerd. */
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.integration.ts"], maxWorkers: 1 } });
