/**
 * The seam between the Worker and everything it drives. Routes, the queue consumer, the cron
 * handler, and the Durable Object take a `WorkerRuntime` rather than importing services directly,
 * so a test can hand them fakes and no test needs a database, Telegram, or Anthropic.
 *
 * `productionRuntime` is the only place the real services are wired in.
 */
import type { InboundEvent } from "@vela/contracts";
import {
  type AddContactInput,
  type AdminContext,
  type AdminOverviewRow,
  addContact,
  applyRetention,
  type DeliveryResult,
  type Deps,
  deleteFamily,
  deliverOutbound,
  endAway,
  type FamilyPage,
  handleInbound,
  ingestAnswerMedia,
  loadAdminOverview,
  loadFamilyPage,
  markDeceased,
  markLeft,
  type ReconcileResult,
  type RecordConsentInput,
  type RecordContactConsentInput,
  reconcile,
  recordConsent,
  recordContactConsent,
  removeContact,
  rollupMetrics,
  type SendWeeklyReadInput,
  type SendWeeklyReadResult,
  type SetAwayInput,
  sendWeeklyRead,
  setAway,
  tickMember,
  understandAnswer,
} from "@vela/services";
import { type AccessVerifier, createAccessVerifier } from "./access.ts";
import { buildDeps, createChannels, type DepsHandle, type DepsOptions } from "./deps.ts";
import type { Env } from "./env.ts";

/** Every services entry point the Worker calls, and nothing else (code design §9). */
export interface WorkerServices {
  handleInbound(deps: Deps, events: InboundEvent[]): Promise<void>;
  tickMember(deps: Deps, memberId: string): Promise<Date | null>;
  reconcile(deps: Deps): Promise<ReconcileResult>;
  rollupMetrics(deps: Deps): Promise<number>;
  applyRetention(deps: Deps): Promise<Record<string, number>>;
  deliverOutbound(deps: Deps, outboundId: string): Promise<DeliveryResult>;
  ingestAnswerMedia(deps: Deps, answerId: string): Promise<void>;
  understandAnswer(deps: Deps, answerId: string): Promise<void>;
  loadAdminOverview(deps: Deps, ctx: AdminContext): Promise<AdminOverviewRow[]>;
  loadFamilyPage(deps: Deps, ctx: AdminContext, familyId: string): Promise<FamilyPage | null>;
  recordConsent(deps: Deps, ctx: AdminContext, input: RecordConsentInput): Promise<void>;
  recordContactConsent(
    deps: Deps,
    ctx: AdminContext,
    input: RecordContactConsentInput,
  ): Promise<void>;
  addContact(deps: Deps, ctx: AdminContext, input: AddContactInput): Promise<void>;
  removeContact(deps: Deps, ctx: AdminContext, contactId: string): Promise<void>;
  setAway(deps: Deps, ctx: AdminContext, input: SetAwayInput): Promise<void>;
  endAway(deps: Deps, ctx: AdminContext, awayPeriodId: string): Promise<void>;
  markLeft(deps: Deps, ctx: AdminContext, memberId: string): Promise<void>;
  markDeceased(deps: Deps, ctx: AdminContext, memberId: string): Promise<void>;
  deleteFamily(deps: Deps, ctx: AdminContext, familyId: string): Promise<void>;
  sendWeeklyRead(
    deps: Deps,
    ctx: AdminContext,
    input: SendWeeklyReadInput,
  ): Promise<SendWeeklyReadResult>;
}

export interface WorkerRuntime {
  readonly services: WorkerServices;
  /** Deps for one invocation; the caller hands `close()` to `ctx.waitUntil`. */
  createDeps(env: Env, options?: DepsOptions): Promise<DepsHandle>;
  /** The channel adapters, built before a webhook is verified and reused for its deps. */
  createChannels: typeof createChannels;
  /** Cloudflare Access: the admin identity, or null when the request carries no valid token. */
  readonly access: AccessVerifier;
}

const services: WorkerServices = {
  handleInbound,
  tickMember,
  reconcile,
  rollupMetrics,
  applyRetention,
  deliverOutbound,
  ingestAnswerMedia,
  understandAnswer,
  loadAdminOverview,
  loadFamilyPage,
  recordConsent,
  recordContactConsent,
  addContact,
  removeContact,
  setAway,
  endAway,
  markLeft,
  markDeceased,
  deleteFamily,
  sendWeeklyRead,
};

export const productionRuntime: WorkerRuntime = {
  services,
  createDeps: buildDeps,
  createChannels,
  access: createAccessVerifier(),
};
