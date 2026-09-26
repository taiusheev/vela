/**
 * The fakes every Worker test runs against. Both Workers' job is wiring, so a test only has to see
 * which services entry point a route, a job, a cron, or an alarm called, and with what: services
 * are recorded rather than run, and no test opens a database, a socket, or a channel.
 */
import { env } from "cloudflare:test";
import { createFakeAi, createFakeStt } from "@vela/ai";
import type { ChannelAdapter, InboundEvent } from "@vela/contracts";
import type { Family, Member, VelaDatabase } from "@vela/db";
import type { Deps, FamilyPage, Logger } from "@vela/services";
import { vi } from "vitest";
import type { AdminRuntime, AdminServices } from "../admin-runtime.ts";
import type { ApiHandler } from "../api-runtime.ts";
import {
  type AdminDeps,
  type AdminDepsHandle,
  createChannels,
  type DepsHandle,
  type DepsOptions,
} from "../deps.ts";
import type { AdminEnv, PilotEnv } from "../env.ts";
import type { PrivacyNotices } from "../notices.ts";
import type { PilotRuntime, PilotServices } from "../runtime.ts";

/**
 * The bindings wrangler.jsonc declares, as the pilot Worker's own `Env`. The runtime only knows
 * them as the generated `Cloudflare.Env`, which this package does not generate.
 */
export const testEnv = env as unknown as PilotEnv;

/**
 * A local R2 bucket of the test runtime's own (vitest.config.ts), which no wrangler file declares:
 * the media route reads it where a deployed Worker reads `MEDIA_BUCKET`, so ranges are answered as
 * R2 answers them.
 */
export const testMediaBucket = (env as unknown as { readonly TEST_MEDIA_BUCKET: R2Bucket })
  .TEST_MEDIA_BUCKET;

/**
 * LINE's settings as a test that turns LINE on gives them. Each is shaped like the real one and
 * distinctive, so a leak into a log line or an answer is easy to find.
 */
export const TEST_LINE = {
  channelSecret: "5c1d0a7e3b9f4c2d8e6a1b0f9d3c7e2a",
  channelAccessToken: "vElAtEsTlInE+aCcEsS/tOkEn0123456789abcdefghijklmnopqrstuvwxyz=",
  mediaUrlSecret: "tEsTmEdIaUrLsEcReT-0123456789abcdefghijklmnopqrstuv",
  basicId: "@123velatest",
  pilotOrigin: "https://vela.worker.test",
} as const;

/** A queue that keeps what it is sent in `sent`, or refuses every send with `failure`. */
export function recordingQueue<J>(sent: J[], failure?: Error): Queue<J> {
  return {
    send: async (job: J) => {
      if (failure !== undefined) {
        throw failure;
      }
      sent.push(job);
    },
    sendBatch: async () => {
      throw new Error("the fake queue takes one job at a time");
    },
  } as unknown as Queue<J>;
}

/**
 * Development with LINE on, as a laptop that tried it would have it: every LINE setting given, the
 * test runtime's bucket for media, and a recording inbound queue unless the test hands its own.
 */
export function lineOnEnv(overrides: Partial<PilotEnv> = {}): PilotEnv {
  return {
    ...testEnv,
    LINE_CHANNEL: "on",
    LINE_BOT_BASIC_ID: TEST_LINE.basicId,
    PILOT_PUBLIC_URL: TEST_LINE.pilotOrigin,
    LINE_CHANNEL_SECRET: TEST_LINE.channelSecret,
    LINE_CHANNEL_ACCESS_TOKEN: TEST_LINE.channelAccessToken,
    MEDIA_URL_SECRET: TEST_LINE.mediaUrlSecret,
    MEDIA_STORAGE: "r2",
    MEDIA_BUCKET: testMediaBucket,
    INBOUND_QUEUE: recordingQueue([]),
    ...overrides,
  };
}

const UTF8 = new TextEncoder();

/**
 * What LINE puts in `x-line-signature` for `rawBody`: Base64(HMAC-SHA256(channel secret, body)),
 * made here with Web Crypto directly rather than with the adapter's verifier.
 */
export async function signLineBody(
  rawBody: string,
  channelSecret: string = TEST_LINE.channelSecret,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    UTF8.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, UTF8.encode(rawBody)));
  return btoa(String.fromCharCode(...mac));
}

