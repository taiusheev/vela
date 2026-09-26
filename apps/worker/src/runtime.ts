/**
 * The seam between the pilot Worker and everything it drives. Routes, the queue consumer, the cron
 * handler, and the Durable Object take a `PilotRuntime` rather than importing services directly,
 * so a test can hand them fakes and no test needs a database, Telegram, or Anthropic.
 *
 * `pilotRuntime` is the only place the real services are wired into the pilot Worker, the API's
 * through `api` (`api-runtime.ts`); the admin Worker has its own seam in `admin-runtime.ts`.
 */
import type { InboundEvent } from "@vela/contracts";
import {
  applyRetention,
  type DeliveryResult,
  type Deps,
  deliverOutbound,
  handleInbound,
  ingestAnswerMedia,
  type ReconcileResult,
  reconcile,
  rollupMetrics,
  type SuggestionsRun,
  tickMember,
  understandAnswer,
  writeSuggestions,
} from "@vela/services";
import { type ApiHandler, createApiHandler } from "./api-runtime.ts";
import { buildDeps, createChannels, type DepsHandle, type DepsOptions } from "./deps.ts";
import type { PilotEnv } from "./env.ts";
import { PRIVACY_NOTICES } from "./notices.generated.ts";
import type { PrivacyNotices } from "./notices.ts";

/** Every services entry point the pilot Worker calls, and nothing else (code design §9). */
export interface PilotServices {
  handleInbound(deps: Deps, events: InboundEvent[]): Promise<void>;
  tickMember(deps: Deps, memberId: string): Promise<Date | null>;
  reconcile(deps: Deps): Promise<ReconcileResult>;
  rollupMetrics(deps: Deps): Promise<number>;
  applyRetention(deps: Deps): Promise<Record<string, number>>;
  writeSuggestions(deps: Deps): Promise<SuggestionsRun>;
  deliverOutbound(deps: Deps, outboundId: string): Promise<DeliveryResult>;
  ingestAnswerMedia(deps: Deps, answerId: string): Promise<void>;
  understandAnswer(deps: Deps, answerId: string): Promise<void>;
}

export interface PilotRuntime {
  readonly services: PilotServices;
  /**
   * Deps for one invocation; the caller hands `close()` to `ctx.waitUntil`. Refuses, before it
   * opens anything, while a deployed environment's configuration or either notice is unfilled.
   */
  createDeps(env: PilotEnv, options?: DepsOptions): Promise<DepsHandle>;
  /** The channel adapters, built before a webhook is verified and reused for its deps. */
  createChannels: typeof createChannels;
  /** The notices `/privacy` and `/privacy/zh-TW` serve, and the ones `createDeps` checks. */
  readonly notices: PrivacyNotices;
  /** The API under /v1 (ADR-29): its own config check, limits and app; never `createDeps`. */
  readonly api: ApiHandler;
}

const services: PilotServices = {
  handleInbound,
  tickMember,
  reconcile,
  rollupMetrics,
  applyRetention,
  writeSuggestions,
  deliverOutbound,
  ingestAnswerMedia,
  understandAnswer,
};

export const pilotRuntime: PilotRuntime = {
  services,
  createDeps: (env, options) => buildDeps(env, PRIVACY_NOTICES, options),
  createChannels,
  notices: PRIVACY_NOTICES,
  api: createApiHandler(),
};
