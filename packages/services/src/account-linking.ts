import {
  ApiIdempotencyKey,
  ApiLinkChallenge,
  ApiLinkCode,
  ApiLinkOutcome,
  ApiLinkStatus,
  type ApiMutationResponse,
  InboundEvent,
} from "@vela/contracts";
import { t } from "@vela/copy";
import { outboundKey } from "@vela/core";
import {
  accountLinkChallenges,
  channelLinks,
  families,
  members,
  outbound,
  users,
  type VelaTransaction,
} from "@vela/db";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, lockApiActor, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { enqueueOutbound } from "./gateway.ts";
import { sendOutsideGateway } from "./group.ts";
import { sha256Hex } from "./hash.ts";
import { type PilotAdmission, pilotAllowsTelegram } from "./pilot-admission.ts";
import { memberByChannelUser, type Queryable } from "./repo.ts";

const lifetime = 15 * 60 * 1_000;
const uuid = z.uuid();
type Challenge = typeof accountLinkChallenges.$inferSelect;
type Member = typeof members.$inferSelect;

function denied(): never {
  throw new VelaError("not_found", "Account link not found");
}

function conflict(): never {
  throw new ApiIdempotencyError("conflict");
}

function validateIdentity(identity: SessionIdentity, key: string): void {
  if (
    identity === null ||
    typeof identity !== "object" ||
    typeof identity.authSubject !== "string" ||
    identity.authSubject.trim().length === 0 ||
    typeof identity.sessionId !== "string" ||
    identity.sessionId.trim().length === 0 ||
    typeof key !== "string" ||
    key.length > 200 ||
    !ApiIdempotencyKey.safeParse(key).success ||
    /[^A-Za-z0-9._:-]/.test(key)
  ) {
    throw new ApiIdempotencyError("invalid");
  }
}

function challengeId(value: string): string {
  if (typeof value !== "string" || value.length !== 36 || !uuid.safeParse(value).success) {
    throw new ApiIdempotencyError("invalid");
  }
  return value.toLowerCase();
}

function now(deps: Pick<Deps, "clock">): Date {
  const value = deps.clock.now();
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    !Number.isFinite(new Date(value.getTime() + lifetime).getTime())
  ) {
    throw new Error("Invalid account link clock");
  }
  return new Date(value.getTime());
}

async function lockOwner(tx: VelaTransaction, authSubject: string) {
  const [owner] = await tx
    .select()
    .from(users)
    .where(eq(users.authSubject, authSubject))
    .for("update");
  if (owner === undefined || owner.deletedAt !== null) denied();
  return owner;
}

async function lockChallenge(
  tx: VelaTransaction,
  id: string,
  userId: string,
  sessionHash?: string,
): Promise<Challenge> {
  const [proof] = await tx
    .select()
    .from(accountLinkChallenges)
    .where(
      and(
        eq(accountLinkChallenges.id, id),
        eq(accountLinkChallenges.userId, userId),
        sessionHash === undefined ? undefined : eq(accountLinkChallenges.sessionHash, sessionHash),
      ),
    )
    .for("update");
  if (proof === undefined) denied();
  return proof;
}

async function lockTarget(tx: VelaTransaction, memberId: string, channelLinkId: string) {
  const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (
    member === undefined ||
    member.leftAt !== null ||
    (member.status !== "active" && member.status !== "paused")
  ) {
    denied();
  }
  const [family] = await tx
    .select()
    .from(families)
    .where(eq(families.id, member.familyId))
    .for("share");
  if (family === undefined || family.deletedAt !== null) denied();
  const [link] = await tx
    .select()
    .from(channelLinks)
    .where(eq(channelLinks.id, channelLinkId))
    .for("update");
  if (
    link === undefined ||
    link.memberId !== member.id ||
    link.channel !== "telegram" ||
    link.blockedAt !== null
  ) {
    denied();
  }
  return { member, link };
}