/**
 * The admin Worker's environment on a laptop. The pool runs the pilot Worker's configuration, so
 * the bindings the admin Worker shares with it (the scheduler namespace, the outbound queue, and
 * Hyperdrive) are the pilot's own, as in a deployed environment, where they name the same resources.
 */
export const adminTestEnv: AdminEnv = {
  ENVIRONMENT: "development",
  PUBLIC_BASE_URL: "http://localhost:8787",
  TELEGRAM_BOT_USERNAME: testEnv.TELEGRAM_BOT_USERNAME,
  AI_PROVIDER: testEnv.AI_PROVIDER,
  ANTHROPIC_API_KEY: "test-anthropic-key",
  LINE_CHANNEL: testEnv.LINE_CHANNEL,
  ACCESS_TEAM_DOMAIN: "vela-test.cloudflareaccess.com",
  ACCESS_AUD: "test-audience",
  HYPERDRIVE: testEnv.HYPERDRIVE,
  MEMBER_SCHEDULER: testEnv.MEMBER_SCHEDULER,
  OUTBOUND_QUEUE: testEnv.OUTBOUND_QUEUE,
};

/** One object in a fake bucket, as `createMediaStore` writes and reads it. */
export interface FakeR2Object {
  readonly body: ArrayBuffer;
  readonly mime: string;
}

/**
 * An R2 bucket with the three operations the media port uses, over a map the test reads. The pool's
 * runtime binds no real one: development's `MEDIA_STORAGE` is "off" (decision M), so wrangler.jsonc
 * declares no `r2_buckets` there, exactly as a deployed environment with storage off declares none.
 */
export function fakeR2Bucket(objects: Map<string, FakeR2Object>): R2Bucket {
  return {
    put: async (
      key: string,
      body: ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      objects.set(key, { body, mime: options?.httpMetadata?.contentType ?? "" });
    },
    get: async (key: string) => {
      const object = objects.get(key);
      return object === undefined
        ? null
        : {
            arrayBuffer: async () => object.body,
            httpMetadata: { contentType: object.mime },
          };
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
  } as unknown as R2Bucket;
}

/** Every services entry point either Worker calls. */
type ServiceName = keyof PilotServices | keyof AdminServices;

/** One recorded services call: its name and the arguments after `deps`. */
export interface ServiceCall {
  readonly name: ServiceName;
  readonly args: readonly unknown[];
}

/** One line a `Logger` was given. */
export interface LogLine {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly fields: Record<string, unknown> | undefined;
}

/** What a fake runtime recorded, whichever Worker it is for. */
interface Recording {
  /** Every services call, in order. */
  readonly calls: ServiceCall[];
  /** How many times deps were built and closed; a leak shows as a difference. */
  built(): number;
  closed(): number;
  /** Every line the deps' logger was given, in order. */
  readonly logs: LogLine[];
}

export interface FakePilotRuntime extends Recording {
  readonly runtime: PilotRuntime;
  /** The events the webhook route handed to `handleInbound`. */
  readonly inbound: InboundEvent[];
  /** Every request handed to `api`, as `"<METHOD> <pathname>"`, in order. */
  readonly apiRequests: string[];
  /** How many channel registries a route built: a route that read nothing built none. */
  channelsBuilt(): number;
}

export interface FakeAdminRuntime extends Recording {
  readonly runtime: AdminRuntime;
}

export interface FakePilotRuntimeOptions {
  /** Replaces what a service returns or makes it throw; the call is still recorded. */
  readonly services?: Partial<PilotServices>;
  /**
   * The events the fake Telegram adapter parses out of a verified request. LINE's adapter is the
   * real one, built from the environment, so its signatures and its parsing are LINE's own.
   */
  readonly events?: InboundEvent[];
  /** The secret the fake adapter accepts in `X-Telegram-Bot-Api-Secret-Token`. */
  readonly webhookSecret?: string;
  /** The notices the routes serve; `noticesFixture()` when left out. */
  readonly notices?: PrivacyNotices;
  /** Answers what is handed to `api`, which is still recorded; a 204 when left out. */
  readonly api?: ApiHandler;
}

export interface FakeAdminRuntimeOptions {
  /** Replaces what a service returns or makes it throw; the call is still recorded. */
  readonly services?: Partial<AdminServices>;
  /** What the Access verifier returns; null refuses the request. */
  readonly admin?: string | null;
}

// Only services read the database, and here every service is a recorder.
const UNUSED_DATABASE = {} as VelaDatabase;

const FAKE_NOW = new Date("2026-09-14T00:00:00Z");

/** A `Logger` that keeps every line it is given in `logs`. */
export function recordingLogger(logs: LogLine[]): Logger {
  return {
    info: (event, fields) => logs.push({ level: "info", event, fields }),
    warn: (event, fields) => logs.push({ level: "warn", event, fields }),
    error: (event, fields) => logs.push({ level: "error", event, fields }),
  };
}

function createFakeDeps(logs: LogLine[]): Deps {
  return {
    db: UNUSED_DATABASE,
    clock: { now: () => FAKE_NOW },
    logger: recordingLogger(logs),
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
      publicBaseUrl: "https://vela-admin.worker.test",
      privacyNoticeUrls: {
        en: "https://vela.worker.test/privacy",
        "zh-TW": "https://vela.worker.test/privacy/zh-TW",
        ja: "https://vela.worker.test/privacy",
        de: "https://vela.worker.test/privacy",
        hi: "https://vela.worker.test/privacy",
        ru: "https://vela.worker.test/privacy",
      },
      privacyNoticeVersion: "privacy-notice.v1",
    },
  };
}

