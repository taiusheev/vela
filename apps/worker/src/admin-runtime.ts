/**
 * The seam between the admin Worker and services (H2). The admin routes take an `AdminRuntime`, so
 * a test hands them fakes; `adminRuntime` is the only place the real admin actions and reads are
 * wired in.
 *
 * The admin Worker holds only `AdminDeps`. Its routes and `AdminServices` are typed on those ports,
 * so nothing in this Worker can reach for a channel, the media bucket, or the other queues: the
 * code does not compile. Services' own functions still take a whole `Deps`, so `servicesDeps` hands
 * them one in which every port the admin Worker was not given throws `PortNotGivenError`, naming
 * the port, the moment it is touched. A change in services that starts using one fails loudly on
 * the admin page (`request_failed` with `PortNotGivenError:<port>`) rather than doing nothing.
 */
import {
  type AddContactInput,
  type AdminContext,
  type AdminOverviewRow,
  addContact,
  type Config,
  type CreateInviteInput,
  createInvite,
  type Deps,
  deleteFamily,
  endAway,
  type FailedOutboundRow,
  type FamilyPage,
  loadAdminOverview,
  loadFailedOutbound,
  loadFamilyPage,
  markDeceased,
  markLeft,
  type RecordConsentInput,
  type RecordContactConsentInput,
  recordConsent,
  recordContactConsent,
  removeContact,
  type SendWeeklyReadInput,
  type SendWeeklyReadResult,
  type SetAwayInput,
  sendWeeklyRead,
  setAway,
} from "@vela/services";
import { type AccessVerifier, createAccessVerifier } from "./access.ts";
import { type AdminDeps, type AdminDepsHandle, buildAdminDeps } from "./deps.ts";
import type { AdminEnv } from "./env.ts";

/** Every services entry point the admin Worker calls, on the ports it holds (code design §9). */
export interface AdminServices {
  loadAdminOverview(deps: AdminDeps, ctx: AdminContext): Promise<AdminOverviewRow[]>;
  loadFailedOutbound(deps: AdminDeps, ctx: AdminContext): Promise<FailedOutboundRow[]>;
  loadFamilyPage(deps: AdminDeps, ctx: AdminContext, familyId: string): Promise<FamilyPage | null>;
  recordConsent(deps: AdminDeps, ctx: AdminContext, input: RecordConsentInput): Promise<void>;
  recordContactConsent(
    deps: AdminDeps,
    ctx: AdminContext,
    input: RecordContactConsentInput,
  ): Promise<void>;
  addContact(deps: AdminDeps, ctx: AdminContext, input: AddContactInput): Promise<void>;
  removeContact(deps: AdminDeps, ctx: AdminContext, contactId: string): Promise<void>;
  setAway(deps: AdminDeps, ctx: AdminContext, input: SetAwayInput): Promise<void>;
  endAway(deps: AdminDeps, ctx: AdminContext, awayPeriodId: string): Promise<void>;
  markLeft(deps: AdminDeps, ctx: AdminContext, memberId: string): Promise<void>;
  markDeceased(deps: AdminDeps, ctx: AdminContext, memberId: string): Promise<void>;
  deleteFamily(deps: AdminDeps, ctx: AdminContext, familyId: string): Promise<void>;
  sendWeeklyRead(
    deps: AdminDeps,
    ctx: AdminContext,
    input: SendWeeklyReadInput,
  ): Promise<SendWeeklyReadResult>;
  createInvite(deps: AdminDeps, ctx: AdminContext, input: CreateInviteInput): Promise<void>;
}

export interface AdminRuntime {
  readonly services: AdminServices;
  /** The admin ports for one request; the caller hands `close()` to `ctx.waitUntil`. */
  createDeps(env: AdminEnv): Promise<AdminDepsHandle>;
  /** Cloudflare Access: the admin identity, or null when the request carries no valid token. */
  readonly access: AccessVerifier;
}

/** A port services reached for that the admin Worker was not given; the code is the port. */
export class PortNotGivenError extends Error {
  override readonly name = "PortNotGivenError";
  readonly code: string;

  constructor(port: string) {
    super(`the admin Worker has no ${port} port`);
    this.code = port;
  }
}

function notGiven(port: string): never {
  throw new PortNotGivenError(port);
}

/**
 * Services' `Config` is the pilot Worker's. The admin Worker knows one field of it, the bot a new
 * invite's link opens; reading any other is reaching for a port.
 */
function adminConfig(telegramBotUsername: string): Config {
  return {
    telegramBotUsername,
    get adminConversationId(): never {
      return notGiven("config");
    },
    get environment(): never {
      return notGiven("config");
    },
    get regions(): never {
      return notGiven("config");
    },
    get publicBaseUrl(): never {
      return notGiven("config");
    },
    get privacyNoticeUrls(): never {
      return notGiven("config");
    },
    get privacyNoticeVersion(): never {
      return notGiven("config");
    },
  };
}

/**
 * The `Deps` services' signatures ask for, made of the admin ports: the ports given are passed on
 * as they are, and every other one throws `PortNotGivenError` when it is used.
 */
export function servicesDeps(ports: AdminDeps): Deps {
  return {
    db: ports.db,
    clock: ports.clock,
    logger: ports.logger,
    scheduler: ports.scheduler,
    ai: ports.ai,
    queues: {
      outbound: ports.queues.outbound,
      media: { send: () => notGiven("queues.media") },
      understand: { send: () => notGiven("queues.understand") },
    },
    random: ports.random,
    media: {
      put: () => notGiven("media"),
      get: () => notGiven("media"),
      delete: () => notGiven("media"),
    },
    channels: { get: () => notGiven("channels") },
    stt: { transcribe: () => notGiven("stt") },
    heartbeat: { ping: () => notGiven("heartbeat") },
    config: adminConfig(ports.telegramBotUsername),
  };
}

const services: AdminServices = {
  loadAdminOverview: (deps, ctx) => loadAdminOverview(servicesDeps(deps), ctx),
  loadFailedOutbound: (deps, ctx) => loadFailedOutbound(servicesDeps(deps), ctx),
  loadFamilyPage: (deps, ctx, familyId) => loadFamilyPage(servicesDeps(deps), ctx, familyId),
  recordConsent: (deps, ctx, input) => recordConsent(servicesDeps(deps), ctx, input),
  recordContactConsent: (deps, ctx, input) => recordContactConsent(servicesDeps(deps), ctx, input),
  addContact: (deps, ctx, input) => addContact(servicesDeps(deps), ctx, input),
  removeContact: (deps, ctx, contactId) => removeContact(servicesDeps(deps), ctx, contactId),
  setAway: (deps, ctx, input) => setAway(servicesDeps(deps), ctx, input),
  endAway: (deps, ctx, awayPeriodId) => endAway(servicesDeps(deps), ctx, awayPeriodId),
  markLeft: (deps, ctx, memberId) => markLeft(servicesDeps(deps), ctx, memberId),
  markDeceased: (deps, ctx, memberId) => markDeceased(servicesDeps(deps), ctx, memberId),
  deleteFamily: (deps, ctx, familyId) => deleteFamily(servicesDeps(deps), ctx, familyId),
  sendWeeklyRead: (deps, ctx, input) => sendWeeklyRead(servicesDeps(deps), ctx, input),
  createInvite: (deps, ctx, input) => createInvite(servicesDeps(deps), ctx, input),
};

export const adminRuntime: AdminRuntime = {
  services,
  createDeps: buildAdminDeps,
  access: createAccessVerifier(),
};
