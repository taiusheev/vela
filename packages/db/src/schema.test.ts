import { createHash } from "node:crypto";
import {
  ADMIN_ACTIONS,
  AGE_BANDS,
  ANSWER_KINDS,
  AWAY_SOURCES,
  BUDGETED_OUTBOUND_KINDS,
  CHANNELS,
  CONSENT_ANSWERS,
  CONSENT_KINDS,
  EVENT_NAMES,
  EXCHANGE_STATES,
  EXCHANGE_TYPES,
  LANGS,
  MEDIA_KINDS,
  MEMBER_STATUSES,
  OUTBOUND_KINDS,
  OUTBOUND_STATUSES,
  type OutboundKind,
  PLANS,
  QUIET_OUTCOMES,
  REGIONS,
  REPLY_KINDS,
  ROLES,
  SURFACES,
  WHEN_RULES,
} from "@vela/contracts";
import { and, eq, getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import type { VelaDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import {
  adminAccessLog,
  aiCalls,
  answers,
  awayPeriods,
  CONSENT_PROOF_KEYS,
  channelLinks,
  chips,
  consents,
  deletions,
  events,
  exchanges,
  FAMILY_CHANNEL_KINDS,
  type Family,
  families,
  familyChannels,
  flags,
  INVITE_CHANNELS,
  invites,
  MEMORY_FACT_KINDS,
  MESSAGE_REF_PURPOSES,
  type Member,
  media,
  members,
  memoryFacts,
  messageRefs,
  metricsDaily,
  NEARBY_CONTACT_CHANNELS,
  type NewConsent,
  type NewDeletion,
  type NewExchange,
  type NewFamilyChannel,
  type NewMedia,
  type NewNearbyContact,
  type NewOutbound,
  type NewWeeklyRead,
  nearbyContacts,
  onboardingSessions,
  outbound,
  PLAN_INTERVALS,
  quietEvents,
  RECIPE_STATUSES,
  recipes,
  reminders,
  replies,
  SUBSCRIPTION_PROVIDERS,
  SUBSCRIPTION_STATUSES,
  stories,
  storyQuestions,
  subscriptions,
  suggestions,
  TRANSLATION_OBJECT_TYPES,
  translations,
  turns,
  users,
  type WeeklyRead,
  weeklyReads,
} from "./schema.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

const NOT_NULL_VIOLATION = "23502";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

let testDatabase: TestDatabase;
let db: VelaDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  db = testDatabase.db;
}, 60_000);

beforeEach(async () => {
  await testDatabase.reset();
});

afterAll(async () => {
  await testDatabase.close();
});

const allTables = Object.values<unknown>(schema).filter((value): value is PgTable =>
  is(value, PgTable),
);

function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(`expected exactly one row, got ${rows.length}`);
  }
  return row;
}

/**
 * Runs a statement that must fail and returns the Postgres error code with the constraint or, for
 * a NOT NULL violation (which names no constraint), the column.
 */
async function rejection(
  statement: PromiseLike<unknown>,
): Promise<{ code: string; constraint: string | undefined; column: string | undefined }> {
  try {
    await statement;
  } catch (error) {
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      return {
        code: String(cause.code),
        constraint:
          "constraint" in cause && typeof cause.constraint === "string"
            ? cause.constraint
            : undefined,
        column: "column" in cause && typeof cause.column === "string" ? cause.column : undefined,
      };
    }
    throw error;
  }
  throw new Error("expected the statement to be rejected, but it succeeded");
}