function pending(proof: Challenge, at: Date): boolean {
  return (
    proof.completedAt === null &&
    proof.invalidatedAt === null &&
    proof.expiresAt.getTime() > at.getTime() &&
    proof.attempts < 5
  );
}

function equalDigest(left: string, right: string): boolean {
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function outcome(member?: Member): ApiMutationResponse {
  return {
    status: 200,
    body: ApiLinkOutcome.parse(
      member === undefined
        ? { linked: false }
        : { linked: true, member_id: member.id, family_id: member.familyId },
    ),
  };
}

export async function startAccountLink(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  approval?: { requesterLabel: string },
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  validateIdentity(identity, key);
  if (
    approval !== undefined &&
    (!approval.requesterLabel.trim() ||
      approval.requesterLabel.length > 200 ||
      /[\p{C}]/u.test(approval.requesterLabel))
  )
    throw new ApiIdempotencyError("invalid");
  const sessionHash = await sha256Hex(identity.sessionId);
  let ownerId: string | undefined;
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "account.link.start:v1",
      input: {
        session_hash: sessionHash,
        ...(approval === undefined ? {} : { confirmation: "telegram" }),
      },
    },
    {
      authorize: async (tx) => {
        ownerId = (await lockOwner(tx, identity.authSubject)).id;
      },
      mutate: async (tx) => {
        if (ownerId === undefined) denied();
        const at = now(deps);
        await tx
          .update(accountLinkChallenges)
          .set({ invalidatedAt: at, codeHash: null })
          .where(
            and(
              eq(accountLinkChallenges.userId, ownerId),
              isNull(accountLinkChallenges.completedAt),
              isNull(accountLinkChallenges.invalidatedAt),
              gt(accountLinkChallenges.expiresAt, at),
            ),
          );
        const [proof] = await tx
          .insert(accountLinkChallenges)
          .values({
            userId: ownerId,
            sessionHash,
            approvalRequested: approval !== undefined,
            requesterLabel: approval?.requesterLabel ?? null,
            createdAt: at,
            expiresAt: new Date(at.getTime() + lifetime),
          })
          .returning();
        if (proof === undefined) denied();
        return {
          status: 201,
          body: ApiLinkChallenge.parse({
            challenge_id: proof.id,
            expires_at: proof.expiresAt.toISOString(),
            ...(proof.approvalRequested
              ? { confirmation: "telegram", requester_label: proof.requesterLabel ?? "" }
              : {}),
          }),
        };
      },
    },
  );
}

