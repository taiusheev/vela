/**
 * Her yes, on this machine:
 *
 *   pnpm --filter @vela/worker consent:dev -- user_123abc
 *
 * The argument is the organiser's Clerk user id, as for `seed:dev`. A family made in the app waits
 * for the kept-light member to open her link and say yes. Here that link opens a Telegram bot whose
 * webhook answers from its own deployment's database, never this one, so her tap can never land.
 * This stands in for it: the same member and consent fields the real yes writes, with evidence that
 * says no tap was made, so the row can never pass for one.
 *
 * It refuses any database that is not local, and a family with nobody waiting for a yes.
 */
import { connectDatabase, members, users } from "@vela/db";
import { acceptInvitationForDevelopment } from "@vela/services/testing";
import { and, eq, isNull } from "drizzle-orm";

// pnpm forwards its own `--` separator, so the id is the first argument that is not one.
const authSubject = process.argv
  .slice(2)
  .map((argument) => argument.trim())
  .find((argument) => argument.length > 0 && argument !== "--");
if (authSubject === undefined) {
  console.error(
    "[consent] give the organiser's Clerk user id: pnpm --filter @vela/worker consent:dev -- user_123",
  );
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error("[consent] DATABASE_URL is not set. See infra/README.md, section 9a.");
  process.exit(2);
}
const { hostname } = new URL(databaseUrl);
if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
  console.error(
    `[consent] DATABASE_URL points at ${hostname}; this only stands in on a local database.`,
  );
  process.exit(2);
}

const connection = await connectDatabase(databaseUrl);
try {
  const [organiser] = await connection.db
    .select({ familyId: members.familyId })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(users.authSubject, authSubject),
        eq(members.role, "organiser"),
        isNull(members.leftAt),
      ),
    )
    .limit(1);
  if (organiser === undefined) {
    console.error(`[consent] ${authSubject} runs no family here.`);
    process.exit(2);
  }
  const waiting = await connection.db
    .select({ id: members.id, name: members.displayName })
    .from(members)
    .where(
      and(
        eq(members.familyId, organiser.familyId),
        eq(members.status, "invited"),
        isNull(members.leftAt),
      ),
    );
  if (waiting.length === 0) {
    console.error("[consent] nobody in that family is waiting for a yes.");
    process.exit(2);
  }
  for (const member of waiting) {
    const accepted = await acceptInvitationForDevelopment(connection.db, member.id, new Date());
    console.log(
      `[consent] ${member.name} said yes (stood in); her mornings start ${accepted.lightStartsOn}.`,
    );
  }
} finally {
  await connection.close();
}
