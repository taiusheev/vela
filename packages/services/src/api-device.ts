import type { ApiMutationResponse } from "@vela/contracts";
import { outboundKey } from "@vela/core";
import { channelLinks, type Member, members } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { runApiMutation } from "./api-idempotency.ts";
import { consentRequestMessage } from "./consent.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { insertOutbound } from "./gateway.ts";
import { familyById, type Queryable } from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 32 random bytes, base64url: what her phone holds, and only its hash is kept. */
const DEVICE_TOKEN_BYTES = 32;
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The SHA-256 of a device token, as hex: what `channel_links.external_id` holds on `device`. */
export async function deviceTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function notFound(): VelaError {
  return new VelaError("not_found", "Not found");
}

/** A kept-light member her phone can be set up for: hers to answer from, invited or not. */
function canHaveDevice(member: Member | undefined, familyId: string): member is Member {
  return (
    member !== undefined &&
    member.familyId === familyId &&
    member.role === "member" &&
    member.leftAt === null &&
    (member.status === "invited" || member.status === "active" || member.status === "paused")
  );
}

/**
 * "Set up this phone for Mom" (`POST /v1/families/:familyId/members/:memberId/device`, ADR-35): an
 * organiser, signed in on her phone, makes it hers. A new token is made, only its hash is kept on a
 * `device` link, any earlier phone of hers stops working, and she reads and answers from this one
 * (`primary_surface` `parent-surface`). The token is answered once and kept nowhere else.
 *
 * Not through `runApiMutation`: a receipt keeps the response to replay it, and this response is a
 * credential, which no receipt may hold. A retry after a lost answer sets the phone up again, with
 * a new token that voids the one that was lost, so two attempts still leave one phone set up. Her
 * member row is locked first, so two organisers setting up at once leave the second one's phone.
 *
 * Set up before her yes, the phone is sent the consent request a Telegram chat gets when she opens
 * her invite (flows §3.2), as a row the caller hands to the queue after the commit (`after`); her
 * tap on it goes through `handleConsentButton` like any other.
 */
export async function setUpApiDevice(
  deps: Pick<Deps, "db" | "clock" | "random"> & {
    config: Pick<Deps["config"], "privacyNoticeUrls">;
  },
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
): Promise<{ body: { member_id: string; token: string }; after: AfterCommit }> {
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = memberId.toLowerCase();
  const now = deps.clock.now();
  const token = deps.random.token(DEVICE_TOKEN_BYTES);
  const hash = await deviceTokenHash(token);
  const after = nothingAfterCommit();

  await deps.db.transaction(async (tx) => {
    const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
    if (access.kind !== "granted") throw notFound();
    const [her] = await tx
      .select()
      .from(members)
      .where(and(eq(members.id, herId), eq(members.familyId, family)))
      .for("update");
    if (!canHaveDevice(her, family)) throw notFound();

    await tx
      .delete(channelLinks)
      .where(and(eq(channelLinks.memberId, her.id), eq(channelLinks.channel, "device")));
    const [link] = await tx
      .insert(channelLinks)
      .values({
        memberId: her.id,
        channel: "device",
        externalId: hash,
        linkedAt: now,
        meta: { set_up_by: access.access.memberId },
      })
      .returning({ id: channelLinks.id });
    const familyRow = await familyById(tx, family);
    if (
      link !== undefined &&
      familyRow !== null &&
      her.status === "invited" &&
      her.lightConsentedAt === null
    ) {
      const written = await insertOutbound(deps, tx, {
        kind: "consent",
        idempotencyKey: outboundKey("consent", {
          conversationId: hash,
          suffix: `request:device:${link.id}`,
        }),
        memberId: her.id,
        channel: "device",
        conversationId: hash,
        lang: her.language,
        ...(await consentRequestMessage(deps, tx, her, familyRow)),
        ref: { purpose: "consent", memberId: her.id },
      });
      if ("outboundId" in written) after.outboundIds.push(written.outboundId);
    }
    await tx
      .update(members)
      .set({ primarySurface: "parent-surface" })
      .where(eq(members.id, her.id));
    await recordEvent(
      tx,
      {
        name: "device_set_up",
        familyId: family,
        memberId: her.id,
        surface: "app",
        props: { by: access.access.memberId },
      },
      now,
    );
  });
  return { body: { member_id: herId, token }, after };
}

/**
 * Taking her phone off the parent surface (`POST .../members/:memberId/device/remove`): its link
 * goes, so its token stops working at once, and her primary surface goes back to Telegram where
 * she has a link there, else to the app. Organisers only; a phone already removed answers removed.
 */
export async function removeApiDevice(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = memberId.toLowerCase();
  const now = deps.clock.now();
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "device.remove:v1",
      input: { member_id: herId },
      familyId: family,
      memberId: herId,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
        const [inFamily] = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.id, herId), eq(members.familyId, family)))
          .limit(1);
        if (inFamily === undefined) throw notFound();
      },
      mutate: async (tx) => {
        const [her] = await tx.select().from(members).where(eq(members.id, herId)).for("update");
        if (!canHaveDevice(her, family)) throw notFound();
        const removed = await tx
          .delete(channelLinks)
          .where(and(eq(channelLinks.memberId, her.id), eq(channelLinks.channel, "device")))
          .returning({ id: channelLinks.id });
        if (removed.length > 0) {
          const [telegram] = await tx
            .select({ id: channelLinks.id })
            .from(channelLinks)
            .where(and(eq(channelLinks.memberId, her.id), eq(channelLinks.channel, "telegram")))
            .limit(1);
          await tx
            .update(members)
            .set({ primarySurface: telegram === undefined ? "app" : "telegram" })
            .where(eq(members.id, her.id));
          await recordEvent(
            tx,
            {
              name: "device_removed",
              familyId: family,
              memberId: her.id,
              surface: "app",
              props: {},
            },
            now,
          );
        }
        return { status: 200, body: { member_id: her.id, removed: true } };
      },
    },
  );
}

/**
 * The kept-light member a device token belongs to, for her own routes (ADR-35): the `device` link
 * holding the token's hash, not blocked, of a member who has not left. Null for anything else, so
 * a token that was never issued, was replaced, or was removed is the same 401.
 */
export async function memberOfDeviceToken(db: Queryable, token: string): Promise<Member | null> {
  if (!DEVICE_TOKEN.test(token)) return null;
  const hash = await deviceTokenHash(token);
  const [row] = await db
    .select({ member: members })
    .from(channelLinks)
    .innerJoin(members, eq(members.id, channelLinks.memberId))
    .where(
      and(
        eq(channelLinks.channel, "device"),
        eq(channelLinks.externalId, hash),
        isNull(channelLinks.blockedAt),
        isNull(members.leftAt),
      ),
    )
    .limit(1);
  return row?.member ?? null;
}
