import { type ApiParentConnection, ApiParentLink, ParentLinkRequest } from "@vela/contracts";
import { t } from "@vela/copy";
import { channelLinks, events, invites, members } from "@vela/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import type { ApiFamilyDeps } from "./api-families.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import { VelaError } from "./errors.ts";
import { insertInvite, lineInviteLink } from "./invites.ts";

/** Reuse an unspent invitation, renewing only after expiry. Never creates another parent. */
export async function shareApiParentLink(
  deps: ApiFamilyDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
) {
  const parsed = ParentLinkRequest.safeParse(input);
  if (
    !parsed.success ||
    !z.uuid().safeParse(familyId).success ||
    !z.uuid().safeParse(memberId).success
  )
    throw new ApiIdempotencyError("invalid");
  const family = familyId.toLowerCase();
  const parent = memberId.toLowerCase();
  const notFound = () => new VelaError("not_found", "Parent not found");
  let organiserId = "";
  return runApiMutation(
    deps,
    identity,
    { key, operation: "parent.link:v1", input: parsed.data, familyId: family, memberId: parent },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
        organiserId = access.access.memberId;
        const [member] = await tx
          .select()
          .from(members)
          .where(and(eq(members.id, parent), eq(members.familyId, family), isNull(members.leftAt)))
          .for("update");
        if (
          member === undefined ||
          member.wakeTime === null ||
          !["invited", "active", "paused"].includes(member.status)
        )
          throw notFound();
      },
      mutate: async (tx) => {
        const [member] = await tx.select().from(members).where(eq(members.id, parent));
        const [organiser] = await tx.select().from(members).where(eq(members.id, organiserId));
        if (member === undefined || organiser === undefined) throw notFound();
        const existing = await tx
          .select()
          .from(invites)
          .where(and(eq(invites.familyId, family), eq(invites.forMemberId, parent)))
          .orderBy(desc(invites.createdAt));
        // The link was already used: send her back to her own chat, never enroll her again.
        const linked =
          member.status !== "invited" || existing.some((invite) => invite.acceptedAt !== null);
        const useLine = member.primarySurface === "line" && deps.config.lineBasicId != null;
        if (linked) {
          const url = useLine
            ? `https://line.me/R/oaMessage/${encodeURIComponent(deps.config.lineBasicId ?? "")}/`
            : `https://t.me/${deps.config.telegramBotUsername}`;
          return {
            status: 200,
            body: ApiParentLink.parse({ kind: "chat", url, text: url, expires_at: null }),
          };
        }
        const now = deps.clock.now();
        let invite = existing.find((item) => item.acceptedAt === null && item.expiresAt > now);
        if (invite === undefined)
          invite = (
            await insertInvite(
              deps,
              tx,
              { familyId: family, invitedBy: organiserId, forMemberId: parent },
              now,
            )
          ).invite;
        const url = useLine
          ? lineInviteLink(deps.config.lineBasicId ?? "", invite.token)
          : `https://t.me/${deps.config.telegramBotUsername}?start=${invite.token}`;
        return {
          status: 200,
          body: ApiParentLink.parse({
            kind: "invite",
            url,
            text: t(member.language, "invite.for_her", {
              name: member.displayName,
              organiser: organiser.displayName,
              link: url,
            }),
            expires_at: invite.expiresAt.toISOString(),
          }),
        };
      },
    },
  );
}

/** Opening an invitation binds the chat; only the later consent changes invited to active. */
export async function loadApiParentConnection(
  deps: Pick<ApiFamilyDeps, "db">,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
): Promise<ApiParentConnection> {
  if (!z.uuid().safeParse(familyId).success || !z.uuid().safeParse(memberId).success)
    throw new VelaError("not_found", "Parent not found");
  const family = familyId.toLowerCase(),
    parent = memberId.toLowerCase();
  const access = await authorizeFamilyAccess(deps.db, identity, family, "organiser");
  if (access.kind !== "granted") throw new VelaError("not_found", "Parent not found");
  const [member] = await deps.db
    .select()
    .from(members)
    .where(and(eq(members.id, parent), eq(members.familyId, family), isNull(members.leftAt)));
  if (member === undefined) {
    const [declined] = await deps.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.familyId, family),
          eq(events.memberId, parent),
          eq(events.name, "consent_declined"),
        ),
      )
      .limit(1);
    return { state: declined === undefined ? "unavailable" : "declined" };
  }
  if (member.wakeTime === null || !["invited", "active", "paused"].includes(member.status))
    return { state: "unavailable" };
  const [link] = await deps.db
    .select()
    .from(channelLinks)
    .where(
      and(
        eq(channelLinks.memberId, parent),
        eq(
          channelLinks.channel,
          member.primarySurface === "parent-surface" ? "device" : member.primarySurface,
        ),
      ),
    )
    .limit(1);
  if (link?.blockedAt != null) return { state: "unavailable" };
  if (member.status === "invited") return { state: link === undefined ? "waiting" : "opened" };
  if (member.status === "paused") return { state: "paused" };
  return { state: link === undefined ? "unavailable" : "connected" };
}