/** The admin ports, each a recorder or a fake: the admin Worker is given nothing else. */
export function createFakeAdminDeps(logs: LogLine[]): AdminDeps {
  return {
    db: UNUSED_DATABASE,
    clock: { now: () => FAKE_NOW },
    logger: recordingLogger(logs),
    queues: { outbound: { send: async () => {} } },
    scheduler: { wakeAt: async () => {} },
    ai: createFakeAi(),
    random: { token: () => "token" },
    telegramBotUsername: "VelaTestBot",
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
      editMessages: true,
      resendsProviderFiles: true,
      mediaByUrl: false,
      mediaReplies: true,
    },
    verify: async (input) => input.headers.get("X-Telegram-Bot-Api-Secret-Token") === webhookSecret,
    parse: () => events,
    send: unsupported,
    acknowledgeButton: unsupported,
    closeButtons: unsupported,
    fetchMedia: unsupported,
  };
}

/** Both notices as a filled-in notice would be: no blank left in either. */
export function noticesFixture(): PrivacyNotices {
  return {
    en: {
      title: "Vela pilot: privacy notice",
      html: "<h1>Vela pilot: privacy notice</h1>\n<p>Vela is run by <strong>Mei Lin</strong>.</p>",
      version: "privacy-notice.v1",
    },
    "zh-TW": {
      title: "Vela 試辦計畫：隱私權告知事項",
      html: "<h1>Vela 試辦計畫：隱私權告知事項</h1>\n<p>Vela 由 <strong>林美</strong> 經營。</p>",
      version: "privacy-notice.v1",
    },
  };
}

function createRecording(): Recording & {
  note(name: ServiceName, ...args: unknown[]): void;
  build(): void;
  close(): void;
} {
  const calls: ServiceCall[] = [];
  const logs: LogLine[] = [];
  let built = 0;
  let closed = 0;
  return {
    calls,
    logs,
    built: () => built,
    closed: () => closed,
    note: (name, ...args) => {
      calls.push({ name, args });
    },
    build: () => {
      built += 1;
    },
    close: () => {
      closed += 1;
    },
  };
}

