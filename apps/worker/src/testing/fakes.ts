/**
 * The fakes every Worker test runs against. The Worker's job is wiring, so a test only has to see
 * which services entry point a route, a job, a cron, or an alarm called, and with what: services
 * are recorded rather than run, and no test opens a database, a socket, or a channel.
 */
import { env } from "cloudflare:test";
import { createFakeAi, createFakeStt } from "@vela/ai";
import type { ChannelAdapter, InboundEvent } from "@vela/contracts";
import type { Family, Member, VelaDatabase } from "@vela/db";
import type { Deps, FamilyPage } from "@vela/services";
import type { DepsHandle, DepsOptions } from "../deps.ts";
import type { Env } from "../env.ts";
import type { WorkerRuntime, WorkerServices } from "../runtime.ts";

/**
 * The bindings wrangler.jsonc declares, as the Worker's own `Env`. The runtime only knows them as
 * the generated `Cloudflare.Env`, which this package does not generate.
 */
export const testEnv = env as unknown as Env;

/** One recorded services call: its name and the arguments after `deps`. */
export interface ServiceCall {
  readonly name: keyof WorkerServices;
  readonly args: readonly unknown[];
}

export interface FakeRuntime {
  readonly runtime: WorkerRuntime;
  /** Every services call, in order. */
  readonly calls: ServiceCall[];
  /** How many times deps were built and closed; a leak shows as a difference. */
  built(): number;
  closed(): number;
  /** The events the webhook route handed to `handleInbound`. */
  readonly inbound: InboundEvent[];
}

export interface FakeRuntimeOptions {
  /** Replaces what a service returns or makes it throw; the call is still recorded. */
  readonly services?: Partial<WorkerServices>;
  /** What the Access verifier returns; null refuses the request. */
  readonly admin?: string | null;
  /** The events the fake Telegram adapter parses out of a verified request. */
  readonly events?: InboundEvent[];
  /** The secret the fake adapter accepts in `X-Telegram-Bot-Api-Secret-Token`. */
  readonly webhookSecret?: string;
}

// Only services read the database, and here every service is a recorder.
const UNUSED_DATABASE = {} as VelaDatabase;

function createFakeDeps(): Deps {
  return {
    db: UNUSED_DATABASE,
    clock: { now: () => new Date("2026-09-14T00:00:00Z") },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    random: { token: () => "token" },
    queues: {
      outbound: { send: async () => {} },
      media: { send: async () => {} },
      understand: { send: async () => {} },
    },
    scheduler: { wakeAt: async () => {} },
    media: { put: async () => {}, get: async () => null, delete: async () => {} },
    channels: { get: () => fakeAdapter([], "secret") },
    ai: createFakeAi(),
    stt: createFakeStt(),
    heartbeat: { ping: async () => {} },
    config: {
      telegramBotUsername: "VelaTestBot",
      adminConversationId: null,
      environment: "development",
      regions: ["apac"],
      publicBaseUrl: "https://worker.test",
      privacyNoticeUrls: {
        en: "https://vela.test/privacy",
        "zh-TW": "https://vela.test/zh-TW/privacy",
        ja: "https://vela.test/privacy",
        de: "https://vela.test/privacy",
        hi: "https://vela.test/privacy",
        ru: "https://vela.test/privacy",
      },
    },
  };
}

/** Verifies one secret and parses the events the test named; nothing else is implemented. */
function fakeAdapter(events: InboundEvent[], webhookSecret: string): ChannelAdapter {
  const unsupported = (): never => {
    throw new Error("the fake Telegram adapter only verifies and parses");
  };
  return {
    id: "telegram",
    capabilities: {
      buttons: true,
      voiceIn: true,
      voiceOut: true,
      readReceipts: false,
      reactions: true,
      albums: true,
    },
    verify: async (input) => input.headers.get("X-Telegram-Bot-Api-Secret-Token") === webhookSecret,
    parse: () => events,
    send: unsupported,
    acknowledgeButton: unsupported,
    closeButtons: unsupported,
    fetchMedia: unsupported,
  };
}

