/** Private owner setup only. No HTTP route or provider credentials are added to the app. */
import { localDateOf } from "@vela/core";
import {
  adminAccessLog,
  answers,
  channelLinks,
  exchanges,
  families,
  familyChannels,
  invites,
  members,
  nearbyContacts,
  pilotFamilies,
  replies,
  users,
  type VelaTransaction,
} from "@vela/db";
import { eq, inArray, sql } from "drizzle-orm";
import { runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";

// This is the dedicated, fictional identity created and approved by the founder on 2 Nov 2026.
// An auth subject is an identifier, never a password, token, or way to bypass Clerk.
export const APP_REVIEW_SUBJECT = "user_3LY9t7bbKftHcTmrboqGAQVazz1";
export const APP_REVIEW_FAMILY = "019a4310-0000-7000-8000-000000000001";
const ORGANISER = "019a4310-0000-7000-8000-000000000002";
const PARENT = "019a4310-0000-7000-8000-000000000003";

export class ReviewerFixtureRefused extends Error {
  override readonly name = "ReviewerFixtureRefused";
  constructor() {
    super("Reviewer setup stopped: the dedicated fixture is not isolated.");
  }
}

function requireFixture(condition: boolean): asserts condition {
  if (!condition) throw new ReviewerFixtureRefused();
}

/** Only the dedicated subject and fixed fixture IDs may be read or changed. Never reset a family. */
async function isolated(tx: VelaTransaction): Promise<void> {
  const [account] = await tx.select().from(users).where(eq(users.authSubject, APP_REVIEW_SUBJECT));
  if (account !== undefined) {
    requireFixture(account.deletedAt === null);
    const membership = await tx
      .select({ familyId: members.familyId })
      .from(members)
      .where(eq(members.userId, account.id));
    requireFixture(membership.every((row) => row.familyId === APP_REVIEW_FAMILY));
    const owned = await tx
      .select({ id: families.id })
      .from(families)
      .where(eq(families.createdBy, account.id));
    requireFixture(owned.every((row) => row.id === APP_REVIEW_FAMILY));
  }
  const [family] = await tx.select().from(families).where(eq(families.id, APP_REVIEW_FAMILY));
  if (family !== undefined) {
    requireFixture(
      account !== undefined &&
        family.createdBy === account.id &&
        family.name === "Apple Review" &&
        family.deletedAt === null,
    );
    // The live database can precede main's optional weekly_feedback column. Read only the
    // established fields this one-time helper owns, not every column in the current app schema.
    const people = await tx
      .select({
        id: members.id,
        userId: members.userId,
        role: members.role,
        displayName: members.displayName,
        status: members.status,
        nextWakeAt: members.nextWakeAt,
        lightConsentedAt: members.lightConsentedAt,
        lightStartsOn: members.lightStartsOn,
        lightOn: members.lightOn,
        turnsIn: members.turnsIn,
        wakeTime: members.wakeTime,
        primarySurface: members.primarySurface,
      })
      .from(members)
      .where(eq(members.familyId, APP_REVIEW_FAMILY));
    requireFixture(people.length === 2);
    requireFixture(
      people.some(
        (person) =>
          person.id === ORGANISER &&
          person.userId === account.id &&
          person.displayName === "Demo Organiser",
      ),
    );
    requireFixture(
      people.some(
        (person) =>
          person.id === PARENT &&
          person.userId === null &&
          person.displayName === "Demo Parent" &&
          person.status === "invited" &&
          person.nextWakeAt === null &&
          person.lightConsentedAt === null &&
          person.lightStartsOn === null &&
          person.lightOn === false &&
          person.turnsIn === false &&
          person.wakeTime === "07:30" &&
          person.primarySurface === "line",
      ),
    );
  }
  for (const table of [familyChannels, invites, nearbyContacts]) {
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.familyId, APP_REVIEW_FAMILY))
      .limit(1);
    requireFixture(rows.length === 0);
  }
  const links = await tx
    .select({ id: channelLinks.id })
    .from(channelLinks)
    .where(inArray(channelLinks.memberId, [ORGANISER, PARENT]))
    .limit(1);
  requireFixture(links.length === 0);
}

