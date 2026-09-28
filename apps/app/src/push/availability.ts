/**
 * Whether this build of the app can receive pushes at all (ADR-34, A1). Three builds cannot: the
 * web, which has no Vela notifications; Expo Go, which has had no remote push since SDK 53, so its
 * permission prompt would work and its token call then fail, leaving an organiser believing she
 * will be told; and a build with no EAS project id (`eas init` not yet run), for which Expo can mint
 * no token. Where it is false nothing is registered, nothing is asked, and You says so. Pure, so
 * the rule is tested apart from the phone.
 */

export type PushUnavailable = "web" | "expo_go" | "no_project";

export type PushAvailability =
  | { available: true; projectId: string }
  | { available: false; reason: PushUnavailable };

export interface BuildFacts {
  /** `Platform.OS`. */
  os: string;
  /** `Constants.executionEnvironment`: "storeClient" is Expo Go; "bare" and "standalone" are builds. */
  executionEnvironment: string | undefined;
  /** `extra.eas.projectId` from the app config, as `eas init` writes it, or whatever stands there. */
  projectId: unknown;
}

/** Expo Go's execution environment (`ExecutionEnvironment.StoreClient` in expo-constants). */
const EXPO_GO = "storeClient";

export function pushAvailability(facts: BuildFacts): PushAvailability {
  if (facts.os === "web") return { available: false, reason: "web" };
  if (facts.executionEnvironment === EXPO_GO) return { available: false, reason: "expo_go" };
  const projectId = typeof facts.projectId === "string" ? facts.projectId.trim() : "";
  if (projectId.length === 0) return { available: false, reason: "no_project" };
  return { available: true, projectId };
}
