import { readFileSync } from "node:fs";
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
  vi.stubEnv("EXPO_PUBLIC_TRIAL_TARGET", "production");
  vi.stubEnv("EAS_BUILD_PROFILE", "");
  vi.stubEnv("EXPO_PUBLIC_TRIAL_ENGLISH", "true");
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.vela-light.workers.dev");
  vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_test_fixture");
}
describe("trial build configuration", () => {
  it("refuses a production trial that would show an example family", () => {
    trial();
    vi.stubEnv("EXPO_PUBLIC_DEMO_MODE", "true");
    expect(() => configureApp(context)).toThrow("example family mode");
  });
  it("permits the explicit synthetic English trial only with staging API and development auth", () => {
    trial();
    vi.stubEnv("EXPO_PUBLIC_TRIAL_TARGET", "staging");
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.vela-light-staging.workers.dev");
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
    const config = configureApp(context);
    expect(config.ios?.supportsTablet).toBe(false);
    expect(config.extra).toMatchObject({ trial: true, trialTarget: "staging" });
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.vela-light.workers.dev");
    expect(() => configureApp(context)).toThrow("staging API");
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.vela-light-staging.workers.dev");
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_fixture");
    expect(() => configureApp(context)).toThrow("development Clerk");
  });
  it("refuses a production release profile that tries to select the staging exception", () => {
    trial();
    vi.stubEnv("EAS_BUILD_PROFILE", "trial");
    vi.stubEnv("EXPO_PUBLIC_TRIAL_TARGET", "staging");
    expect(() => configureApp(context)).toThrow("production trial target");
  });
  it("refuses unrecognised trial targets", () => {
    trial();
    vi.stubEnv("EXPO_PUBLIC_TRIAL_TARGET", "unexpected");
    expect(() => configureApp(context)).toThrow("production trial target");
  });
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

describe("audit simulator isolation", () => {
  function audit() {
    vi.stubEnv("EAS_BUILD_PROFILE", "audit-simulator");
    vi.stubEnv("EXPO_PUBLIC_DEMO_MODE", "true");
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("EXPO_PUBLIC_TRIAL_ENGLISH", "false");
  }
  it("is iPhone-only and refuses inherited live credentials or trial mode", () => {
    audit();
    expect(configureApp(context).ios?.supportsTablet).toBe(false);
    for (const [key, value] of [
      ["EXPO_PUBLIC_API_URL", "https://vela.vela-light-staging.workers.dev"],
      ["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture"],
      ["EXPO_PUBLIC_TRIAL_ENGLISH", "true"],
      ["EXPO_PUBLIC_DEMO_MODE", "false"],
    ] as const) {
      audit();
      vi.stubEnv(key, value);
      expect(() => configureApp(context)).toThrow("audit simulator requires demo mode");
    }
  });
  it("disables downloaded updates so the audit always uses its bundled synthetic fixtures", () => {
    audit();
    const withUpdates = {
      ...context,
      config: {
        ...context.config,
        updates: { enabled: true, url: "https://u.expo.dev/synthetic-project" },
      },
    };
    expect(configureApp(withUpdates).updates?.enabled).toBe(false);
    vi.stubEnv("EAS_BUILD_PROFILE", "staging");
    expect(configureApp(withUpdates).updates?.enabled).toBe(true);
  });
});

describe("eas.json", () => {
  const eas = JSON.parse(readFileSync(new URL("../../eas.json", import.meta.url), "utf8")) as {
    build: Record<string, { environment?: string; env?: Record<string, string> }>;
  };
  it("holds no empty value, which EAS refuses for the whole file and every build with it", () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      for (const [key, value] of Object.entries(profile.env ?? {})) {
        expect(value, `${name}.${key}`).not.toBe("");
      }
    }
  });
  it("keeps staging builds and the demo audit off the production EAS environment", () => {
    expect(eas.build.testflight?.environment).toBe("preview");
    expect(eas.build["audit-simulator"]?.environment).toBe("development");
    expect(eas.build.trial?.environment).toBe("production");
  });
});