export function createFakePilotRuntime(options: FakePilotRuntimeOptions = {}): FakePilotRuntime {
  const recording = createRecording();
  const { note } = recording;
  const inbound: InboundEvent[] = [];
  const apiRequests: string[] = [];
  const given = options.services ?? {};
  const events = options.events ?? [];
  const webhookSecret = options.webhookSecret ?? "test-webhook-secret";
  const api = options.api;
  let channelsBuilt = 0;

  const services: PilotServices = {
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
    async writeSuggestions(deps) {
      note("writeSuggestions");
      return given.writeSuggestions === undefined
        ? { written: 0, existing: 0, claimed: 0, inactive: 0, failed: 0 }
        : given.writeSuggestions(deps);
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
  };

  const runtime: PilotRuntime = {
    services,
    createDeps: async (_env: PilotEnv, depsOptions: DepsOptions = {}): Promise<DepsHandle> => {
      recording.build();
      const deps = createFakeDeps(recording.logs);
      return {
        deps: {
          ...deps,
          scheduler: depsOptions.scheduler ?? deps.scheduler,
          channels: depsOptions.channels ?? deps.channels,
        },
        close: async () => {
          recording.close();
        },
      };
    },
    createChannels: (pilotEnv) => {
      channelsBuilt += 1;
      return {
        get: (channel) =>
          channel === "line"
            ? createChannels(pilotEnv).get("line")
            : fakeAdapter(events, webhookSecret),
      };
    },
    notices: options.notices ?? noticesFixture(),
    api: async (request, env) => {
      apiRequests.push(`${request.method} ${new URL(request.url).pathname}`);
      return api === undefined ? new Response(null, { status: 204 }) : api(request, env);
    },
  };

  return {
    ...recording,
    runtime,
    inbound,
    apiRequests,
    channelsBuilt: () => channelsBuilt,
  };
}

export function createFakeAdminRuntime(options: FakeAdminRuntimeOptions = {}): FakeAdminRuntime {
  const recording = createRecording();
  const { note } = recording;
  const given = options.services ?? {};

  const services: AdminServices = {
    async loadAdminOverview(deps, ctx) {
      note("loadAdminOverview", ctx);
      return given.loadAdminOverview === undefined ? [] : given.loadAdminOverview(deps, ctx);
    },
    async loadFailedOutbound(deps, ctx) {
      note("loadFailedOutbound", ctx);
      return given.loadFailedOutbound === undefined ? [] : given.loadFailedOutbound(deps, ctx);
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
    async createInvite(deps, ctx, input) {
      note("createInvite", ctx, input);
      await given.createInvite?.(deps, ctx, input);
    },
  };

  const runtime: AdminRuntime = {
    services,
    createDeps: async (_env: AdminEnv): Promise<AdminDepsHandle> => {
      recording.build();
      return {
        deps: createFakeAdminDeps(recording.logs),
        close: async () => {
          recording.close();
        },
      };
    },
    access: async () => {
      const admin = options.admin === undefined ? "founder@vela.test" : options.admin;
      return admin === null ? null : { email: admin };
    },
  };

  return { ...recording, runtime };
}

/**
 * What a failed query throws: Drizzle's message lists the query's parameters, which hold what the
 * family wrote, and the driver's error beneath it carries the SQLSTATE. The words in it are the
 * ones a log line must never contain.
 */
export const FAILED_QUERY_WORDS = "walked to the market with Mei";

export function failedQueryFixture(): Error {
  const driver = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
  const failed = new Error(
    `Failed query: insert into "answers" ("payload") values ($1)\nparams: {"text":"I ${FAILED_QUERY_WORDS}"}`,
    { cause: driver },
  );
  failed.name = "DrizzleQueryError";
  return failed;
}

/** `errorLabel` of `failedQueryFixture()`: the class names and the code, nothing else. */
export const FAILED_QUERY_LABEL = "DrizzleQueryError <- Error:23505";

/**
 * What `run` returned, and the JSON lines written to `console.log` while it ran, parsed: where a
 * Worker logs without a fake `Logger` (the request error handler, and the logger `createLogger`
 * builds), this is its log.
 */
export async function consoleLinesDuring<T>(
  run: () => Promise<T>,
): Promise<{ readonly result: T; readonly lines: unknown[] }> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const result = await run();
    return { result, lines: spy.mock.calls.map(([line]): unknown => JSON.parse(String(line))) };
  } finally {
    spy.mockRestore();
  }
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
export function argsOf(calls: readonly ServiceCall[], name: ServiceName): unknown[][] {
  return calls.filter((call) => call.name === name).map((call) => [...call.args]);
}

/** The names of the services calls, in order: what the handler actually reached for. */
export function namesOf(calls: readonly ServiceCall[]): string[] {
  return calls.map((call) => call.name);
}