export async function issueAccountLinkCode(
  deps: Pick<Deps, "clock" | "random"> & { db: Queryable },
  id: string,
  event: InboundEvent,
): Promise<{ code: string; expires_at: string }> {
  const normalizedId = challengeId(id);
  const parsed = InboundEvent.safeParse(event);
  if (
    !parsed.success ||
    parsed.data.channel !== "telegram" ||
    parsed.data.kind !== "start" ||
    parsed.data.conversation.kind !== "private" ||
    parsed.data.sender.externalUserId !== parsed.data.conversation.externalId
  ) {
    throw new ApiIdempotencyError("invalid");
  }
  const externalId = parsed.data.sender.externalUserId;
  const [candidate] = await deps.db
    .select({ userId: users.id, authSubject: users.authSubject })
    .from(accountLinkChallenges)
    .innerJoin(users, eq(users.id, accountLinkChallenges.userId))
    .where(eq(accountLinkChallenges.id, normalizedId));
  if (candidate === undefined || candidate.authSubject === null) denied();
  const authSubject = candidate.authSubject;
  const actorHash = await sha256Hex(authSubject);
  return deps.db.transaction(async (tx) => {
    await lockApiActor(tx, actorHash);
    const owner = await lockOwner(tx, authSubject);
    if (owner.id !== candidate.userId) denied();
    const proof = await lockChallenge(tx, normalizedId, owner.id);
    if (!pending(proof, now(deps))) conflict();
    const [candidateLink] = await tx
      .select({ id: channelLinks.id, memberId: channelLinks.memberId })
      .from(channelLinks)
      .where(and(eq(channelLinks.channel, "telegram"), eq(channelLinks.externalId, externalId)));
    if (candidateLink === undefined) denied();
    const { member, link } = await lockTarget(tx, candidateLink.memberId, candidateLink.id);
    if (link.externalId !== externalId) denied();
    const channelIdentityHash = await sha256Hex(link.externalId);
    if (proof.channelLinkId !== null) {
      if (proof.channelLinkId !== link.id) conflict();
      if (
        proof.familyId !== member.familyId ||
        proof.memberId !== member.id ||
        proof.channelIdentityHash !== channelIdentityHash
      ) {
        denied();
      }
    }
    if (member.userId !== null && member.userId !== owner.id) conflict();
    const code = deps.random.token(16);
    if (!ApiLinkCode.safeParse(code).success || /[^A-Za-z0-9_-]/.test(code)) {
      throw new Error("Invalid account link random code");
    }
    const codeHash = await sha256Hex(JSON.stringify([proof.id, code]));
    if (!pending(proof, now(deps))) conflict();
    await tx
      .update(accountLinkChallenges)
      .set({
        familyId: member.familyId,
        memberId: member.id,
        channelLinkId: link.id,
        channelIdentityHash,
        codeHash,
        approvedAt: null,
      })
      .where(eq(accountLinkChallenges.id, proof.id));
    return { code, expires_at: proof.expiresAt.toISOString() };
  });
}

export async function completeAccountLink(
  deps: Pick<Deps, "db" | "clock"> & { pilotAdmission?: PilotAdmission | null },
  identity: SessionIdentity,
  key: string,
  id: string,
  code: string | undefined,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  validateIdentity(identity, key);
  const normalizedId = challengeId(id);
  if (code !== undefined && (!ApiLinkCode.safeParse(code).success || /[^A-Za-z0-9_-]/.test(code))) {
    throw new ApiIdempotencyError("invalid");
  }
  const sessionHash = await sha256Hex(identity.sessionId);
  const [scope] = await deps.db
    .select({ familyId: accountLinkChallenges.familyId, memberId: accountLinkChallenges.memberId })
    .from(accountLinkChallenges)
    .innerJoin(users, eq(users.id, accountLinkChallenges.userId))
    .where(
      and(
        eq(accountLinkChallenges.id, normalizedId),
        eq(accountLinkChallenges.sessionHash, sessionHash),
        eq(users.authSubject, identity.authSubject),
        isNull(users.deletedAt),
      ),
    );
  if (scope === undefined) denied();
  if (scope.familyId === null || scope.memberId === null) conflict();
  let proof: Challenge | undefined;
  let member: Member | undefined;
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: code === undefined ? "account.link.confirm:v1" : "account.link.complete:v1",
      input: {
        challenge_id: normalizedId,
        session_hash: sessionHash,
        ...(code === undefined ? {} : { code }),
      },
      familyId: scope.familyId,
      memberId: scope.memberId,
    },
    {
      authorize: async (tx) => {
        const owner = await lockOwner(tx, identity.authSubject);
        proof = await lockChallenge(tx, normalizedId, owner.id, sessionHash);
        if (
          proof.memberId === null ||
          proof.channelLinkId === null ||
          proof.familyId !== scope.familyId ||
          proof.memberId !== scope.memberId
        ) {
          denied();
        }
        const target = await lockTarget(tx, proof.memberId, proof.channelLinkId);
        member = target.member;
        if (
          deps.pilotAdmission != null &&
          (member.language !== "en" ||
            !pilotAllowsTelegram(deps.pilotAdmission, target.link.externalId))
        )
          denied();
        if (deps.pilotAdmission != null) {
          const [family] = await tx
            .select({ language: families.language })
            .from(families)
            .where(eq(families.id, member.familyId));
          if (family?.language !== "en") denied();
        }
        if (
          member.familyId !== proof.familyId ||
          (await sha256Hex(target.link.externalId)) !== proof.channelIdentityHash
        ) {
          denied();
        }
        if (
          (member.userId !== null && member.userId !== owner.id) ||
          (proof.completedAt !== null && member.userId !== owner.id)
        ) {
          conflict();
        }
      },
      mutate: async (tx) => {
        if (proof === undefined || member === undefined) denied();
        if (proof.completedAt !== null) return outcome(member);
        const at = now(deps);
        if (!pending(proof, at)) return outcome();
        if (code === undefined && (!proof.approvalRequested || proof.approvedAt === null))
          return outcome();
        const suppliedHash =
          code === undefined ? proof.codeHash : await sha256Hex(JSON.stringify([proof.id, code]));
        if (
          suppliedHash === null ||
          !equalDigest(suppliedHash, proof.codeHash ?? "0".repeat(64)) ||
          proof.codeHash === null
        ) {
          const attempts = proof.attempts + 1;
          await tx
            .update(accountLinkChallenges)
            .set({
              attempts,
              ...(attempts === 5 ? { invalidatedAt: at, codeHash: null } : {}),
            })
            .where(eq(accountLinkChallenges.id, proof.id));
          return outcome();
        }
        const [otherMember] = await tx
          .select({ id: members.id })
          .from(members)
          .where(
            and(
              eq(members.familyId, member.familyId),
              eq(members.userId, proof.userId),
              ne(members.id, member.id),
            ),
          );
        if (otherMember !== undefined) conflict();
        const completedAt = now(deps);
        if (!pending(proof, completedAt)) return outcome();
        if (member.userId === null) {
          await tx.update(members).set({ userId: proof.userId }).where(eq(members.id, member.id));
        }
        await tx
          .update(accountLinkChallenges)
          .set({ completedAt, codeHash: null })
          .where(eq(accountLinkChallenges.id, proof.id));
        await recordEvent(
          tx,
          {
            name: "account_linked",
            familyId: member.familyId,
            memberId: member.id,
            props: { user_id: proof.userId, challenge_id: proof.id, channel: "telegram" },
          },
          completedAt,
        );
        return outcome(member);
      },
    },
  );
}

