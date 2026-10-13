/**
 * Her own health words in the weekly read (ADR-47): the ones she said on two or more days of the
 * week, quoted, for organisers and for her when she asks what the family sees.
 *
 * Nothing is stored for this. The words are read from her answers each time the read is shown, so
 * they go when retention clears the answers' mentions at 30 days, and they go at once when she
 * withdraws her yes. Only a yes to a question that named the weekly read counts
 * (`WEEKLY_HEALTH_TEXT_VERSIONS`), and only answers given after that yes; the model never sees them.
 */
import type { LocalDate } from "@vela/contracts";
import {
  addDays,
  localDateOf,
  recurringHealthWords,
  type WeeklyHealthMention,
  zonedInstant,
} from "@vela/core";
import { answers, consents, type Member } from "@vela/db";
import { and, asc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { WEEKLY_HEALTH_TEXT_VERSIONS } from "./consent.ts";
import type { Queryable } from "./repo.ts";

const DAYS_IN_WEEK = 7;

/** Her health words of the week starting `weekStart` that the read may quote at `at`. */
export async function weeklyHealthMentions(
  db: Queryable,
  member: Pick<Member, "id" | "tz">,
  weekStart: LocalDate,
  at: Date,
): Promise<WeeklyHealthMention[]> {
  const [consent] = await db
    .select({ givenAt: consents.givenAt })
    .from(consents)
    .where(
      and(
        eq(consents.memberId, member.id),
        eq(consents.kind, "health_words"),
        eq(consents.answer, "yes"),
        inArray(consents.textVersion, [...WEEKLY_HEALTH_TEXT_VERSIONS]),
        lte(consents.givenAt, at),
        isNull(consents.withdrawnAt),
      ),
    )
    .orderBy(asc(consents.givenAt))
    .limit(1);
  if (consent === undefined) {
    return [];
  }
  const weekFrom = zonedInstant(weekStart, "00:00", member.tz);
  const from = consent.givenAt > weekFrom ? consent.givenAt : weekFrom;
  const rows = await db
    .select({ receivedAt: answers.receivedAt, mentions: answers.mentions })
    .from(answers)
    .where(
      and(
        eq(answers.memberId, member.id),
        gte(answers.receivedAt, from),
        lt(answers.receivedAt, zonedInstant(addDays(weekStart, DAYS_IN_WEEK), "00:00", member.tz)),
      ),
    )
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  return recurringHealthWords(
    rows.map((row) => {
      const health = row.mentions.health;
      return {
        date: localDateOf(row.receivedAt, member.tz),
        words: Array.isArray(health)
          ? health.filter((word): word is string => typeof word === "string")
          : [],
      };
    }),
  );
}
