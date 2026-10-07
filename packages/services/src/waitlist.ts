import { waitlistSignups } from "@vela/db";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import type { Queryable } from "./repo.ts";

/** The languages the website is written in, and so the ones a signup can be in. */
export const WAITLIST_LANGS = ["en", "zh-TW"] as const;
export type WaitlistLang = (typeof WAITLIST_LANGS)[number];

export const WAITLIST_ROLES = ["organiser", "parent", "other"] as const;
export type WaitlistRole = (typeof WAITLIST_ROLES)[number];

/** What the website's form sends, before anything is stored. */
export const WaitlistInput = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  lang: z.enum(WAITLIST_LANGS),
  role: z.enum(WAITLIST_ROLES).nullable(),
});
export type WaitlistInput = z.infer<typeof WaitlistInput>;

/**
 * Someone asks to hear when Vela opens (the public website, launch gate 14). The address is the
 * key: asking again, or two submits of the same form racing, keeps the one row and answers the
 * same, so a person can never tell from the answer whether an address was already on the list.
 * Not `runApiMutation`: nobody is signed in, and the unique address is the idempotency key.
 */
export async function joinWaitlist(db: Queryable, input: WaitlistInput): Promise<void> {
  await db
    .insert(waitlistSignups)
    .values({ email: input.email, language: input.lang, role: input.role })
    .onConflictDoNothing({ target: waitlistSignups.email });
}

/** The list for the founder's admin page, newest first, with the count by language. */
export async function loadWaitlist(db: Queryable): Promise<{
  total: number;
  byLanguage: Record<WaitlistLang, number>;
  latest: { email: string; language: WaitlistLang; role: WaitlistRole | null; createdAt: Date }[];
}> {
  const counts = await db
    .select({ language: waitlistSignups.language, n: sql<number>`count(*)`.mapWith(Number) })
    .from(waitlistSignups)
    .groupBy(waitlistSignups.language);
  const byLanguage: Record<WaitlistLang, number> = { en: 0, "zh-TW": 0 };
  for (const row of counts) byLanguage[row.language] = row.n;
  const latest = await db
    .select({
      email: waitlistSignups.email,
      language: waitlistSignups.language,
      role: waitlistSignups.role,
      createdAt: waitlistSignups.createdAt,
    })
    .from(waitlistSignups)
    .orderBy(desc(waitlistSignups.createdAt), desc(waitlistSignups.id))
    .limit(500);
  return { total: byLanguage.en + byLanguage["zh-TW"], byLanguage, latest };
}