export function isAccountLinkStart(param: string | undefined): boolean {
  return param?.startsWith("link_") === true;
}

/** The private code is delivered through the durable gateway; retries reuse the same queued code. */
export async function handleAccountLinkStart(deps: Deps, event: InboundEvent): Promise<void> {
  if (
    event.channel !== "telegram" ||
    event.kind !== "start" ||
    event.conversation.kind !== "private" ||
    event.sender.externalUserId !== event.conversation.externalId
  )
    return;
  const linked = await memberByChannelUser(deps.db, "telegram", event.sender.externalUserId);
  const lang = deps.config.pilotAdmission == null ? (linked?.member.language ?? "en") : "en";
  const id = event.startParam?.slice(5) ?? "";
  if (
    linked === null ||
    !pilotAllowsTelegram(deps.config.pilotAdmission, event.sender.externalUserId)
  ) {
    await sendOutsideGateway(deps, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: event.conversation.externalId,
        suffix: `account_link_refused:${event.eventId}`,
      }),
      lang,
      to: { channel: "telegram", conversationId: event.conversation.externalId },
      text: t(lang, "account_link.unavailable"),
    });
    return;
  }
  const key = outboundKey("system", {
    conversationId: event.conversation.externalId,
    suffix: `account_link:${id}:${event.eventId}`,
  });
  await deps.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`account-link-outbound:${key}`}, 0))`,
    );
    const [existing] = await tx
      .select({ id: outbound.id })
      .from(outbound)
      .where(
        and(
          eq(outbound.idempotencyKey, key),
          eq(outbound.memberId, linked.member.id),
          eq(outbound.conversationId, event.conversation.externalId),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      await deps.queues.outbound.send({ type: "deliver", outboundId: existing.id });
      return;
    }
    try {
      const proof = await issueAccountLinkCode({ ...deps, db: tx }, id, event);
      const [request] = await tx
        .select()
        .from(accountLinkChallenges)
        .where(eq(accountLinkChallenges.id, id));
      const modern = request?.approvalRequested === true;
      await enqueueOutbound(deps, tx, {
        kind: "system",
        idempotencyKey: key,
        memberId: linked.member.id,
        channel: "telegram",
        conversationId: event.conversation.externalId,
        lang,
        text: modern
          ? t(lang, "account_link.confirm", {
              account: request.requesterLabel ?? "",
              reference: id.slice(-6).toUpperCase(),
              code: proof.code,
            })
          : t(lang, "account_link.code", { code: proof.code }),
        ...(modern
          ? {
              buttons: [
                [{ id: `la:${id}:${proof.code}`, label: t(lang, "account_link.approve") }],
                [{ id: `lr:${id}:${proof.code}`, label: t(lang, "account_link.refuse") }],
              ],
            }
          : {}),
      });
    } catch (error) {
      if (!(error instanceof ApiIdempotencyError) && !(error instanceof VelaError)) throw error;
      await enqueueOutbound(deps, tx, {
        kind: "system",
        idempotencyKey: key,
        memberId: linked.member.id,
        channel: "telegram",
        conversationId: event.conversation.externalId,
        lang,
        text: t(lang, "account_link.unavailable"),
      });
    }
  });
}

/** Private status belongs to the initiating account AND session, never to the URL alone. */
export async function loadAccountLinkStatus(
  deps: Pick<Deps, "db" | "clock"> & { pilotAdmission?: PilotAdmission | null },
  identity: SessionIdentity,
  id: string,
): Promise<ApiLinkStatus> {
  validateIdentity(identity, "link.status");
  const normalizedId = challengeId(id);
  const sessionHash = await sha256Hex(identity.sessionId);
  return deps.db.transaction(async (tx) => {
    await lockApiActor(tx, await sha256Hex(identity.authSubject));
    const owner = await lockOwner(tx, identity.authSubject);
    const proof = await lockChallenge(tx, normalizedId, owner.id, sessionHash);
    const expires_at = proof.expiresAt.toISOString();
    if (proof.invalidatedAt !== null) return { state: "cancelled", expires_at };
    if (proof.completedAt === null && !pending(proof, now(deps)))
      return { state: "expired", expires_at };
    if (proof.completedAt === null && proof.approvedAt === null)
      return { state: "waiting", expires_at };
    if (proof.memberId === null || proof.channelLinkId === null) denied();
    const { member, link } = await lockTarget(tx, proof.memberId, proof.channelLinkId);
    if (
      member.familyId !== proof.familyId ||
      (member.userId !== null && member.userId !== owner.id) ||
      (await sha256Hex(link.externalId)) !== proof.channelIdentityHash
    )
      denied();
    const [family] = await tx.select().from(families).where(eq(families.id, member.familyId));
    if (
      family === undefined ||
      (deps.pilotAdmission != null &&
        (member.language !== "en" ||
          family.language !== "en" ||
          !pilotAllowsTelegram(deps.pilotAdmission, link.externalId)))
    )
      denied();
    if (proof.completedAt !== null && member.userId !== owner.id) denied();
    return ApiLinkStatus.parse({
      state: proof.completedAt === null ? "approved" : "completed",
      expires_at,
      family_id: family.id,
      member_id: member.id,
      family_name: family.name,
      member_name: member.displayName,
    });
  });
}

export async function cancelAccountLink(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  id: string,
) {
  validateIdentity(identity, key);
  const normalizedId = challengeId(id);
  const sessionHash = await sha256Hex(identity.sessionId);
  let proof: Challenge | undefined;
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "account.link.cancel:v1",
      input: { challenge_id: normalizedId, session_hash: sessionHash },
    },
    {
      authorize: async (tx) => {
        const owner = await lockOwner(tx, identity.authSubject);
        proof = await lockChallenge(tx, normalizedId, owner.id, sessionHash);
      },
      mutate: async (tx) => {
        if (proof === undefined) denied();
        // A late cancellation cannot undo an already committed attachment.
        if (proof.completedAt !== null) conflict();
        if (proof.invalidatedAt === null)
          await tx
            .update(accountLinkChallenges)
            .set({ invalidatedAt: now(deps), codeHash: null })
            .where(eq(accountLinkChallenges.id, proof.id));
        return { status: 200, body: { cancelled: true } };
      },
    },
  );
}

/** The existing private fallback proof is also a one-time opaque callback nonce (62 bytes). */
export async function handleAccountLinkButton(deps: Deps, event: InboundEvent): Promise<void> {
  if (
    !InboundEvent.safeParse(event).success ||
    event.channel !== "telegram" ||
    event.kind !== "button" ||
    event.conversation.kind !== "private" ||
    event.sender.externalUserId !== event.conversation.externalId
  )
    return;
  const match = /^l([ar]):([0-9a-f-]{36}):([A-Za-z0-9_-]{22})$/.exec(event.buttonData ?? "");
  if (match === null || !uuid.safeParse(match[2]).success) return;
  const [, choice, id, code] = match;
  if (id === undefined || code === undefined) return;
  const [candidate] = await deps.db
    .select({ userId: users.id, authSubject: users.authSubject })
    .from(accountLinkChallenges)
    .innerJoin(users, eq(users.id, accountLinkChallenges.userId))
    .where(eq(accountLinkChallenges.id, id));
  if (candidate?.authSubject == null) return;
  const authSubject = candidate.authSubject;
  await deps.db.transaction(async (tx) => {
    await lockApiActor(tx, await sha256Hex(authSubject));
    const owner = await lockOwner(tx, authSubject);
    const proof = await lockChallenge(tx, id, owner.id);
    if (
      !proof.approvalRequested ||
      !pending(proof, now(deps)) ||
      proof.memberId === null ||
      proof.channelLinkId === null ||
      proof.codeHash === null
    )
      return;
    if (!equalDigest(await sha256Hex(JSON.stringify([id, code])), proof.codeHash)) return;
    const { member, link } = await lockTarget(tx, proof.memberId, proof.channelLinkId);
    if (
      link.externalId !== event.sender.externalUserId ||
      member.familyId !== proof.familyId ||
      (await sha256Hex(link.externalId)) !== proof.channelIdentityHash ||
      (member.userId !== null && member.userId !== owner.id)
    )
      return;
    if (choice === "a" && !pilotAllowsTelegram(deps.config.pilotAdmission, link.externalId)) return;
    const at = now(deps);
    if (!pending(proof, at)) return;
    const lang = deps.config.pilotAdmission == null ? member.language : "en";
    if (choice === "r")
      await tx
        .update(accountLinkChallenges)
        .set({ invalidatedAt: at, codeHash: null })
        .where(eq(accountLinkChallenges.id, proof.id));
    else if (proof.approvedAt === null)
      await tx
        .update(accountLinkChallenges)
        .set({ approvedAt: at })
        .where(eq(accountLinkChallenges.id, proof.id));
    // A webhook retry reuses this durable response. No callback token is written into events/logs.
    await enqueueOutbound(deps, tx, {
      kind: "system",
      memberId: member.id,
      channel: "telegram",
      conversationId: event.conversation.externalId,
      lang,
      idempotencyKey: outboundKey("system", {
        conversationId: event.conversation.externalId,
        suffix: `account_link_choice:${id}:${event.eventId}`,
      }),
      text: t(lang, choice === "a" ? "account_link.approved" : "account_link.cancelled"),
    });
  });
}
