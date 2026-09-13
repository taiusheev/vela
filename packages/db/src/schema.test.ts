import {
  AGE_BANDS,
  ANSWER_KINDS,
  AWAY_SOURCES,
  BUDGETED_OUTBOUND_KINDS,
  CHANNELS,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { VelaDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import {
  answers,
  awayPeriods,
  channelLinks,
  chips,
  consents,
  events,
  exchanges,
  FAMILY_CHANNEL_KINDS,
  type Family,
  families,
  familyChannels,
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
  type NewExchange,
  type NewFamilyChannel,
  type NewMedia,
  type NewOutbound,
  nearbyContacts,
  onboardingSessions,
  outbound,
  PLAN_INTERVALS,
  quietEvents,
  RECIPE_STATUSES,
  recipes,
  replies,
  SUBSCRIPTION_PROVIDERS,
  SUBSCRIPTION_STATUSES,
  stories,
  subscriptions,
  TRANSLATION_OBJECT_TYPES,
  translations,
  users,
} from "./schema.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

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

/** Runs a statement that must fail and returns the Postgres error code and constraint name. */
async function rejection(
  statement: PromiseLike<unknown>,
): Promise<{ code: string; constraint: string }> {
  try {
    await statement;
  } catch (error) {
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
    if (typeof cause === "object" && cause !== null && "code" in cause && "constraint" in cause) {
      return { code: String(cause.code), constraint: String(cause.constraint) };
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

describe("webhook redelivery", () => {
  it("rejects an answer redelivered with the same channel and message id", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    const answer = {
      exchangeId: exchange.id,
      memberId: seed.parent.id,
      kind: "voice",
      channel: "telegram",
      externalId: "tg:msg:77",
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
      { ...base, channel: "telegram", externalId: "77" },
      { ...base, channel: "line", externalId: "77" },
      { ...base, channel: "app", externalId: null },
      { ...base, channel: "app", externalId: null },
    ]);

    expect(await countRows(answers)).toBe(4);
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
      externalId: "-100:501",
    } as const;
    await db.insert(replies).values(reply);

    const error = await rejection(db.insert(replies).values(reply));

    expect(error).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: "replies_channel_external_id_idx",
    });
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

  it("rejects the same provider file recorded twice on one channel", async () => {
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
      constraint: "media_channel_provider_unique_id_idx",
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
          externalId: "tg:msg:90",
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
    { table: "subscriptions", column: "provider", values: SUBSCRIPTION_PROVIDERS },
    { table: "subscriptions", column: "status", values: SUBSCRIPTION_STATUSES },
    { table: "subscriptions", column: "plan_interval", values: PLAN_INTERVALS },
  ];

  /** One row in every table that has an enumerated column, so updates have something to hit. */
  async function seedOneRowEach(): Promise<void> {
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
        .values({ familyId, memberId: seed.parent.id, name: "Anna", phone: "+886900000001" })
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
    await db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.parent.id,
      kind: "fine",
      channel: "telegram",
    });
    await db.insert(replies).values({
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      kind: "text",
      text: "Yum",
      channel: "telegram",
    });
    await db.insert(recipes).values({ familyId, memberId: seed.parent.id, title: "Braised pork" });
    await db
      .insert(memoryFacts)
      .values({ familyId, memberId: seed.parent.id, kind: "date", text: "Birthday in May" });
    const quiet = only(
      await db
        .insert(quietEvents)
        .values({ exchangeId: exchange.id, memberId: seed.parent.id })
        .returning(),
    );
    await db
      .insert(awayPeriods)
      .values({ memberId: seed.parent.id, fromDate: "2026-09-14", source: "organiser" });
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
    await db.insert(consents).values({
      memberId: seed.parent.id,
      contactId: contact.id,
      kind: "light",
      textVersion: "consent.request.v1",
      lang: "zh-TW",
      channel: "telegram",
    });
    await db
      .insert(subscriptions)
      .values({ familyId, memberId: seed.parent.id, provider: "trial", status: "trial" });
    await db.insert(events).values({ name: "family_created", familyId });
  }

  function setColumn(table: string, column: string, value: string): Promise<unknown> {
    return db.execute(
      sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${value}`,
    );
  }

  it.each(enumerated)(
    "$table column $column accepts every value in its tuple and nothing else",
    async ({ table, column, values }) => {
      await seedOneRowEach();

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
    ];

    expect(result.rows.map((row) => row.conname).sort()).toEqual(tested.sort());
  });
});

describe("reset", () => {
  it("empties every application table and restarts identities", async () => {
    const seed = await seedFamily();
    const exchange = only(await db.insert(exchanges).values(exchangeFor(seed)).returning());
    await db.insert(chips).values({
      exchangeId: exchange.id,
      chips: ["Noodles", "Soup", "Not sure"],
      promptVersion: "chips.v1",
    });
    await db.insert(onboardingSessions).values({
      channel: "telegram",
      conversationId: "42",
      externalUserId: "42",
      step: "ask_name",
      expiresAt: new Date("2026-09-14T00:00:00Z"),
    });
    await db.insert(metricsDaily).values({
      day: "2026-09-13",
      familyId: seed.family.id,
      memberId: seed.parent.id,
    });
    await db
      .insert(events)
      .values([{ name: "family_created" }, { name: "member_joined" }, { name: "ask_composed" }]);

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
