import type { ConfigContext } from "expo/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import configureApp from "../../app.config.ts";

const context: ConfigContext = {
  projectRoot: "/test",
  staticConfigPath: null,
  packageJsonPath: null,
  config: { name: "Vela", slug: "vela", ios: { supportsTablet: true } },
};
afterEach(() => vi.unstubAllEnvs());
function trial() {
  vi.stubEnv("EAS_BUILD_PROFILE", "");
  vi.stubEnv("EXPO_PUBLIC_TRIAL_ENGLISH", "true");
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.vela-light.workers.dev");
  vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_test_fixture");
}
describe("trial build configuration", () => {
  it("recognizes the trial during local EAS evaluation, disables tablet support and records its source", () => {
    trial();
    vi.stubEnv("EAS_BUILD_GIT_COMMIT_HASH", undefined);
    vi.stubEnv("EXPO_PUBLIC_RELEASE_COMMIT", "0123456789abcdef");
    const config = configureApp(context);
    expect(config.ios?.supportsTablet).toBe(false);
    expect(config.extra?.trial).toBe(true);
    expect(config.extra?.releaseCommit).toBe("0123456789abcdef");
  });
  it("refuses a trial that would use a development Clerk instance", () => {
    trial();
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
    expect(() => configureApp(context)).toThrow("production Clerk");
  });
  it("refuses a trial that points to staging", () => {
    trial();
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.vela-light-staging.workers.dev");
    expect(() => configureApp(context)).toThrow("production API");
  });
  it("preserves the distinct staging build when no trial flag or profile is supplied", () => {
    vi.stubEnv("EAS_BUILD_PROFILE", "staging");
    vi.stubEnv("EXPO_PUBLIC_TRIAL_ENGLISH", "false");
    expect(configureApp(context).ios?.supportsTablet).toBe(true);
  });
});