export function createFakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
  const calls: ServiceCall[] = [];
  const inbound: InboundEvent[] = [];
  const given = options.services ?? {};
  const events = options.events ?? [];
  const webhookSecret = options.webhookSecret ?? "test-webhook-secret";
  let built = 0;
  let closed = 0;

  const note = (name: keyof WorkerServices, ...args: unknown[]): void => {
    calls.push({ name, args });
  };

  const services: WorkerServices = {
    async handleInbound(deps, parsed) {
      note("handleInbound", parsed);
      inbound.push(...parsed);
      await given.handleInbound?.(deps, parsed);
    },
    async tickMember(deps, memberId) {
      note("tickMember", memberId);
      return given.tickMember === undefined ? null : given.tickMember(deps, memberId);
    },
    async reconcile(deps) {
      note("reconcile");
      return given.reconcile === undefined
        ? { ticked: 0, missed: 0, rerun: 0, effects: 0 }
        : given.reconcile(deps);
    },
    async rollupMetrics(deps) {
      note("rollupMetrics");
      return given.rollupMetrics === undefined ? 0 : given.rollupMetrics(deps);
    },
    async applyRetention(deps) {
      note("applyRetention");
      return given.applyRetention === undefined ? {} : given.applyRetention(deps);
    },
    async deliverOutbound(deps, outboundId) {
      note("deliverOutbound", outboundId);
      return given.deliverOutbound === undefined ? "sent" : given.deliverOutbound(deps, outboundId);
    },
    async ingestAnswerMedia(deps, answerId) {
      note("ingestAnswerMedia", answerId);
      await given.ingestAnswerMedia?.(deps, answerId);
    },
    async understandAnswer(deps, answerId) {
      note("understandAnswer", answerId);
      await given.understandAnswer?.(deps, answerId);
    },
    async loadAdminOverview(deps, ctx) {
      note("loadAdminOverview", ctx);
      return given.loadAdminOverview === undefined ? [] : given.loadAdminOverview(deps, ctx);
    },
    async loadFamilyPage(deps, ctx, familyId) {
      note("loadFamilyPage", ctx, familyId);
      return given.loadFamilyPage === undefined ? null : given.loadFamilyPage(deps, ctx, familyId);
    },
    async recordConsent(deps, ctx, input) {
      note("recordConsent", ctx, input);
      await given.recordConsent?.(deps, ctx, input);
    },
    async recordContactConsent(deps, ctx, input) {
      note("recordContactConsent", ctx, input);
      await given.recordContactConsent?.(deps, ctx, input);
    },
    async addContact(deps, ctx, input) {
      note("addContact", ctx, input);
      await given.addContact?.(deps, ctx, input);
    },
    async removeContact(deps, ctx, contactId) {
      note("removeContact", ctx, contactId);
      await given.removeContact?.(deps, ctx, contactId);
    },
    async setAway(deps, ctx, input) {
      note("setAway", ctx, input);
      await given.setAway?.(deps, ctx, input);
    },
    async endAway(deps, ctx, awayPeriodId) {
      note("endAway", ctx, awayPeriodId);
      await given.endAway?.(deps, ctx, awayPeriodId);
    },
    async markLeft(deps, ctx, memberId) {
      note("markLeft", ctx, memberId);
      await given.markLeft?.(deps, ctx, memberId);
    },
    async markDeceased(deps, ctx, memberId) {
      note("markDeceased", ctx, memberId);
      await given.markDeceased?.(deps, ctx, memberId);
    },
    async deleteFamily(deps, ctx, familyId) {
      note("deleteFamily", ctx, familyId);
      await given.deleteFamily?.(deps, ctx, familyId);
    },
    async sendWeeklyRead(deps, ctx, input) {
      note("sendWeeklyRead", ctx, input);
      return given.sendWeeklyRead === undefined ? "sent" : given.sendWeeklyRead(deps, ctx, input);
    },
  };

  const runtime: WorkerRuntime = {
    services,
    createDeps: async (_env: Env, depsOptions: DepsOptions = {}): Promise<DepsHandle> => {
      built += 1;
      const deps = createFakeDeps();
      return {
        deps: {
          ...deps,
          scheduler: depsOptions.scheduler ?? deps.scheduler,
          channels: depsOptions.channels ?? deps.channels,
        },
        close: async () => {
          closed += 1;
        },
      };
    },
    createChannels: () => ({ get: () => fakeAdapter(events, webhookSecret) }),
    access: async () => {
      const admin = options.admin === undefined ? "founder@vela.test" : options.admin;
      return admin === null ? null : { email: admin };
    },
  };

  return { runtime, calls, built: () => built, closed: () => closed, inbound };
}

/** A parsed inbound event, with only the fields a routing test needs to tell one from another. */
export function inboundEventFixture(overrides: Partial<InboundEvent> = {}): InboundEvent {
  return {
    channel: "telegram",
    eventId: "telegram:1",
    at: "2026-09-14T00:00:00.000Z",
    kind: "text",
    sender: { externalUserId: "9001" },
    conversation: { externalId: "-100123", kind: "group" },
    ...overrides,
  };
}

const FAMILY_ID = "11111111-1111-7111-8111-111111111111";

function familyFixture(overrides: Partial<Family> = {}): Family {
  return {
    id: FAMILY_ID,
    name: "The Chen family",
    region: "apac",
    country: "TW",
    language: "en",
    plan: "free",
    storyDay: 0,
    turnsEnabled: true,
    createdBy: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * A member as she is between her invitation and her Yes: in the family, no light, no consent. A
 * test that is about a later state overrides the fields that moved.
 */
export function memberFixture(overrides: Partial<Member> = {}): FamilyPage["members"][number] {
  return {
    member: {
      id: "22222222-2222-7222-8222-222222222222",
      familyId: FAMILY_ID,
      userId: null,
      role: "member",
      billing: false,
      displayName: "Mom",
      addressForm: null,
      language: "en",
      tz: "Asia/Taipei",
      country: "TW",
      ageBand: "elder",
      status: "invited",
      turnsIn: true,
      primarySurface: "telegram",
      lightOn: false,
      lightConsentedAt: null,
      lightConsentText: null,
      lightStartsOn: null,
      wakeTime: null,
      arrivalTime: "08:00",
      nextWakeAt: null,
      quietAfterMin: 360,
      learningUntil: null,
      answerStats: {},
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      leftAt: null,
      ...overrides,
    },
    link: null,
  };
}

/** An empty family page: a test adds only the rows the section it is about needs. */
export function familyPageFixture(overrides: Partial<FamilyPage> = {}): FamilyPage {
  return {
    family: familyFixture(),
    members: [],
    consents: [],
    nearbyContacts: [],
    awayPeriods: [],
    answers: [],
    flagged: [],
    notUnderstood: [],
    weeklyReads: [],
    aiCalls: [],
    ...overrides,
  };
}

/** The arguments of every call with this name, in order. */
export function argsOf(calls: readonly ServiceCall[], name: keyof WorkerServices): unknown[][] {
  return calls.filter((call) => call.name === name).map((call) => [...call.args]);
}

/** The names of the services calls, in order: what the handler actually reached for. */
export function namesOf(calls: readonly ServiceCall[]): string[] {
  return calls.map((call) => call.name);
}
