/**
 * One family on this machine's database, belonging to the account you sign in with, so the app
 * shows a real day instead of its example one:
 *
 *   pnpm --filter @vela/worker seed:dev -- user_123abc
 *
 * The argument is the Clerk user id of the account you signed in with, which the app prints under
 * "You" and Clerk shows on its Users page. Running it again for the same id refreshes that
 * family's day rather than making a second one.
 *
 * It writes synthetic people and words only, and refuses any database that is not local.
 */
import { createOffAi } from "@vela/ai";
import { addDays, localDateOf } from "@vela/core";
import { answers, connectDatabase, exchanges, members, replies, turns, users } from "@vela/db";
import { writeSuggestions } from "@vela/services";
import { seedFamily } from "@vela/services/testing";
import { and, eq } from "drizzle-orm";

/** Channel ids are unique across the database, so each account seeds its own pair. */
function channelIds(subject: string): { organiser: string; member: string } {
  let hash = 0;
  for (const character of subject) hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  return { organiser: `9${hash}0`, member: `9${hash}1` };
}

// pnpm forwards its own `--` separator, so the id is the first argument that is not one.
const authSubject = process.argv
  .slice(2)
  .map((argument) => argument.trim())
  .find((argument) => argument.length > 0 && argument !== "--");
if (authSubject === undefined || authSubject.length === 0) {
  console.error("[seed] give the Clerk user id: pnpm --filter @vela/worker seed:dev -- user_123");
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error("[seed] DATABASE_URL is not set. See infra/README.md, section 9a.");
  process.exit(2);
}
const { hostname } = new URL(databaseUrl);
if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
  console.error(
    `[seed] DATABASE_URL points at ${hostname}; this script only seeds a local database.`,
  );
  process.exit(2);
}

const connection = await connectDatabase(databaseUrl);
const db = connection.db;
const now = new Date();

try {
  const [account] = await db
    .insert(users)
    .values({ authSubject, displayName: "You", language: "en", tz: "Asia/Taipei" })
    .onConflictDoNothing({ target: users.authSubject })
    .returning();
  const [owner] =
    account === undefined
      ? await db.select().from(users).where(eq(users.authSubject, authSubject))
      : [account];
  if (owner === undefined) throw new Error("the account could not be created");

  const existing = await db
    .select({ id: members.id, familyId: members.familyId })
    .from(members)
    .where(and(eq(members.userId, owner.id), eq(members.role, "organiser")))
    .limit(1);
  const already = existing[0];

  const seed =
    already === undefined
      ? await seedFamily(db, {
          now,
          familyName: "Your family",
          organiserName: "You",
          memberName: "Mom",
          timeZone: "Asia/Taipei",
          organiserExternalId: channelIds(authSubject).organiser,
          memberExternalId: channelIds(authSubject).member,
        })
      : null;

  if (seed !== null) {
    await db.update(members).set({ userId: owner.id }).where(eq(members.id, seed.organiser.id));
  }
  const familyId = seed?.family.id ?? already?.familyId;
  if (familyId === undefined) throw new Error("no family to seed");

  const [keptLight] = await db
    .select()
    .from(members)
    .where(and(eq(members.familyId, familyId), eq(members.lightOn, true)))
    .limit(1);
  if (keptLight === undefined) throw new Error("that family keeps no light");

  const [asker] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.familyId, familyId), eq(members.role, "organiser")))
    .limit(1);
  if (asker === undefined) throw new Error("that family has no organiser");

  // The day is rewritten on every run, so a second run refreshes it rather than stacking asks.
  // Her answer and the replies go with it: Today reads those rows, not the exchange's timestamps.
  // Her own local day, which is what Today reads; the machine’s UTC date is not hers.
  const today = localDateOf(now, keptLight.tz);
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const ids = channelIds(authSubject);
  await db
    .delete(exchanges)
    .where(and(eq(exchanges.recipientId, keptLight.id), eq(exchanges.scheduledFor, today)));
  const [exchange] = await db
    .insert(exchanges)
    .values({
      familyId,
      recipientId: keptLight.id,
      askerId: asker.id,
      type: "question",
      state: "answered",
      text: "What did the garden look like this morning?",
      textLang: "en",
      scheduledFor: today,
      deliveredAt: minutesAgo(120),
      seenAt: minutesAgo(95),
      answeredAt: minutesAgo(90),
    })
    .returning();
  if (exchange === undefined) throw new Error("the day could not be written");

  await db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: keptLight.id,
    kind: "text",
    channel: "telegram",
    externalId: `${ids.member}:dev-answer`,
    payload: {
      text: "The tomatoes finally turned. I picked three before breakfast and left them on the sill.",
    },
    receivedAt: minutesAgo(90),
  });
  await db.insert(replies).values([
    {
      exchangeId: exchange.id,
      memberId: asker.id,
      kind: "heart",
      channel: "telegram",
      createdAt: minutesAgo(80),
    },
    {
      exchangeId: exchange.id,
      memberId: asker.id,
      kind: "text",
      text: "Those are the ones from the seeds you saved",
      channel: "telegram",
      externalId: `${ids.organiser}:dev-reply`,
      createdAt: minutesAgo(75),
    },
  ]);

  // Tomorrow's turn, and the suggestions the nightly job would write from the question bank, so the
  // second card on Today has something to show as well.
  const tomorrow = addDays(today, 1);
  await db
    .insert(turns)
    .values({
      familyId,
      localDay: tomorrow,
      recipientId: keptLight.id,
      holderId: asker.id,
      promptedAt: minutesAgo(5),
    })
    .onConflictDoNothing();
  const written = await writeSuggestions({
    db,
    clock: { now: () => now },
    ai: createOffAi(),
    logger: {
      info: () => {},
      warn: (event, fields) => console.warn(`[seed] ${event}`, fields ?? {}),
      error: (event, fields) => console.error(`[seed] ${event}`, fields ?? {}),
    },
  });

  console.log(`[seed] family ${familyId} belongs to ${authSubject}`);
  console.log(`[seed] ${keptLight.displayName} keeps the light, and today is answered`);
  console.log(`[seed] ${written.written} suggestions written, ${written.existing} already there`);
} finally {
  await connection.close();
}
