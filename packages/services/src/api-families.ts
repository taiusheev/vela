import { ApiCreatedFamily, type ApiMutationResponse, CreateFamily } from "@vela/contracts";
import { t } from "@vela/copy";
import { families, members, users } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import type { SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { insertInvite, insertInvitedMember } from "./invites.ts";
import { regionForCountry } from "./onboarding.ts";

/** What creating a family needs beyond the database: a token for her invite, the bot it opens, and
 * the regions whose database exists here. */
export type ApiFamilyDeps = Pick<Deps, "db" | "clock" | "random"> & {
  config: Pick<Deps["config"], "telegramBotUsername" | "regions">;
};

/**
 * The account already runs a family. The app shows one family, and a second would sit behind the
 * first with nothing to reach it by until there is a family switcher (spec A6), so it is refused.
 */
export class AlreadyOrganiserError extends Error {
  override readonly name = "AlreadyOrganiserError";

  constructor() {
    super("This account already runs a family");
  }
}

/**
 * Create a family from the app (`POST /v1/families`, API contract §2, spec §14.1 A1).
 *
 * The same rows Telegram onboarding writes, through the same helpers: the family, the caller as its
 * organiser, and her as an invited kept-light member whose light is off until she says yes, with a
 * single-use invite a week long. Nothing about her is consented here. The link opens the bot, which
 * reads her the consent request and records her answer; this route only hands the organiser the
 * link and the words to send it with, in her language.
 *
 * The caller's account must exist already (`POST /v1/me/provision`): that is where the organiser's
 * name, language and time zone come from. The one-family rule is checked in `mutate`, not in
 * `authorize`: `authorize` runs again on a replay, when the caller already is this family's
 * organiser, and would refuse the replay its own answer.
 *
 * The response carries the invite link, so the receipt that replays it holds the token for its
 * 24 hours. It is never logged, and it reaches only the organiser who asked for it.
 */
export async function createApiFamily(
  deps: ApiFamilyDeps,
  identity: SessionIdentity,
  key: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = CreateFamily.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const request = parsed.data;
  const now = deps.clock.now();

  return runApiMutation(
    deps,
    identity,
    { key, operation: "family.create:v1", input: request },
    {
      authorize: async (tx) => {
        const [account] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.authSubject, identity.authSubject), isNull(users.deletedAt)))
          .for("update");
        if (account === undefined) throw new VelaError("not_found", "Account not found");
      },
      mutate: async (tx) => {
        const [account] = await tx
          .select()
          .from(users)
          .where(and(eq(users.authSubject, identity.authSubject), isNull(users.deletedAt)));
        if (account === undefined) throw new VelaError("not_found", "Account not found");

        const [running] = await tx
          .select({ id: members.id })
          .from(members)
          .innerJoin(families, eq(families.id, members.familyId))
          .where(
            and(
              eq(members.userId, account.id),
              eq(members.role, "organiser"),
              isNull(members.leftAt),
              isNull(families.deletedAt),
            ),
          )
          .limit(1);
        if (running !== undefined) throw new AlreadyOrganiserError();

        const region = regionForCountry(deps.config.regions, request.country);
        const [family] = await tx
          .insert(families)
          .values({
            name: account.displayName,
            region,
            country: request.country,
            language: account.language,
            createdAt: now,
          })
          .returning();
        if (family === undefined) throw new Error("family insert returned no row");

        const [organiser] = await tx
          .insert(members)
          .values({
            familyId: family.id,
            userId: account.id,
            role: "organiser",
            billing: true,
            displayName: account.displayName,
            language: account.language,
            tz: account.tz,
            country: request.country,
            status: "active",
            primarySurface: "app",
            createdAt: now,
          })
          .returning();
        if (organiser === undefined) throw new Error("organiser insert returned no row");

        const person = request.kept_light_member;
        const her = await insertInvitedMember(
          tx,
          {
            familyId: family.id,
            name: person.display_name,
            address: person.address_form,
            language: person.language,
            timeZone: person.tz,
            country: request.country,
            wakeTime: person.wake_time,
          },
          now,
        );
        const { invite, link } = await insertInvite(
          deps,
          tx,
          { familyId: family.id, invitedBy: organiser.id, forMemberId: her.id },
          now,
        );

        await recordEvent(
          tx,
          {
            name: "family_created",
            familyId: family.id,
            memberId: organiser.id,
            surface: "app",
            props: { country: request.country, region, language: her.language, nearby_contacts: 0 },
          },
          now,
        );

        if (her.arrivalTime === null) throw new Error("an invited member has an arrival time");
        return {
          status: 201,
          body: ApiCreatedFamily.parse({
            family: { id: family.id, name: family.name, region, country: family.country },
            organiser_member_id: organiser.id,
            kept_light_member: {
              id: her.id,
              display_name: her.displayName,
              status: her.status,
              arrival_time: her.arrivalTime,
            },
            invite: {
              url: link,
              expires_at: invite.expiresAt.toISOString(),
              text: t(her.language, "invite.for_her", {
                name: her.displayName,
                organiser: organiser.displayName,
                link,
              }),
            },
          }),
        };
      },
    },
  );
}