async function countRows(table: PgTable): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(getTableName(table))}`,
  );
  return only(result.rows).n;
}

interface Seed {
  family: Family;
  organiser: Member;
  parent: Member;
}

async function seedFamily(): Promise<Seed> {
  const family = only(
    await db
      .insert(families)
      .values({ name: "The Chens", region: "apac", country: "TW", language: "zh-TW" })
      .returning(),
  );
  const organiser = only(
    await db
      .insert(members)
      .values({
        familyId: family.id,
        role: "organiser",
        displayName: "Mia",
        tz: "Asia/Taipei",
        country: "TW",
        status: "active",
      })
      .returning(),
  );
  const parent = only(
    await db
      .insert(members)
      .values({
        familyId: family.id,
        displayName: "Mom",
        addressForm: "Mrs Chen",
        language: "zh-TW",
        tz: "Asia/Taipei",
        country: "TW",
        status: "active",
        lightOn: true,
      })
      .returning(),
  );
  return { family, organiser, parent };
}

function exchangeFor(seed: Seed, overrides: Partial<NewExchange> = {}): NewExchange {
  return {
    familyId: seed.family.id,
    recipientId: seed.parent.id,
    askerId: seed.organiser.id,
    type: "question",
    text: "What are you cooking tonight?",
    ...overrides,
  };
}

let idempotencySequence = 0;

function outboundFor(
  seed: Seed,
  kind: OutboundKind,
  overrides: Partial<NewOutbound> = {},
): NewOutbound {
  idempotencySequence += 1;
  return {
    memberId: seed.parent.id,
    kind,
    channel: "telegram",
    conversationId: "1001",
    localDay: "2026-09-14",
    idempotencyKey: `test:${kind}:${idempotencySequence}`,
    payload: {},
    ...overrides,
  };
}

type ConsentSubject = { memberId: string } | { contactId: string };

/** A consent about one member or contact, recorded from a tap, with the evidence a tap stores. */
function consentAbout(subject: ConsentSubject, overrides: Partial<NewConsent> = {}): NewConsent {
  return {
    ...subject,
    subjectRef:
      "memberId" in subject ? `member:${subject.memberId}` : `contact:${subject.contactId}`,
    kind: "light",
    answer: "yes",
    textVersion: "consent.request@2",
    lang: "zh-TW",
    channel: "telegram",
    evidence: {
      chat_id: "1001",
      message_id: "77",
      params: { organiser: "Mia", notice: "https://vela.vela-light.workers.dev/privacy/zh-TW" },
      text_sha256: "9f".repeat(32),
    },
    ...overrides,
  };
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A deletion proof as services write it: the hash of the object's type and id. */
function deletionOf(objectType: string, objectId: string): NewDeletion {
  return {
    objectType,
    objectId,
    contentHash: sha256Hex(`${objectType}:${objectId}`),
    reason: "retention",
  };
}

/**
 * Rows in every table, so an update to a column has something to hit and a reset has something to
 * remove. One row per table apart from the family's two members, so updating a whole table never
 * trips a unique index.
 */
async function seedEveryTable(): Promise<void> {
  const seed = await seedFamily();
  const familyId = seed.family.id;
  await db.insert(users).values({ displayName: "Mia" });
  await db
    .insert(channelLinks)
    .values({ memberId: seed.parent.id, channel: "telegram", externalId: "1001" });
  await db.insert(familyChannels).values({
    familyId,
    channel: "telegram",
    conversationId: "-100200",
    kind: "group",
    linkedByMemberId: seed.organiser.id,
    linkedTextSha256: "9f".repeat(32),
  });
  await db.insert(onboardingSessions).values({
    channel: "telegram",
    conversationId: "42",
    externalUserId: "42",
    step: "ask_name",
    expiresAt: new Date("2026-09-14T00:00:00Z"),
  });
  await db.insert(invites).values({
    familyId,
    invitedBy: seed.organiser.id,
    forMemberId: seed.parent.id,
    token: "invite-token",
    expiresAt: new Date("2026-09-20T00:00:00Z"),
  });
  const contact = only(
    await db
      .insert(nearbyContacts)
      .values({
        familyId,
        memberId: seed.parent.id,
        name: "Anna",
        phone: "+886900000001",
        consentedAt: new Date("2026-09-14T00:00:00Z"),
      })
      .returning(),
  );
  await db
    .insert(media)
    .values({ familyId, kind: "audio", storageKey: "apac/a.ogg", mime: "audio/ogg", bytes: 1 });
  const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
  await db.insert(translations).values({
    objectType: "exchange",
    objectId: exchange.id,
    lang: "zh-TW",
    text: "今晚煮什麼？",
    provider: "claude:v1",
  });
  const answer = only(
    await db
      .insert(answers)
      .values({
        exchangeId: exchange.id,
        memberId: seed.parent.id,
        kind: "fine",
        channel: "telegram",
      })
      .returning(),
  );
  await db.insert(replies).values({
    exchangeId: exchange.id,
    memberId: seed.organiser.id,
    kind: "text",
    text: "Yum",
    channel: "telegram",
  });
  await db.insert(chips).values({
    exchangeId: exchange.id,
    chips: ["Noodles", "Soup", "Not sure"],
    promptVersion: "chips.v1",
  });
  await db.insert(turns).values({
    familyId,
    localDay: "2026-09-14",
    recipientId: seed.parent.id,
    holderId: seed.organiser.id,
  });
  await db.insert(suggestions).values({
    familyId,
    forMemberId: seed.organiser.id,
    aboutMemberId: seed.parent.id,
    type: "follow_up",
    text: "Ask how the market was",
    promptVersion: "suggest.v1",
  });
  const question = only(
    await db
      .insert(storyQuestions)
      .values({ lang: "en", ordinal: 1, text: "How did you meet?", theme: "family" })
      .returning(),
  );
  await db.insert(stories).values({
    familyId,
    memberId: seed.parent.id,
    exchangeId: exchange.id,
    question: question.text,
    askedBy: seed.organiser.id,
  });
  await db.insert(recipes).values({ familyId, memberId: seed.parent.id, title: "Braised pork" });
  const fact = only(
    await db
      .insert(memoryFacts)
      .values({ familyId, memberId: seed.parent.id, kind: "date", text: "Birthday in May" })
      .returning(),
  );
  await db.insert(reminders).values({
    familyId,
    memberId: seed.organiser.id,
    aboutMemberId: seed.parent.id,
    text: "Mom's birthday",
    dueDate: "2027-05-01",
    factId: fact.id,
  });
  const quiet = only(
    await db
      .insert(quietEvents)
      .values({ exchangeId: exchange.id, memberId: seed.parent.id })
      .returning(),
  );
  await db
    .insert(awayPeriods)
    .values({ memberId: seed.parent.id, fromDate: "2026-09-14", source: "organiser" });
  await db.insert(weeklyReads).values({
    familyId,
    memberId: seed.parent.id,
    weekStart: "2026-09-07",
    lines: [],
    stats: {},
    promptVersion: "weekly_read.v1",
  });
  await db.insert(outbound).values(outboundFor(seed, "system", { actorId: seed.organiser.id }));
  await db.insert(messageRefs).values({
    channel: "telegram",
    conversationId: "1001",
    messageId: "5",
    familyId,
    exchangeId: exchange.id,
    quietEventId: quiet.id,
    purpose: "arrival",
  });
  await db.insert(aiCalls).values({
    familyId,
    memberId: seed.parent.id,
    call: "understand",
    promptVersion: "understand.v1",
    model: "claude-sonnet-5",
    inputRef: { answer_id: answer.id },
    ok: true,
  });
  await db.insert(events).values({ name: "family_created", familyId });
  await db
    .insert(consents)
    .values(
      consentAbout({ contactId: contact.id }, { kind: "nearby", textVersion: "nearby-consent.v1" }),
    );
  await db.insert(deletions).values(deletionOf("media", "01990000-0000-7000-8000-000000000000"));
  await db
    .insert(subscriptions)
    .values({ familyId, memberId: seed.parent.id, provider: "trial", status: "trial" });
  await db.insert(flags).values({ key: "quiet_notices", value: true });
  await db.insert(adminAccessLog).values({
    admin: "founder",
    familyId,
    memberId: seed.parent.id,
    action: "view",
    what: "family view",
  });
  await db.insert(metricsDaily).values({ day: "2026-09-13", familyId, memberId: seed.parent.id });
}

describe("migrations", () => {
  it("give every uuid primary key the native uuidv7() default", async () => {
    const uuidKeyed = allTables
      .filter((table) => getTableColumns(table).id?.columnType === "PgUUID")
      .map(getTableName);
    const result = await db.execute<{ table_name: string; column_default: string | null }>(
      sql`select table_name, column_default from information_schema.columns
          where table_schema = 'public' and column_name = 'id' and data_type = 'uuid'`,
    );
    const defaults = new Map(result.rows.map((row) => [row.table_name, row.column_default]));

    expect(uuidKeyed.length).toBeGreaterThan(20);
    for (const table of uuidKeyed) {
      expect(defaults.get(table), table).toBe("uuidv7()");
    }
  });

  it("generate version-7 ids that sort in insertion order", async () => {
    const inserted: string[] = [];
    for (const name of ["Ana", "Ben", "Chen"]) {
      inserted.push(only(await db.insert(users).values({ displayName: name }).returning()).id);
    }

    for (const id of inserted) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect([...inserted].sort()).toEqual(inserted);
  });

  it("name every primary key <table>_pkey, as Postgres does", async () => {
    const result = await db.execute<{ table_name: string; conname: string }>(
      sql`select conrelid::regclass::text as table_name, conname from pg_constraint
          join pg_namespace on pg_namespace.oid = pg_constraint.connamespace
          where contype = 'p' and nspname = 'public'`,
    );

    expect(result.rows).toHaveLength(allTables.length);
    for (const row of result.rows) {
      expect(row.conname).toBe(`${row.table_name}_pkey`);
    }
  });
});

describe("one exchange per recipient per date", () => {
  it("rejects a second exchange scheduled for the same recipient and date", async () => {
    const seed = await seedFamily();
    await db
      .insert(exchanges)
      .values(exchangeFor(seed, { state: "scheduled", scheduledFor: "2026-09-14" }));

    const error = await rejection(
      db
        .insert(exchanges)
        .values(exchangeFor(seed, { state: "scheduled", scheduledFor: "2026-09-14" })),
    );

    expect(error).toEqual({ code: UNIQUE_VIOLATION, constraint: "exchanges_one_per_day" });
  });

  it("rejects a composed ask for a date another exchange already holds", async () => {
    const seed = await seedFamily();
    await db
      .insert(exchanges)
      .values(exchangeFor(seed, { whenRule: "date", scheduledFor: "2026-09-20" }));

    const error = await rejection(
      db
        .insert(exchanges)
        .values(exchangeFor(seed, { whenRule: "date", scheduledFor: "2026-09-20" })),
    );

    expect(error).toEqual({ code: UNIQUE_VIOLATION, constraint: "exchanges_one_per_day" });
  });

  it("frees the date once the exchange holding it is withdrawn", async () => {
    const seed = await seedFamily();
    const first = only(
      await db
        .insert(exchanges)
        .values(exchangeFor(seed, { whenRule: "date", scheduledFor: "2026-09-20" }))
        .returning(),
    );
    await db.update(exchanges).set({ state: "withdrawn" }).where(eq(exchanges.id, first.id));

    await db
      .insert(exchanges)
      .values(exchangeFor(seed, { whenRule: "date", scheduledFor: "2026-09-20" }));

    expect(await countRows(exchanges)).toBe(2);
  });

  it("allows any number of undated asks and the same date for another recipient", async () => {
    const seed = await seedFamily();
    await db.insert(exchanges).values([
      exchangeFor(seed, { whenRule: "whenever" }),
      exchangeFor(seed, { whenRule: "whenever" }),
      exchangeFor(seed, { state: "scheduled", scheduledFor: "2026-09-14" }),
      exchangeFor(seed, {
        recipientId: seed.organiser.id,
        askerId: seed.parent.id,
        state: "scheduled",
        scheduledFor: "2026-09-14",
      }),
    ]);

    expect(await countRows(exchanges)).toBe(4);
  });
});

describe("the notification budget", () => {
  const budgeted: readonly string[] = BUDGETED_OUTBOUND_KINDS;
  const unbudgeted = OUTBOUND_KINDS.filter((kind) => !budgeted.includes(kind));

  it.each([...BUDGETED_OUTBOUND_KINDS])("allows one %s per member per local day", async (kind) => {
    const seed = await seedFamily();
    await db.insert(outbound).values(outboundFor(seed, kind));

    const error = await rejection(db.insert(outbound).values(outboundFor(seed, kind)));
    expect(error).toEqual({ code: UNIQUE_VIOLATION, constraint: "outbound_budget_idx" });

    await db
      .insert(outbound)
      .values([
        outboundFor(seed, kind, { localDay: "2026-09-15" }),
        outboundFor(seed, kind, { memberId: seed.organiser.id }),
      ]);
    expect(await countRows(outbound)).toBe(3);
  });

  it("does not count a dropped message against the budget", async () => {
    const seed = await seedFamily();
    await db.insert(outbound).values(outboundFor(seed, "arrival", { status: "dropped" }));

    await db.insert(outbound).values(outboundFor(seed, "arrival"));

    expect(await countRows(outbound)).toBe(2);
  });

  it.each(unbudgeted)("does not limit %s", async (kind) => {
    const seed = await seedFamily();

    await db
      .insert(outbound)
      .values([
        outboundFor(seed, kind, { actorId: seed.organiser.id }),
        outboundFor(seed, kind, { actorId: seed.organiser.id }),
      ]);

    expect(await countRows(outbound)).toBe(2);
  });
});

describe("messages to a third person", () => {
  it("rejects a nearby ask without the id of the person who tapped", async () => {
    const seed = await seedFamily();

    const error = await rejection(db.insert(outbound).values(outboundFor(seed, "nearby_ask")));

    expect(error).toEqual({
      code: CHECK_VIOLATION,
      constraint: "outbound_nearby_ask_actor_check",
    });
  });

  it("accepts a nearby ask that carries its actor, and other kinds without one", async () => {
    const seed = await seedFamily();

    await db
      .insert(outbound)
      .values([
        outboundFor(seed, "nearby_ask", { actorId: seed.organiser.id }),
        outboundFor(seed, "quiet_notice"),
      ]);

    expect(await countRows(outbound)).toBe(2);
  });
});

describe("a send and its effects", () => {
  it("keeps a sent row's effects unstamped until they are applied", async () => {
    const seed = await seedFamily();
    const sentAt = new Date("2026-09-14T00:00:00.000Z");
    const row = only(
      await db
        .insert(outbound)
        .values(outboundFor(seed, "arrival", { status: "sent", sentAt, externalId: "77" }))
        .returning(),
    );

    expect(row.effectsAt).toBeNull();

    const effectsAt = new Date("2026-09-14T00:00:01.000Z");
    const applied = only(
      await db
        .update(outbound)
        .set({ effectsAt })
        .where(eq(outbound.id, row.id))
        .returning({ effectsAt: outbound.effectsAt }),
    );
    expect(applied.effectsAt).toEqual(effectsAt);
  });
});

describe("webhook redelivery", () => {
  it("rejects an answer redelivered with the same channel and message id", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const answer = {
      exchangeId: exchange.id,
      memberId: seed.parent.id,
      kind: "voice",
      channel: "telegram",
      externalId: "1001:77",
    } as const;
    await db.insert(answers).values(answer);

    const error = await rejection(db.insert(answers).values(answer));

    expect(error).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: "answers_channel_external_id_key",
    });
  });

  it("keeps answers apart across channels and when the provider gives no id", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const base = { exchangeId: exchange.id, memberId: seed.parent.id, kind: "fine" } as const;

    await db.insert(answers).values([
      { ...base, channel: "telegram", externalId: "1001:77" },
      { ...base, channel: "line", externalId: "1001:77" },
      { ...base, channel: "app", externalId: null },
      { ...base, channel: "app", externalId: null },
    ]);

    expect(await countRows(answers)).toBe(4);
  });

  it("keeps answers from two chats apart when Telegram gives both the same message id", async () => {
    const first = await seedFamily();
    const second = await seedFamily();
    const firstExchange = only(await db.insert(exchanges).values(exchangeFor(first)).returning());
    const secondExchange = only(await db.insert(exchanges).values(exchangeFor(second)).returning());

    await db.insert(answers).values([
      {
        exchangeId: firstExchange.id,
        memberId: first.parent.id,
        kind: "fine",
        channel: "telegram",
        externalId: "1001:77",
      },
      {
        exchangeId: secondExchange.id,
        memberId: second.parent.id,
        kind: "fine",
        channel: "telegram",
        externalId: "2002:77",
      },
    ]);

    expect(await countRows(answers)).toBe(2);
  });

  it("rejects a reply redelivered with the same channel and message id", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const reply = {
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      kind: "text",
      text: "Save me some!",
      channel: "telegram",
      externalId: "-100200:501",
    } as const;
    await db.insert(replies).values(reply);

    const error = await rejection(db.insert(replies).values(reply));

    expect(error).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: "replies_channel_external_id_idx",
    });
  });

  it("keeps replies from two family groups apart when both carry message id 501", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const reply = {
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      kind: "text",
      text: "Save me some!",
      channel: "telegram",
    } as const;

    await db.insert(replies).values([
      { ...reply, externalId: "-100200:501" },
      { ...reply, externalId: "-100300:501" },
    ]);

    expect(await countRows(replies)).toBe(2);
  });

  it("allows many replies without a provider message id", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const base = { exchangeId: exchange.id, memberId: seed.organiser.id, channel: "app" } as const;

    await db.insert(replies).values([
      { ...base, kind: "text", text: "One" },
      { ...base, kind: "text", text: "Two" },
      { ...base, kind: "voice" },
      { ...base, kind: "voice" },
      { ...base, kind: "photo" },
    ]);

    expect(await countRows(replies)).toBe(5);
  });

  it("allows each reaction once per member per exchange", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const heart = {
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      kind: "heart",
      channel: "telegram",
    } as const;
    await db.insert(replies).values(heart);

    const error = await rejection(db.insert(replies).values(heart));
    expect(error).toEqual({ code: UNIQUE_VIOLATION, constraint: "replies_one_reaction_idx" });

    await db.insert(replies).values([
      { ...heart, kind: "laugh" },
      { ...heart, kind: "hug" },
      { ...heart, memberId: seed.parent.id },
    ]);
    expect(await countRows(replies)).toBe(4);
  });
});

describe("quiet events", () => {
  it("allows one quiet event per exchange", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    await db.insert(quietEvents).values({ exchangeId: exchange.id, memberId: seed.parent.id });

    const error = await rejection(
      db.insert(quietEvents).values({ exchangeId: exchange.id, memberId: seed.parent.id }),
    );

    expect(error).toEqual({ code: UNIQUE_VIOLATION, constraint: "quiet_events_exchange_id_key" });
  });

  it("starts with nobody notified", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());

    const quiet = only(
      await db
        .insert(quietEvents)
        .values({ exchangeId: exchange.id, memberId: seed.parent.id })
        .returning(),
    );

    expect(quiet).toMatchObject({ notifyCount: 0, notifiedMemberIds: [], lastNotifiedAt: null });
  });
});

describe("media", () => {
  function mediaFor(seed: Seed, overrides: Partial<NewMedia> = {}): NewMedia {
    return {
      familyId: seed.family.id,
      kind: "audio",
      mime: "audio/ogg",
      bytes: 2048,
      ...overrides,
    };
  }

  it("accepts a received photo whose MIME type and size are not known yet", async () => {
    const seed = await seedFamily();

    const [photo] = await db
      .insert(media)
      .values({
        familyId: seed.family.id,
        kind: "image",
        channel: "telegram",
        providerFileId: "AgACAgQAAxkBAAIB",
        providerUniqueId: "AQADq1",
      })
      .returning();

    expect(photo?.mime).toBeNull();
    expect(photo?.bytes).toBeNull();
    expect(photo?.storageKey).toBeNull();
  });

  it("rejects a file that is neither stored nor fetchable from the provider", async () => {
    const seed = await seedFamily();

    const error = await rejection(
      db.insert(media).values(mediaFor(seed, { channel: "telegram", providerUniqueId: "AgADq1" })),
    );

    expect(error).toEqual({
      code: CHECK_VIOLATION,
      constraint: "media_storage_key_or_provider_file_id_check",
    });
  });

  it("accepts a file stored in R2 and a file known only by its provider file id", async () => {
    const seed = await seedFamily();

    const [stored, received] = await db
      .insert(media)
      .values([
        mediaFor(seed, { storageKey: "families/f/hello.ogg" }),
        mediaFor(seed, { channel: "telegram", providerFileId: "AwACAgQ1", providerUniqueId: "q1" }),
      ])
      .returning();

    expect(stored).toMatchObject({ storageKey: "families/f/hello.ogg", providerFileId: null });
    expect(received).toMatchObject({
      storageKey: null,
      channel: "telegram",
      providerFileId: "AwACAgQ1",
    });
  });

  it("rejects the same provider file recorded twice on one channel in one family", async () => {
    const seed = await seedFamily();
    const voice = mediaFor(seed, {
      channel: "telegram",
      providerFileId: "AwACAgQ1",
      providerUniqueId: "AgADq1",
    });
    await db.insert(media).values(voice);

    const error = await rejection(
      db.insert(media).values({ ...voice, providerFileId: "AwACAgQ1-redelivered" }),
    );

    expect(error).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: "media_family_id_channel_provider_unique_id_idx",
    });
  });

  it("lets two families each record the same forwarded provider file", async () => {
    const first = await seedFamily();
    const second = await seedFamily();
    const photo = {
      kind: "image",
      channel: "telegram",
      providerFileId: "AgACAgQ1",
      providerUniqueId: "AQADq1",
    } as const;

    const rows = await db
      .insert(media)
      .values([
        { ...photo, familyId: first.family.id },
        { ...photo, familyId: second.family.id },
      ])
      .returning({ familyId: media.familyId });

    expect(rows).toEqual([{ familyId: first.family.id }, { familyId: second.family.id }]);
  });

  it("rejects a provider's unique file id recorded without the channel that issued it", async () => {
    const seed = await seedFamily();

    const error = await rejection(
      db
        .insert(media)
        .values(mediaFor(seed, { storageKey: "families/f/a.ogg", providerUniqueId: "AgADq1" })),
    );

    expect(error).toEqual({
      code: CHECK_VIOLATION,
      constraint: "media_provider_unique_id_channel_check",
    });
  });

  it("keeps provider ids apart across channels and allows many files without one", async () => {
    const seed = await seedFamily();

    await db
      .insert(media)
      .values([
        mediaFor(seed, { channel: "telegram", providerFileId: "f1", providerUniqueId: "u1" }),
        mediaFor(seed, { channel: "line", providerFileId: "f1", providerUniqueId: "u1" }),
        mediaFor(seed, { channel: "telegram", providerFileId: "f2" }),
        mediaFor(seed, { channel: "telegram", providerFileId: "f3" }),
      ]);

    expect(await countRows(media)).toBe(4);
  });

  it("clears every reference to a media row when retention deletes it", async () => {
    const seed = await seedFamily();
    const voice = only(
      await db
        .insert(media)
        .values(mediaFor(seed, { storageKey: "families/f/voice.ogg" }))
        .returning(),
    );
    const exchange = only(
      await db
        .insert(exchanges)
        .values(exchangeFor(seed, { voiceHelloId: voice.id }))
        .returning(),
    );
    await db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.parent.id,
      kind: "voice",
      channel: "telegram",
      mediaId: voice.id,
    });
    await db.insert(replies).values({
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      kind: "voice",
      channel: "telegram",
      mediaId: voice.id,
    });
    await db.insert(stories).values({
      familyId: seed.family.id,
      memberId: seed.parent.id,
      exchangeId: exchange.id,
      question: "How did you and Dad meet?",
      mediaId: voice.id,
    });

    await db.delete(media).where(eq(media.id, voice.id));

    expect(await db.select({ id: exchanges.voiceHelloId }).from(exchanges)).toEqual([{ id: null }]);
    expect(await db.select({ id: answers.mediaId }).from(answers)).toEqual([{ id: null }]);
    expect(await db.select({ id: replies.mediaId }).from(replies)).toEqual([{ id: null }]);
    expect(await db.select({ id: stories.mediaId }).from(stories)).toEqual([{ id: null }]);
  });
});

describe("family channels", () => {
  function groupFor(seed: Seed): NewFamilyChannel {
    return {
      familyId: seed.family.id,
      channel: "telegram",
      conversationId: "-100200",
      kind: "group",
      linkedByMemberId: seed.organiser.id,
      linkedTextSha256: "9f".repeat(32),
    };
  }

  it("rejects linking a conversation that is already linked", async () => {
    const seed = await seedFamily();
    await db.insert(familyChannels).values(groupFor(seed));

    const error = await rejection(db.insert(familyChannels).values(groupFor(seed)));

    expect(error).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: "family_channels_channel_conversation_id_idx",
    });
  });

  it("links a group again after it was unlinked and keeps the unlinked row", async () => {
    const seed = await seedFamily();
    const unlinkedAt = new Date("2026-09-15T02:00:00Z");
    const first = only(await db.insert(familyChannels).values(groupFor(seed)).returning());
    await db.update(familyChannels).set({ unlinkedAt }).where(eq(familyChannels.id, first.id));

    await db.insert(familyChannels).values(groupFor(seed));

    const rows = await db
      .select({ unlinkedAt: familyChannels.unlinkedAt })
      .from(familyChannels)
      .orderBy(familyChannels.id);
    expect(rows).toEqual([{ unlinkedAt }, { unlinkedAt: null }]);
  });
});

describe("understanding re-runs", () => {
  async function voiceAnswerFor(seed: Seed): Promise<string> {
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const answer = only(
      await db
        .insert(answers)
        .values({
          exchangeId: exchange.id,
          memberId: seed.parent.id,
          kind: "voice",
          channel: "telegram",
        })
        .returning({ id: answers.id, processingAttempts: answers.processingAttempts }),
    );
    expect(answer.processingAttempts).toBe(0);
    return answer.id;
  }

  it("counts an answer's processing attempts up from zero", async () => {
    const seed = await seedFamily();
    const answerId = await voiceAnswerFor(seed);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await db
        .update(answers)
        .set({ processingAttempts: sql`${answers.processingAttempts} + 1` })
        .where(eq(answers.id, answerId));
    }

    expect(await db.select({ attempts: answers.processingAttempts }).from(answers)).toEqual([
      { attempts: 3 },
    ]);
  });

  it("rejects an answer whose attempt count is unknown", async () => {
    const seed = await seedFamily();
    await voiceAnswerFor(seed);

    const error = await rejection(db.execute(sql`update answers set processing_attempts = null`));

    expect(error).toEqual({ code: NOT_NULL_VIOLATION, column: "processing_attempts" });
  });
});

describe("weekly reads", () => {
  function draftFor(seed: Seed, overrides: Partial<NewWeeklyRead> = {}): NewWeeklyRead {
    return {
      familyId: seed.family.id,
      memberId: seed.parent.id,
      weekStart: "2026-09-07",
      lines: ["Mei taught Anna the dumpling recipe."],
      suggestion: "Mei, which filling should Anna try next?",
      stats: { answered_days: 5, counted_days: 7, hello_mornings: 1, family_asks: 6 },
      promptVersion: "weekly_read.v4",
      ...overrides,
    };
  }

  const SENT_LINES = ["Mei taught Anna the dumpling recipe, with extra ginger."];
  const SENT_SUGGESTION = "Mei, how much ginger goes in?";
  const SENT_AT = new Date("2026-09-13T11:00:00Z");

  it("types the draft and the sent lines as one string per line", () => {
    // Checked by `tsc` (pnpm typecheck), not at runtime. Services store `ai.weeklyRead` lines (a
    // string array) in `lines` and the founder's edited lines in `sent_lines`, and "what does the
    // family see" renders `sent_lines`, so any other element shape must fail to compile.
    expectTypeOf<WeeklyRead["lines"]>().toEqualTypeOf<string[]>();
    expectTypeOf<WeeklyRead["sentLines"]>().toEqualTypeOf<string[] | null>();
    expectTypeOf<WeeklyRead["sentSuggestion"]>().toEqualTypeOf<string | null>();
  });

  it("stores a draft as not sent, including a draft with no lines", async () => {
    const seed = await seedFamily();

    const draft = only(
      await db
        .insert(weeklyReads)
        .values(draftFor(seed, { lines: [] }))
        .returning(),
    );

    expect(draft).toMatchObject({ lines: [], sentLines: null, sentSuggestion: null, sentAt: null });
  });

  it("records the lines and the suggestion as sent together with the time, keeping the draft", async () => {
    const seed = await seedFamily();
    const draft = only(await db.insert(weeklyReads).values(draftFor(seed)).returning());

    await db
      .update(weeklyReads)
      .set({ sentLines: SENT_LINES, sentSuggestion: SENT_SUGGESTION, sentAt: SENT_AT })
      .where(eq(weeklyReads.id, draft.id));

    expect(
      await db
        .select({
          lines: weeklyReads.lines,
          suggestion: weeklyReads.suggestion,
          sentLines: weeklyReads.sentLines,
          sentSuggestion: weeklyReads.sentSuggestion,
          sentAt: weeklyReads.sentAt,
        })
        .from(weeklyReads),
    ).toEqual([
      {
        lines: draft.lines,
        suggestion: draft.suggestion,
        sentLines: SENT_LINES,
        sentSuggestion: SENT_SUGGESTION,
        sentAt: SENT_AT,
      },
    ]);
  });

  it("records a send whose suggestion the founder removed and whose lines are empty", async () => {
    const seed = await seedFamily();

    const sent = only(
      await db
        .insert(weeklyReads)
        .values(draftFor(seed, { sentLines: [], sentSuggestion: "", sentAt: SENT_AT }))
        .returning(),
    );

    expect(sent).toMatchObject({ sentLines: [], sentSuggestion: "", sentAt: SENT_AT });
  });

  it.each<{ name: string; sent: Partial<NewWeeklyRead> }>([
    { name: "sent lines alone", sent: { sentLines: SENT_LINES } },
    { name: "a sent suggestion alone", sent: { sentSuggestion: SENT_SUGGESTION } },
    { name: "a sent time alone", sent: { sentAt: SENT_AT } },
    {
      name: "sent lines and a time but no sent suggestion",
      sent: { sentLines: SENT_LINES, sentAt: SENT_AT },
    },
    {
      name: "a sent suggestion and a time but no sent lines",
      sent: { sentSuggestion: SENT_SUGGESTION, sentAt: SENT_AT },
    },
    {
      name: "sent lines and a suggestion but no sent time",
      sent: { sentLines: SENT_LINES, sentSuggestion: SENT_SUGGESTION },
    },
  ])("rejects a read with $name", async ({ sent }) => {
    const seed = await seedFamily();

    const error = await rejection(db.insert(weeklyReads).values(draftFor(seed, sent)));

    expect(error).toEqual({
      code: CHECK_VIOLATION,
      constraint: "weekly_reads_sent_lines_sent_suggestion_sent_at_check",
    });
  });
});

describe("the admin access log", () => {
  it("keeps an entry after the member and the family it names are deleted", async () => {
    const seed = await seedFamily();
    const entry = {
      admin: "founder",
      familyId: seed.family.id,
      memberId: seed.parent.id,
      action: "mark_deceased",
      what: "member status",
    } as const;
    await db.insert(adminAccessLog).values(entry);

    await db.delete(families).where(eq(families.id, seed.family.id));

    expect(await countRows(members)).toBe(0);
    expect(
      await db
        .select({
          admin: adminAccessLog.admin,
          familyId: adminAccessLog.familyId,
          memberId: adminAccessLog.memberId,
          action: adminAccessLog.action,
          what: adminAccessLog.what,
        })
        .from(adminAccessLog),
    ).toEqual([entry]);
  });

  it("records a page view that is about no single member", async () => {
    const seed = await seedFamily();

    const entry = only(
      await db
        .insert(adminAccessLog)
        .values({ admin: "founder", familyId: seed.family.id, action: "view", what: "family page" })
        .returning(),
    );

    expect(entry).toMatchObject({ memberId: null, action: "view" });
  });

  it("rejects an entry that does not say which action it records", async () => {
    const error = await rejection(
      db.execute(sql`insert into admin_access_log (admin, what) values ('founder', 'family page')`),
    );

    expect(error).toEqual({ code: NOT_NULL_VIOLATION, column: "action" });
  });
});

describe("columns the pilot flows rely on", () => {
  it("stores the first local date on which her arrivals may be delivered", async () => {
    const seed = await seedFamily();

    await db
      .update(members)
      .set({ lightStartsOn: "2026-09-14" })
      .where(eq(members.id, seed.parent.id));

    const stored = only(
      await db
        .select({ lightStartsOn: members.lightStartsOn })
        .from(members)
        .where(eq(members.id, seed.parent.id)),
    );
    expect(seed.parent.lightStartsOn).toBeNull();
    expect(stored.lightStartsOn).toBe("2026-09-14");
  });

  it("resolves a turn prompt message to its recipient and local date", async () => {
    const seed = await seedFamily();
    await db.insert(messageRefs).values({
      channel: "telegram",
      conversationId: "-100200",
      messageId: "812",
      familyId: seed.family.id,
      memberId: seed.parent.id,
      localDate: "2026-09-15",
      purpose: "turn_prompt",
    });

    const ref = await db.query.messageRefs.findFirst({
      where: and(
        eq(messageRefs.channel, "telegram"),
        eq(messageRefs.conversationId, "-100200"),
        eq(messageRefs.messageId, "812"),
      ),
      with: { member: true },
    });

    expect(ref).toMatchObject({
      localDate: "2026-09-15",
      exchangeId: null,
      member: { id: seed.parent.id, displayName: "Mom" },
    });
  });

  it("removes a member's message refs when the member is deleted", async () => {
    const seed = await seedFamily();
    await db.insert(messageRefs).values({
      channel: "telegram",
      conversationId: "-100200",
      messageId: "812",
      familyId: seed.family.id,
      memberId: seed.parent.id,
      localDate: "2026-09-15",
      purpose: "turn_prompt",
    });

    await db.delete(members).where(eq(members.id, seed.parent.id));

    expect(await countRows(messageRefs)).toBe(0);
  });

  it("records an evening turn that nobody holds", async () => {
    const seed = await seedFamily();

    const turn = only(
      await db
        .insert(turns)
        .values({ familyId: seed.family.id, localDay: "2026-09-15", recipientId: seed.parent.id })
        .returning(),
    );

    expect(turn.holderId).toBeNull();
  });

  it("reads local wall-clock times as HH:MM, the format core parses", async () => {
    const seed = await seedFamily();
    await db.update(members).set({ wakeTime: "07:30" }).where(eq(members.id, seed.parent.id));
    await db.insert(events).values({ name: "answer_recorded", localTime: "08:05" });

    const stored = only(
      await db
        .select({ wakeTime: members.wakeTime, arrivalTime: members.arrivalTime })
        .from(members)
        .where(eq(members.id, seed.parent.id)),
    );

    expect(seed.parent.arrivalTime).toBe("08:00");
    expect(stored).toEqual({ wakeTime: "07:30", arrivalTime: "08:00" });
    expect(await db.select({ localTime: events.localTime }).from(events)).toEqual([
      { localTime: "08:05" },
    ]);
  });

  it("records unsupported content as an other answer", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());

    const answer = only(
      await db
        .insert(answers)
        .values({
          exchangeId: exchange.id,
          memberId: seed.parent.id,
          kind: "other",
          channel: "telegram",
          externalId: "1001:90",
        })
        .returning(),
    );

    expect(answer.kind).toBe("other");
  });

  it("stamps an onboarding session with the time it was created", async () => {
    const session = only(
      await db
        .insert(onboardingSessions)
        .values({
          channel: "telegram",
          conversationId: "42",
          externalUserId: "42",
          step: "ask_name",
          expiresAt: new Date("2026-09-14T00:00:00Z"),
        })
        .returning(),
    );

    // now() is the transaction's start time, so both defaults carry the same instant.
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.createdAt).toEqual(session.updatedAt);
  });
});

describe("deleting a member who left", () => {
  it("leaves no foreign key to members that would refuse the delete", async () => {
    const result = await db.execute<{ conname: string }>(
      sql`select conname from pg_constraint
          where contype = 'f' and confrelid = 'members'::regclass and confdeltype in ('a', 'r')`,
    );

    expect(result.rows).toEqual([]);
  });

  it("keeps the family's rows without them and drops rows that existed only for them", async () => {
    const seed = await seedFamily();
    const familyId = seed.family.id;
    const expiresAt = new Date("2026-08-08T00:00:00Z");
    const sibling = only(
      await db
        .insert(members)
        .values({
          familyId,
          displayName: "Leo",
          tz: "Asia/Taipei",
          country: "TW",
          status: "left",
          leftAt: new Date("2026-08-01T00:00:00Z"),
        })
        .returning(),
    );
    const photo = only(
      await db
        .insert(media)
        .values({
          familyId,
          uploadedBy: sibling.id,
          kind: "image",
          channel: "telegram",
          providerFileId: "AgACAgQ1",
        })
        .returning(),
    );
    const exchange = only(
      await db
        .insert(exchanges)
        .values(exchangeFor(seed, { askerId: sibling.id, mediaIds: [photo.id] }))
        .returning(),
    );
    await db.insert(quietEvents).values({
      exchangeId: exchange.id,
      memberId: seed.parent.id,
      resolvedAt: new Date("2026-07-20T06:00:00Z"),
      outcome: "fine_known",
      resolvedBy: sibling.id,
    });
    await db.insert(awayPeriods).values({
      memberId: seed.parent.id,
      fromDate: "2026-07-25",
      source: "member",
      setBy: sibling.id,
    });
    await db.insert(stories).values({
      familyId,
      memberId: seed.parent.id,
      exchangeId: exchange.id,
      question: "How did you and Dad meet?",
      askedBy: sibling.id,
    });
    await db.insert(turns).values({
      familyId,
      localDay: "2026-07-21",
      recipientId: seed.parent.id,
      holderId: sibling.id,
    });
    await db.insert(invites).values([
      {
        familyId,
        invitedBy: seed.organiser.id,
        token: "accepted-by-leo",
        expiresAt,
        acceptedAt: new Date("2026-07-02T00:00:00Z"),
        acceptedBy: sibling.id,
      },
      { familyId, invitedBy: sibling.id, token: "sent-by-leo", expiresAt },
      {
        familyId,
        invitedBy: seed.organiser.id,
        forMemberId: sibling.id,
        token: "for-leo",
        expiresAt,
      },
    ]);
    await db.insert(outbound).values(outboundFor(seed, "nearby_ask", { actorId: sibling.id }));

    await db.delete(members).where(eq(members.id, sibling.id));

    // Only a hello comes from Vela, so an ask that lost its asker still reads as a family ask.
    expect(
      await db.select({ type: exchanges.type, askerId: exchanges.askerId }).from(exchanges),
    ).toEqual([{ type: "question", askerId: null }]);
    expect(await db.select({ id: media.uploadedBy }).from(media)).toEqual([{ id: null }]);
    expect(await db.select({ id: quietEvents.resolvedBy }).from(quietEvents)).toEqual([
      { id: null },
    ]);
    expect(await db.select({ id: awayPeriods.setBy }).from(awayPeriods)).toEqual([{ id: null }]);
    expect(await db.select({ id: stories.askedBy }).from(stories)).toEqual([{ id: null }]);
    expect(await db.select({ id: turns.holderId }).from(turns)).toEqual([{ id: null }]);
    expect(
      await db.select({ token: invites.token, acceptedBy: invites.acceptedBy }).from(invites),
    ).toEqual([{ token: "accepted-by-leo", acceptedBy: null }]);
    expect(await countRows(outbound)).toBe(0);
  });
});

describe("consent proofs", () => {
  async function contactNear(seed: Seed): Promise<string> {
    const contact = only(
      await db
        .insert(nearbyContacts)
        .values({ familyId: seed.family.id, memberId: seed.parent.id, name: "Anna" })
        .returning({ id: nearbyContacts.id }),
    );
    return contact.id;
  }

  /** What forgetConsentSubjects in services does before a delete. */
  function forget(at: Date): Promise<unknown> {
    const kept = CONSENT_PROOF_KEYS.map((key) => sql`${key}`);
    return db.execute(
      sql`update consents set subject_deleted_at = ${at.toISOString()},
          evidence = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                      from jsonb_each(evidence) where key in (${sql.join(kept, sql`, `)}))`,
    );
  }

  it("records a decline as a row of its own", async () => {
    const seed = await seedFamily();

    const decline = only(
      await db
        .insert(consents)
        .values(consentAbout({ memberId: seed.parent.id }, { answer: "no" }))
        .returning(),
    );

    expect(decline).toMatchObject({
      answer: "no",
      subjectRef: `member:${seed.parent.id}`,
      withdrawnAt: null,
      subjectDeletedAt: null,
    });
  });

  it.each(["answer", "subject_ref"])("rejects a consent without its %s", async (column) => {
    const seed = await seedFamily();
    const values = {
      member_id: seed.parent.id,
      subject_ref: `member:${seed.parent.id}`,
      kind: "light",
      answer: "yes",
      text_version: "consent.request@2",
      lang: "en",
      channel: "telegram",
    };
    const given = Object.entries(values).filter(([name]) => name !== column);

    const error = await rejection(
      db.execute(
        sql`insert into consents (${sql.join(
          given.map(([name]) => sql.identifier(name)),
          sql`, `,
        )}) values (${sql.join(
          given.map(([, value]) => sql`${value}`),
          sql`, `,
        )})`,
      ),
    );

    expect(error).toEqual({ code: NOT_NULL_VIOLATION, column });
  });

  it("accepts a proof about a member and a proof about a nearby contact", async () => {
    const seed = await seedFamily();
    const contactId = await contactNear(seed);

    await db
      .insert(consents)
      .values([
        consentAbout({ memberId: seed.parent.id }),
        consentAbout({ contactId }, { kind: "nearby", answer: "no" }),
      ]);

    expect(await db.select({ subjectRef: consents.subjectRef }).from(consents)).toEqual(
      expect.arrayContaining([
        { subjectRef: `member:${seed.parent.id}` },
        { subjectRef: `contact:${contactId}` },
      ]),
    );
  });

  it.each<{ name: string; row: (seed: Seed, contactId: string) => NewConsent }>([
    {
      name: "another member",
      row: (seed) => ({
        ...consentAbout({ memberId: seed.parent.id }),
        subjectRef: `member:${seed.organiser.id}`,
      }),
    },
    {
      name: "its contact as a member",
      row: (_seed, contactId) => ({
        ...consentAbout({ contactId }),
        subjectRef: `member:${contactId}`,
      }),
    },
    {
      name: "its member and a contact at once",
      row: (seed, contactId) => ({ ...consentAbout({ memberId: seed.parent.id }), contactId }),
    },
    {
      name: "a subject kind that does not exist",
      row: (seed) => ({
        ...consentAbout({ memberId: seed.parent.id }),
        subjectRef: `user:${seed.parent.id}`,
      }),
    },
    {
      name: "its member's id in upper case",
      row: (seed) => ({
        ...consentAbout({ memberId: seed.parent.id }),
        subjectRef: `member:${seed.parent.id.toUpperCase()}`,
      }),
    },
    {
      name: "something that is not an id",
      row: (seed) => ({ ...consentAbout({ memberId: seed.parent.id }), subjectRef: "member:Mom" }),
    },
  ])("rejects a subject_ref that names $name", async ({ row }) => {
    const seed = await seedFamily();
    const contactId = await contactNear(seed);

    const error = await rejection(db.insert(consents).values(row(seed, contactId)));

    expect(error).toEqual({ code: CHECK_VIOLATION, constraint: "consents_subject_ref_check" });
  });

  it("allows only a yes to be withdrawn", async () => {
    const seed = await seedFamily();
    const withdrawnAt = new Date("2026-09-20T00:00:00Z");

    await db
      .insert(consents)
      .values(consentAbout({ memberId: seed.parent.id }, { kind: "health_words", withdrawnAt }));
    const error = await rejection(
      db
        .insert(consents)
        .values(consentAbout({ memberId: seed.parent.id }, { answer: "no", withdrawnAt })),
    );

    expect(error).toEqual({ code: CHECK_VIOLATION, constraint: "consents_withdrawn_at_check" });
  });

  it("refuses to delete a member or a contact whose consent rows were not forgotten", async () => {
    const seed = await seedFamily();
    const contactId = await contactNear(seed);
    await db
      .insert(consents)
      .values([
        consentAbout({ memberId: seed.parent.id }),
        consentAbout({ contactId }, { kind: "nearby" }),
      ]);

    const memberError = await rejection(db.delete(members).where(eq(members.id, seed.parent.id)));
    const contactError = await rejection(
      db.delete(nearbyContacts).where(eq(nearbyContacts.id, contactId)),
    );

    const refused = { code: CHECK_VIOLATION, constraint: "consents_subject_deleted_check" };
    expect(memberError).toEqual(refused);
    expect(contactError).toEqual(refused);
    expect(await countRows(members)).toBe(2);
    expect(await countRows(nearbyContacts)).toBe(1);
  });

  it("refuses the delete while the evidence still holds words, even with the deletion time set", async () => {
    const seed = await seedFamily();
    await db
      .insert(consents)
      .values(
        consentAbout(
          { memberId: seed.parent.id },
          { subjectDeletedAt: new Date("2026-09-20T00:00:00Z") },
        ),
      );

    const error = await rejection(db.delete(members).where(eq(members.id, seed.parent.id)));

    expect(error).toEqual({ code: CHECK_VIOLATION, constraint: "consents_subject_deleted_check" });
  });

  it("keeps a forgotten proof after its member and contact are deleted, naming them only by id", async () => {
    const seed = await seedFamily();
    const contactId = await contactNear(seed);
    await db
      .insert(consents)
      .values([
        consentAbout({ memberId: seed.parent.id }, { answer: "no" }),
        consentAbout(
          { contactId },
          { kind: "nearby", evidence: { recorded_by: "founder", note: "Anna said yes by phone" } },
        ),
      ]);
    const deletedAt = new Date("2026-09-20T00:00:00Z");

    await forget(deletedAt);
    await db.delete(members).where(eq(members.id, seed.parent.id));

    expect(await countRows(nearbyContacts)).toBe(0);
    const proofs = await db
      .select({
        memberId: consents.memberId,
        contactId: consents.contactId,
        subjectRef: consents.subjectRef,
        answer: consents.answer,
        evidence: consents.evidence,
        subjectDeletedAt: consents.subjectDeletedAt,
      })
      .from(consents)
      .orderBy(consents.id);
    expect(proofs).toEqual([
      {
        memberId: null,
        contactId: null,
        subjectRef: `member:${seed.parent.id}`,
        answer: "no",
        evidence: { chat_id: "1001", message_id: "77", text_sha256: "9f".repeat(32) },
        subjectDeletedAt: deletedAt,
      },
      {
        memberId: null,
        contactId: null,
        subjectRef: `contact:${contactId}`,
        answer: "yes",
        evidence: { recorded_by: "founder" },
        subjectDeletedAt: deletedAt,
      },
    ]);
  });

  it("keeps a family's forgotten proofs when the family is deleted", async () => {
    const seed = await seedFamily();
    await db
      .insert(consents)
      .values([
        consentAbout({ memberId: seed.parent.id }),
        consentAbout({ memberId: seed.organiser.id }, { kind: "pilot" }),
      ]);

    await forget(new Date("2026-09-20T00:00:00Z"));
    await db.delete(families).where(eq(families.id, seed.family.id));

    expect(await countRows(members)).toBe(0);
    expect(await db.select({ memberId: consents.memberId }).from(consents)).toEqual([
      { memberId: null },
      { memberId: null },
    ]);
  });
});

describe("nearby contacts' numbers", () => {
  const CONSENTED_AT = new Date("2026-09-15T02:00:00Z");
  const DECLINED_AT = new Date("2026-09-16T02:00:00Z");

  function contactFor(seed: Seed, overrides: Partial<NewNearbyContact> = {}): NewNearbyContact {
    return {
      familyId: seed.family.id,
      memberId: seed.parent.id,
      name: "Anna",
      relation: "neighbour",
      ...overrides,
    };
  }

  it("stores a contact named at setup without a number", async () => {
    const seed = await seedFamily();

    const contact = only(await db.insert(nearbyContacts).values(contactFor(seed)).returning());

    expect(contact).toMatchObject({ phone: null, consentedAt: null, declinedAt: null });
  });

  it("stores a number with a standing yes, and none once the contact says no", async () => {
    const seed = await seedFamily();
    const contact = only(
      await db
        .insert(nearbyContacts)
        .values(contactFor(seed, { phone: "+886 912 345 678", consentedAt: CONSENTED_AT }))
        .returning(),
    );

    await db
      .update(nearbyContacts)
      .set({ phone: null, declinedAt: DECLINED_AT })
      .where(eq(nearbyContacts.id, contact.id));

    expect(
      await db
        .select({ phone: nearbyContacts.phone, declinedAt: nearbyContacts.declinedAt })
        .from(nearbyContacts),
    ).toEqual([{ phone: null, declinedAt: DECLINED_AT }]);
  });

  it.each<{ name: string; fields: Partial<NewNearbyContact> }>([
    { name: "a number without a yes", fields: { phone: "+886912345678" } },
    {
      name: "a number kept after a no",
      fields: { phone: "+886912345678", consentedAt: CONSENTED_AT, declinedAt: DECLINED_AT },
    },
    { name: "a standing yes without a number", fields: { consentedAt: CONSENTED_AT } },
  ])("rejects $name", async ({ fields }) => {
    const seed = await seedFamily();

    const error = await rejection(db.insert(nearbyContacts).values(contactFor(seed, fields)));

    expect(error).toEqual({
      code: CHECK_VIOLATION,
      constraint: "nearby_contacts_phone_consented_check",
    });
  });
});

describe("deletion proofs", () => {
  const MEDIA_ID = "01990000-0000-7000-8000-00000000000a";

  it("accept the hash of the deleted object's type and id", async () => {
    await db
      .insert(deletions)
      .values([
        deletionOf("media", MEDIA_ID),
        deletionOf("nearby_contact", "01990000-0000-7000-8000-00000000000b"),
      ]);

    expect(await countRows(deletions)).toBe(2);
  });

  it.each<{ name: string; hash: string }>([
    { name: "a phone number", hash: sha256Hex("+886912345678") },
    { name: "a storage key", hash: sha256Hex("families/f/answers/a.ogg") },
    { name: "the id alone", hash: sha256Hex(MEDIA_ID) },
    { name: "another object type", hash: sha256Hex(`answer:${MEDIA_ID}`) },
    {
      name: "its type and id in upper-case hex",
      hash: sha256Hex(`media:${MEDIA_ID}`).toUpperCase(),
    },
  ])("reject the hash of $name", async ({ hash }) => {
    const error = await rejection(
      db.insert(deletions).values({ ...deletionOf("media", MEDIA_ID), contentHash: hash }),
    );

    expect(error).toEqual({ code: CHECK_VIOLATION, constraint: "deletions_content_hash_check" });
  });
});

describe("CHECK constraints on enumerated columns", () => {
  const enumerated: { table: string; column: string; values: readonly string[] }[] = [
    { table: "users", column: "language", values: LANGS },
    { table: "families", column: "region", values: REGIONS },
    { table: "families", column: "language", values: LANGS },
    { table: "families", column: "plan", values: PLANS },
    { table: "members", column: "role", values: ROLES },
    { table: "members", column: "language", values: LANGS },
    { table: "members", column: "age_band", values: AGE_BANDS },
    { table: "members", column: "status", values: MEMBER_STATUSES },
    { table: "members", column: "primary_surface", values: SURFACES },
    { table: "channel_links", column: "channel", values: CHANNELS },
    { table: "family_channels", column: "channel", values: CHANNELS },
    { table: "family_channels", column: "kind", values: FAMILY_CHANNEL_KINDS },
    { table: "invites", column: "channel", values: INVITE_CHANNELS },
    { table: "onboarding_sessions", column: "channel", values: CHANNELS },
    { table: "nearby_contacts", column: "channel", values: NEARBY_CONTACT_CHANNELS },
    { table: "media", column: "kind", values: MEDIA_KINDS },
    { table: "media", column: "channel", values: CHANNELS },
    { table: "exchanges", column: "type", values: EXCHANGE_TYPES },
    { table: "exchanges", column: "state", values: EXCHANGE_STATES },
    { table: "exchanges", column: "when_rule", values: WHEN_RULES },
    { table: "translations", column: "object_type", values: TRANSLATION_OBJECT_TYPES },
    { table: "answers", column: "kind", values: ANSWER_KINDS },
    { table: "answers", column: "channel", values: CHANNELS },
    { table: "replies", column: "kind", values: REPLY_KINDS },
    { table: "replies", column: "channel", values: CHANNELS },
    { table: "recipes", column: "status", values: RECIPE_STATUSES },
    { table: "memory_facts", column: "kind", values: MEMORY_FACT_KINDS },
    { table: "quiet_events", column: "outcome", values: QUIET_OUTCOMES },
    { table: "away_periods", column: "source", values: AWAY_SOURCES },
    { table: "outbound", column: "kind", values: OUTBOUND_KINDS },
    { table: "outbound", column: "channel", values: CHANNELS },
    { table: "outbound", column: "status", values: OUTBOUND_STATUSES },
    { table: "message_refs", column: "channel", values: CHANNELS },
    { table: "message_refs", column: "purpose", values: MESSAGE_REF_PURPOSES },
    { table: "events", column: "name", values: EVENT_NAMES },
    { table: "consents", column: "kind", values: CONSENT_KINDS },
    { table: "consents", column: "answer", values: CONSENT_ANSWERS },
    { table: "subscriptions", column: "provider", values: SUBSCRIPTION_PROVIDERS },
    { table: "subscriptions", column: "status", values: SUBSCRIPTION_STATUSES },
    { table: "subscriptions", column: "plan_interval", values: PLAN_INTERVALS },
    { table: "admin_access_log", column: "action", values: ADMIN_ACTIONS },
  ];

  function setColumn(table: string, column: string, value: string): Promise<unknown> {
    return db.execute(
      sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${value}`,
    );
  }

  it.each(enumerated)(
    "$table column $column accepts every value in its tuple and nothing else",
    async ({ table, column, values }) => {
      await seedEveryTable();

      for (const value of values) {
        await setColumn(table, column, value);
      }
      const error = await rejection(setColumn(table, column, "not_a_real_value"));

      expect(error).toEqual({ code: CHECK_VIOLATION, constraint: `${table}_${column}_check` });
    },
  );

  it("rejects a story day outside Sunday to Saturday", async () => {
    await seedFamily();

    await db.update(families).set({ storyDay: 6 });
    const error = await rejection(db.update(families).set({ storyDay: 7 }));

    expect(error).toEqual({ code: CHECK_VIOLATION, constraint: "families_story_day_check" });
  });

  it("covers every CHECK constraint in the database", async () => {
    const result = await db.execute<{ conname: string }>(
      sql`select conname from pg_constraint
          join pg_namespace on pg_namespace.oid = pg_constraint.connamespace
          where contype = 'c' and nspname = 'public'`,
    );
    const tested = [
      ...enumerated.map(({ table, column }) => `${table}_${column}_check`),
      "families_story_day_check",
      "outbound_nearby_ask_actor_check",
      "media_storage_key_or_provider_file_id_check",
      "media_provider_unique_id_channel_check",
      "weekly_reads_sent_lines_sent_suggestion_sent_at_check",
      "consents_subject_ref_check",
      "consents_withdrawn_at_check",
      "consents_subject_deleted_check",
      "nearby_contacts_phone_consented_check",
      "deletions_content_hash_check",
    ];

    expect(result.rows.map((row) => row.conname).sort()).toEqual(tested.sort());
  });
});

