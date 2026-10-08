/**
 * The seam between the pilot Worker and everything it drives. Routes, the queue consumer, the cron
 * handler, and the Durable Object take a `PilotRuntime` rather than importing services directly,
 * so a test can hand them fakes and no test needs a database, Telegram, LINE, or Anthropic.
 *
 * `pilotRuntime` is the only place the real services are wired into the pilot Worker, the API's
 * through `api` (`api-runtime.ts`); the admin Worker has its own seam in `admin-runtime.ts`.
 */
import type { ChannelQuota, InboundEvent } from "@vela/contracts";
import {
  applyRetention,
  type BilledChannel,
  claimDeadLetterReplays,
  type DeliveryResult,
  type Deps,
  deliverOutbound,
  deviceInboundEvent,
  handleInbound,
  ingestAnswerMedia,
  ingestExchangeMedia,
  joinWaitlist,
  keepDeadLetter,
  loadPublicPrecision,
  memberOfDeviceToken,
  opsAlerts,
  opsDigest,
  type ReconcileResult,
  reconcile,
  recordChannelQuota,
  releaseDeadLetterReplay,
  rollupMetrics,
  type SuggestionsRun,
  storeDeviceVoice,
  tickMember,
  understandAnswer,
  writeSuggestions,
} from "@vela/services";
import { type ApiHandler, createApiHandler } from "./api-runtime.ts";
import { type ClerkWebhookHandler, createClerkWebhookHandler } from "./clerk-webhook.ts";
import { buildDeps, createChannels, type DepsHandle, type DepsOptions } from "./deps.ts";
import type { PilotEnv } from "./env.ts";
import { PRIVACY_NOTICES } from "./notices.generated.ts";
import type { PrivacyNotices } from "./notices.ts";

/** Every services entry point the pilot Worker calls, and nothing else (code design §9). */
export interface PilotServices {
  handleInbound(deps: Deps, events: InboundEvent[]): Promise<void>;
  tickMember(deps: Deps, memberId: string): Promise<Date | null>;
  reconcile(deps: Deps): Promise<ReconcileResult>;
  recordChannelQuota(deps: Deps, channel: BilledChannel, quota: ChannelQuota): Promise<void>;
  rollupMetrics(deps: Deps): Promise<number>;
  applyRetention(deps: Deps): Promise<Record<string, number>>;
  /** The founder's ops alerts (each reconcile) and daily digest (nightly): plan 2.1 and 2.2. */
  opsAlerts(deps: Deps): Promise<number>;
  /** Dead jobs (plan 2.7): kept from the dead-letter queue, and the founder's replays. */
  keepDeadLetter: typeof keepDeadLetter;
  claimDeadLetterReplays: typeof claimDeadLetterReplays;
  releaseDeadLetterReplay: typeof releaseDeadLetterReplay;
  opsDigest(deps: Deps): Promise<boolean>;
  writeSuggestions(deps: Deps): Promise<SuggestionsRun>;
  deliverOutbound(deps: Deps, outboundId: string): Promise<DeliveryResult>;
  ingestAnswerMedia(deps: Deps, answerId: string): Promise<void>;
  ingestExchangeMedia(deps: Deps, mediaId: string): Promise<void>;
  understandAnswer(deps: Deps, answerId: string): Promise<void>;
  /** Her phone on the parent surface (ADR-35): who its token is, and her input as an event. */
  memberOfDeviceToken: typeof memberOfDeviceToken;
  deviceInboundEvent: typeof deviceInboundEvent;
  storeDeviceVoice: typeof storeDeviceVoice;
  /** Vela's monthly precision for the public website's "How Vela is doing". */
  loadPublicPrecision: typeof loadPublicPrecision;
  /** Someone asks, on the website, to hear when Vela opens. */
  joinWaitlist: typeof joinWaitlist;
}

export interface PilotRuntime {
  readonly services: PilotServices;
  /**
   * Deps for one invocation; the caller hands `close()` to `ctx.waitUntil`. Refuses, before it
   * opens anything, while a deployed environment's configuration or either notice is unfilled.
   */
  createDeps(env: PilotEnv, options?: DepsOptions): Promise<DepsHandle>;
  /**
   * The channel adapters, built before a webhook is verified; Telegram's registry is reused for its
   * deps, and LINE's webhook needs no deps at all.
   */
  createChannels: typeof createChannels;
  /** The notices `/privacy` and `/privacy/zh-TW` serve, and the ones `createDeps` checks. */
  readonly notices: PrivacyNotices;
  /** The API under /v1 (ADR-29): its own config check, limits and app; never `createDeps`. */
  readonly api: ApiHandler;
  readonly clerk: ClerkWebhookHandler;
}

const services: PilotServices = {
  handleInbound,
  tickMember,
  reconcile,
  recordChannelQuota,
  rollupMetrics,
  applyRetention,
  keepDeadLetter,
  claimDeadLetterReplays,
  releaseDeadLetterReplay,
  opsAlerts,
  opsDigest,
  writeSuggestions,
  deliverOutbound,
  ingestAnswerMedia,
  ingestExchangeMedia,
  understandAnswer,
  memberOfDeviceToken,
  deviceInboundEvent,
  storeDeviceVoice,
  loadPublicPrecision,
  joinWaitlist,
};

export const pilotRuntime: PilotRuntime = {
  services,
  createDeps: (env, options) => buildDeps(env, PRIVACY_NOTICES, options),
  createChannels,
  notices: PRIVACY_NOTICES,
  api: createApiHandler(),
  clerk: createClerkWebhookHandler(),
};
