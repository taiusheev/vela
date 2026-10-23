import type { AnalyticsScreen, UsageEvent } from "./events.ts";
import { usagePayload } from "./events.ts";

const token = process.env.EXPO_PUBLIC_POSTHOG_TOKEN;
const region = process.env.EXPO_PUBLIC_POSTHOG_REGION;
const environment = process.env.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT;
export const analyticsConfigured =
  /^phc_[A-Za-z0-9]+$/.test(token ?? "") &&
  (region === "eu" || region === "us") &&
  (environment === "staging" || environment === "production") &&
  process.env.EXPO_PUBLIC_DEMO_MODE !== "true" &&
  !!process.env.EXPO_PUBLIC_API_URL;
let identity: string | null = null;
const pending = new Set<AbortController>();
export function setAnalyticsIdentity(id: string | null) {
  for (const request of pending) request.abort();
  pending.clear();
  identity = id;
}
export function captureUsage(
  event: UsageEvent,
  screen?: AnalyticsScreen,
  seconds?: number,
  expectedId?: string,
): void {
  if (!analyticsConfigured || !identity) return;
  if (expectedId !== undefined && expectedId !== identity) return;
  const payload = usagePayload(identity, event, screen, seconds);
  if (!payload) return;
  const controller = new AbortController();
  pending.add(controller);
  const timer = setTimeout(() => controller.abort(), 3000);
  void fetch(`https://${region}.i.posthog.com/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: token,
      ...payload,
      properties: { ...payload.properties, environment },
    }),
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      pending.delete(controller);
    });
}