describe("reset", () => {
  it("empties every application table and restarts identities", async () => {
    await seedEveryTable();
    for (const table of allTables) {
      expect(await countRows(table), `${getTableName(table)} before reset`).toBeGreaterThan(0);
    }

    await testDatabase.reset();

    for (const table of allTables) {
      expect(await countRows(table), getTableName(table)).toBe(0);
    }
    const event = only(await db.insert(events).values({ name: "scheduler_tick" }).returning());
    expect(event.id).toBe(1);
  });
});

describe("relations", () => {
  it("load a kept-light member with her family, links, and exchanges with their answers", async () => {
    const seed = await seedFamily();
    await db
      .insert(channelLinks)
      .values({ memberId: seed.parent.id, channel: "telegram", externalId: "1001" });
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    await db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.parent.id,
      kind: "heart",
      channel: "telegram",
    });

    const loaded = await db.query.members.findFirst({
      where: eq(members.id, seed.parent.id),
      with: {
        family: true,
        channelLinks: true,
        receivedExchanges: { with: { asker: true, answers: true, quietEvent: true } },
      },
    });

    expect(loaded?.family.name).toBe("The Chens");
    expect(loaded?.channelLinks.map((link) => link.externalId)).toEqual(["1001"]);
    expect(loaded?.receivedExchanges).toHaveLength(1);
    expect(loaded?.receivedExchanges[0]?.asker?.displayName).toBe("Mia");
    expect(loaded?.receivedExchanges[0]?.answers.map((answer) => answer.kind)).toEqual(["heart"]);
    expect(loaded?.receivedExchanges[0]?.quietEvent).toBeNull();
  });
});
