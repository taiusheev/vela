import { describe, expect, it } from "vitest";
import { pushAvailability } from "./availability.ts";

const PROJECT = "0b7e6d1c-3f7a-4c1e-9a55-5d2f3c1a9e10";

describe("whether this build can receive pushes (A1)", () => {
  it("is available in an EAS build with a project id, on either phone", () => {
    for (const os of ["ios", "android"]) {
      for (const executionEnvironment of ["standalone", "bare"]) {
        expect(pushAvailability({ os, executionEnvironment, projectId: PROJECT })).toEqual({
          available: true,
          projectId: PROJECT,
        });
      }
    }
  });

  it("is never available on the web, whatever else is true", () => {
    expect(
      pushAvailability({ os: "web", executionEnvironment: "bare", projectId: PROJECT }),
    ).toEqual({ available: false, reason: "web" });
  });

  it("is not available in Expo Go, which has had no remote push since SDK 53", () => {
    expect(
      pushAvailability({ os: "android", executionEnvironment: "storeClient", projectId: PROJECT }),
    ).toEqual({ available: false, reason: "expo_go" });
    expect(
      pushAvailability({ os: "ios", executionEnvironment: "storeClient", projectId: PROJECT }),
    ).toEqual({ available: false, reason: "expo_go" });
  });

  it("is not available before eas init has given the build a project id", () => {
    for (const projectId of [undefined, null, "", "   ", 42, {}]) {
      expect(
        pushAvailability({ os: "android", executionEnvironment: "standalone", projectId }),
      ).toEqual({ available: false, reason: "no_project" });
    }
  });

  it("reads an unknown execution environment as a build, and trims the project id", () => {
    expect(
      pushAvailability({ os: "ios", executionEnvironment: undefined, projectId: ` ${PROJECT} ` }),
    ).toEqual({ available: true, projectId: PROJECT });
  });
});
