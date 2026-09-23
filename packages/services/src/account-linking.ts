import {
  ApiIdempotencyKey,
  ApiLinkChallenge,
  ApiLinkCode,
  ApiLinkOutcome,
  type ApiMutationResponse,
  InboundEvent,
} from "@vela/contracts";
import {
  accountLinkChallenges,
  channelLinks,
  families,
  members,
  users,
  type VelaTransaction,
} from "@vela/db";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, lockApiActor, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { sha256Hex } from "./hash.ts";

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
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  validateIdentity(identity, key);
  const sessionHash = await sha256Hex(identity.sessionId);
  let ownerId: string | undefined;
  return runApiMutation(
    deps,
    identity,
    { key, operation: "account.link.start:v1", input: { session_hash: sessionHash } },
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
          }),
        };
      },
    },
  );
}

export async function issueAccountLinkCode(
  deps: Pick<Deps, "db" | "clock" | "random">,
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
      })
      .where(eq(accountLinkChallenges.id, proof.id));
    return { code, expires_at: proof.expiresAt.toISOString() };
  });
}

export async function completeAccountLink(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  id: string,
  code: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  validateIdentity(identity, key);
  const normalizedId = challengeId(id);
  if (!ApiLinkCode.safeParse(code).success || /[^A-Za-z0-9_-]/.test(code)) {
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
      operation: "account.link.complete:v1",
      input: { challenge_id: normalizedId, session_hash: sessionHash, code },
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
        const suppliedHash = await sha256Hex(JSON.stringify([proof.id, code]));
        if (
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