/**
 * A one-time, idempotent synthetic fixture. Uses the same account lock as normal app writes.
 * No consent, channel, invite, push, scheduled wake, event metric, or outbound job is fabricated.
 * The sample is a UI example, not evidence that a real messenger delivered anything.
 */
export async function prepareAppReviewFamily(deps: Pick<Deps, "db" | "clock">, subject: string) {
  requireFixture(subject === APP_REVIEW_SUBJECT);
  return runApiMutation(
    deps,
    { authSubject: subject, sessionId: "private-owner-setup" },
    {
      key: "private-app-review-family-v1",
      operation: "private.app-review-family:v1",
      input: { fixture: "apple-review-v1" },
      familyId: APP_REVIEW_FAMILY,
    },
    {
      authorize: isolated,
      mutate: async (tx) => {
        const [existing] = await tx
          .select({ id: families.id })
          .from(families)
          .where(eq(families.id, APP_REVIEW_FAMILY));
        if (existing !== undefined)
          return { status: 200, body: { family_id: existing.id, created: false } };
        const now = deps.clock.now();
        const [account] = await tx
          .insert(users)
          .values({
            authSubject: subject,
            displayName: "Demo Organiser",
            language: "en",
            tz: "Asia/Taipei",
            oneMomentADay: false,
          })
          .onConflictDoNothing({ target: users.authSubject })
          .returning({ id: users.id });
        const owner =
          account ??
          (await tx.select({ id: users.id }).from(users).where(eq(users.authSubject, subject)))[0];
        requireFixture(owner !== undefined);
        await tx.insert(families).values({
          id: APP_REVIEW_FAMILY,
          name: "Apple Review",
          region: "apac",
          country: "TW",
          language: "en",
          plan: "free",
          turnsEnabled: false,
          createdBy: owner.id,
        });
        // Explicit columns also make insertion work before the optional weekly-feedback migration.
        await tx.execute(sql`insert into members
          (id, family_id, user_id, role, display_name, language, tz, country, status,
           turns_in, primary_surface, light_on, wake_time)
          values
          (${ORGANISER}, ${APP_REVIEW_FAMILY}, ${owner.id}, 'organiser', 'Demo Organiser',
           'en', 'Asia/Taipei', 'TW', 'active', false, 'app', false, null),
          (${PARENT}, ${APP_REVIEW_FAMILY}, null, 'member', 'Demo Parent',
           'en', 'Asia/Taipei', 'TW', 'invited', false, 'line', false, '07:30')`);
        const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
        const [exchange] = await tx
          .insert(exchanges)
          .values({
            familyId: APP_REVIEW_FAMILY,
            recipientId: PARENT,
            askerId: ORGANISER,
            type: "question",
            state: "read_back",
            text: "Demo question: what small thing made you smile today?",
            textLang: "en",
            scheduledFor: localDateOf(ago(10), "Asia/Taipei"),
            createdAt: ago(10),
            deliveredAt: ago(8),
            seenAt: ago(7),
            answeredAt: ago(6),
            repliedAt: ago(4),
            readBackAt: ago(3),
          })
          .returning({ id: exchanges.id });
        requireFixture(exchange !== undefined);
        await tx.insert(answers).values({
          exchangeId: exchange.id,
          memberId: PARENT,
          kind: "text",
          channel: "app",
          payload: { text: "Demo answer: I enjoyed a cup of tea by the window." },
          receivedAt: ago(6),
          understoodAt: ago(6),
        });
        await tx.insert(replies).values({
          exchangeId: exchange.id,
          memberId: ORGANISER,
          kind: "text",
          channel: "app",
          text: "Demo reply: thank you for sharing this little moment.",
          toRecipient: false,
          createdAt: ago(4),
          readBackAt: ago(3),
        });
        await tx.insert(pilotFamilies).values({ familyId: APP_REVIEW_FAMILY, approvedAt: now });
        await tx.insert(adminAccessLog).values({
          admin: "private-owner-reviewer-setup",
          familyId: APP_REVIEW_FAMILY,
          action: "family_approve",
          what: "created isolated synthetic app-review fixture v1; no live delivery",
          at: now,
        });
        await isolated(tx);
        return { status: 201, body: { family_id: APP_REVIEW_FAMILY, created: true } };
      },
    },
  );
}
