/** Opt-in, named-audience private-test reports. Stores identifiers/reviews only; never report words.
 * No model, messenger send or paid gate. Lock author membership for every mutation.
 */
import {
  SUPPORT_NOTICE_VERSION,
  SUPPORT_PERMISSION_SHA256,
  SUPPORT_PERMISSION_TEXT,
  SUPPORT_PERMISSION_VERSION,
  SUPPORT_TEMPLATE_VERSION,
  SupportNoInput,
  SupportPermissionChoice,
  SupportPresentation,
  SupportRemoveChoice,
  SupportReport,
  SupportReviewChoice,
} from "@vela/contracts";
import { addDays, localDateOf, weekdayOf, zonedInstant } from "@vela/core";
import {
  answers,
  exchanges,
  families,
  members,
  weeklySupportPermissions as permissions,
  weeklySupportPresentations as presentations,
  weeklySupportSelections as selections,
  users,
  type VelaTransaction,
} from "@vela/db";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { sourceDigest, sourceWords } from "./rich-memories.ts";
import { prepareWeeklySupportReview } from "./weekly-support.ts";
import { isOrdinaryWeeklySupportSource } from "./weekly-support-screen.ts";

type Db = VelaTransaction;
export interface WeeklySupportConfig {
  enabled: boolean;
  noticeVersion: string;
  familyIds: readonly string[];
}
export type WeeklySupportDeps = Pick<Deps, "db" | "clock"> & { config: WeeklySupportConfig };
export class WeeklySupportForbiddenError extends Error {
  override readonly name = "WeeklySupportForbiddenError";
}
const DAY = 86_400_000;
const absent = () => new VelaError("not_found", "Report not found");
const stale = () => new ApiIdempotencyError("conflict");
function gated(deps: WeeklySupportDeps, familyId: string, stop = false) {
  if (
    !z.uuid().safeParse(familyId).success ||
    (!stop && !deps.config.familyIds.includes(familyId)) ||
    (!stop && (!deps.config.enabled || deps.config.noticeVersion !== SUPPORT_NOTICE_VERSION))
  )
    throw absent();
}
/** Lock order family -> author -> remaining family members -> source. Stop/review serialise here. */
async function access(
  deps: WeeklySupportDeps,
  tx: Db,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
  stop = false,
) {
  gated(deps, familyId, stop);
  if (!z.uuid().safeParse(memberId).success) throw absent();
  const allowed = await authorizeFamilyAccess(tx, identity, familyId);
  if (allowed.kind !== "granted") throw absent();
  const [family] = await tx
    .select({ id: families.id })
    .from(families)
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)))
    .for("share");
  const [owner] = await tx
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.familyId, familyId)))
    .for("update");
  if (
    !family ||
    !owner ||
    owner.role !== "member" ||
    owner.leftAt !== null ||
    !["active", "paused"].includes(owner.status) ||
    !owner.lightConsentedAt
  )
    throw absent();
  const roster = await tx
    .select()
    .from(members)
    .where(and(eq(members.familyId, familyId), eq(members.role, "organiser")))
    .orderBy(asc(members.id))
    .for("share");
  const userIds = [owner, ...roster].flatMap((m) => (m.userId ? [m.userId] : []));
  const activeUsers =
    userIds.length === 0
      ? []
      : await tx
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, userIds), isNull(users.deletedAt)))
          .orderBy(asc(users.id))
          .for("share");
  const activeUserIds = new Set(activeUsers.map((u) => u.id));
  const live = [owner, ...roster].filter(
    (m) =>
      m.leftAt === null &&
      ["active", "paused"].includes(m.status) &&
      (m.userId === null || activeUserIds.has(m.userId)),
  );
  const actor = live.find((m) => m.id === allowed.access.memberId);
  if (!actor || (actor.id !== owner.id && actor.role !== "organiser")) throw absent();
  const again = await authorizeFamilyAccess(tx, identity, familyId);
  if (again.kind !== "granted" || again.access.memberId !== actor.id) throw absent();
  const [permission] = await tx
    .select()
    .from(permissions)
    .where(eq(permissions.memberId, owner.id));
  const organisers = live.filter((m) => m.role === "organiser");
  const audience = organisers.map((m) => ({
    id: m.id,
    revision: m.memoryMembershipRevision,
    userId: m.userId,
    name: m.displayName,
  }));
  const current =
    permission?.state === "yes" &&
    permission.familyId === familyId &&
    permission.userId === owner.userId &&
    owner.userId !== null &&
    activeUserIds.has(owner.userId) &&
    permission.version === SUPPORT_PERMISSION_VERSION &&
    permission.noticeVersion === SUPPORT_NOTICE_VERSION &&
    permission.textSha256 === SUPPORT_PERMISSION_SHA256 &&
    permission.ownerRevision === owner.memoryMembershipRevision;
  const named = organisers.filter((m) =>
    permission?.audience.some(
      (r) => r.id === m.id && r.revision === m.memoryMembershipRevision && r.userId === m.userId,
    ),
  );
  const reader = current && (actor.id === owner.id || named.some((m) => m.id === actor.id));
  return { owner, actor, live, organisers, audience, permission, current, named, reader };
}
function sameAudience(
  left: { id: string; revision: string; userId: string | null; name: string }[],
  right: { id: string; revision: string; userId: string | null; name: string }[],
) {
  return (
    left.length === right.length &&
    left.every((r, i) => {
      const other = right[i];
      return (
        other?.id === r.id &&
        other.revision === r.revision &&
        other.userId === r.userId &&
        other.name === r.name
      );
    })
  );
}
type Access = Awaited<ReturnType<typeof access>>;
function ownerOnly(a: Access) {
  if (a.actor.id !== a.owner.id)
    throw new WeeklySupportForbiddenError("Only the author can choose");
}
function period(a: Access, now: Date) {
  const date = localDateOf(now, a.owner.tz);
  const start = addDays(date, -((weekdayOf(date) + 6) % 7));
  return {
    start,
    end: addDays(start, 6),
    from: zonedInstant(start, "00:00", a.owner.tz),
    until: zonedInstant(addDays(start, 7), "00:00", a.owner.tz),
  };
}
async function sources(tx: Db, a: Access, now: Date, approvedIds?: readonly string[]) {
  if (!a.reader || !a.permission || approvedIds?.length === 0) return [];
  const week = period(a, now);
  const rows = await tx
    .select({ answer: answers, exchange: exchanges })
    .from(answers)
    .innerJoin(exchanges, eq(exchanges.id, answers.exchangeId))
    .where(
      and(
        eq(answers.memberId, a.owner.id),
        eq(exchanges.familyId, a.owner.familyId),
        eq(exchanges.recipientId, a.owner.id),
        ...(approvedIds === undefined
          ? [gte(answers.receivedAt, week.from), lt(answers.receivedAt, week.until)]
          : [inArray(answers.id, [...approvedIds])]),
        gte(answers.receivedAt, a.permission.givenAt),
        lte(answers.receivedAt, now),
      ),
    )
    .orderBy(desc(answers.receivedAt), desc(answers.id))
    .limit(100)
    .for("share");
  const output = [];
  for (const { answer, exchange } of rows) {
    const words = sourceWords(answer);
    if (
      exchange.state === "withdrawn" ||
      !words ||
      !words.text.trim() ||
      words.text.length > 1000 ||
      answer.wordsExpiredAt !== null ||
      answer.receivedAt.getTime() + 30 * DAY <= now.getTime() ||
      answer.flag ||
      !answer.understoodAt ||
      (Array.isArray(answer.mentions.health) && answer.mentions.health.length > 0) ||
      !isOrdinaryWeeklySupportSource(
        words.text,
        answer.kind === "text" && words.lang === "und" ? a.owner.language : words.lang,
      )
    )
      continue;
    output.push({
      id: answer.id,
      exchange_id: exchange.id,
      digest: await sourceDigest(answer),
      quote: words.text,
      occurred_at: answer.receivedAt.toISOString(),
      occurred_on: localDateOf(answer.receivedAt, a.owner.tz),
    });
    if (output.length === (approvedIds === undefined ? 50 : 100)) break;
  }
  return output;
}
export async function loadWeeklySupportReport(
  deps: WeeklySupportDeps,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
): Promise<SupportReport> {
  return deps.db.transaction(async (tx) => {
    const a = await access(deps, tx, identity, familyId, memberId);
    const now = deps.clock.now();
    const week = period(a, now);
    const reviews =
      a.reader && a.permission
        ? await tx
            .select()
            .from(selections)
            .where(
              and(
                eq(selections.memberId, memberId),
                eq(selections.familyId, familyId),
                eq(selections.permissionRevision, a.permission.revision),
                gt(selections.expiresAt, now),
              ),
            )
            .orderBy(desc(selections.reviewedAt), asc(selections.id))
            .limit(100)
        : [];
    // Read approved sources by identity, never through the 50-message discovery page or a new
    // calendar week's window. Each quote still passes current audience, screening and expiry.
    const approvedSources = await sources(
      tx,
      a,
      now,
      reviews.map((r) => r.answerId),
    );
    const items = reviews
      .flatMap((r) => {
        const source = approvedSources.find(
          (s) => s.id === r.answerId && s.digest === r.sourceDigest,
        );
        const reviewer = a.named.find(
          (m) => m.id === r.reviewerId && m.memoryMembershipRevision === r.reviewerRevision,
        );
        if (!source || !reviewer || r.templateVersion !== SUPPORT_TEMPLATE_VERSION) return [];
        const sourceWeek = period(a, new Date(source.occurred_at));
        const [draft] = prepareWeeklySupportReview(
          {
            enabled: a.reader,
            familyId,
            memberId,
            viewerId: a.actor.id,
            activeMemberIds: a.live.map((m) => m.id),
            organiserIds: a.named.map((m) => m.id),
            permission:
              a.permission?.state === "yes"
                ? {
                    version: a.permission.version,
                    givenAt: a.permission.givenAt,
                    withdrawnAt: null,
                  }
                : null,
            now,
            weekFrom: sourceWeek.from,
            weekUntil: sourceWeek.until,
          },
          [
            {
              id: source.id,
              familyId,
              memberId,
              revision: 1,
              text: source.quote,
              occurredAt: new Date(source.occurred_at),
              expiresAt: new Date(new Date(source.occurred_at).getTime() + 30 * DAY),
              deleted: false,
              sensitivity: "ordinary",
              readerIds: [memberId, ...a.named.map((m) => m.id)],
            },
          ],
          [
            {
              sourceId: r.answerId,
              sourceRevision: 1,
              start: 0,
              end: source.quote.length,
              kind: r.kind,
              reviewerId: r.reviewerId,
              reviewedAt: r.reviewedAt,
              validUntil: r.expiresAt,
            },
          ],
        );
        return draft
          ? [
              {
                source,
                kind: draft.kind,
                reviewed_at: r.reviewedAt.toISOString(),
                reviewed_by: reviewer.displayName,
                template_version: SUPPORT_TEMPLATE_VERSION,
                expires_at: draft.expiresAt.toISOString(),
              },
            ]
          : [];
      })
      .slice(0, 3);
    const currentSources =
      a.reader && a.actor.role === "organiser" ? await sources(tx, a, now) : [];
    return SupportReport.parse({
      member_id: memberId,
      name: a.owner.displayName,
      owner: a.actor.id === memberId,
      can_review: a.reader && a.actor.role === "organiser",
      permission: a.reader
        ? "yes"
        : a.actor.id !== memberId
          ? "not_shared"
          : a.permission?.state === "no" || a.permission?.state === "withdrawn"
            ? a.permission.state
            : "none",
      readers:
        a.actor.id === memberId || a.reader
          ? a.named.map((m) => ({ id: m.id, name: m.displayName }))
          : [],
      week_start: week.start,
      week_end: week.end,
      suggestions: items,
      sources: currentSources,
    });
  });
}
export async function prepareWeeklySupportPermission(
  deps: WeeklySupportDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
) {
  if (!SupportNoInput.safeParse(input).success) throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "weekly.support.prepare:v1", familyId, memberId, input: {} },
    {
      authorize: async (tx) => {
        ownerOnly(await access(deps, tx, identity, familyId, memberId));
      },
      mutate: async (tx) => {
        const a = await access(deps, tx, identity, familyId, memberId);
        ownerOnly(a);
        if (a.audience.length === 0 || a.audience.length > 12) throw stale();
        const now = deps.clock.now();
        const id = crypto.randomUUID();
        // A newer question invalidates every earlier pending screen, including its audience.
        await tx.delete(presentations).where(eq(presentations.memberId, memberId));
        await tx.insert(presentations).values({
          id,
          familyId,
          memberId,
          userId: a.actor.userId as string,
          ownerRevision: a.owner.memoryMembershipRevision,
          textSha256: SUPPORT_PERMISSION_SHA256,
          permissionRevision: a.permission?.revision ?? null,
          audience: a.audience,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 5 * 60_000),
        });
        return { status: 200, body: { id } };
      },
    },
  );
}
export async function loadWeeklySupportPresentation(
  deps: WeeklySupportDeps,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
  id: string,
): Promise<SupportPresentation> {
  if (!z.uuid().safeParse(id).success) throw absent();
  return deps.db.transaction(async (tx) => {
    const a = await access(deps, tx, identity, familyId, memberId);
    ownerOnly(a);
    const [p] = await tx
      .select()
      .from(presentations)
      .where(and(eq(presentations.id, id), eq(presentations.memberId, memberId)));
    if (
      !p ||
      p.userId !== a.actor.userId ||
      p.textSha256 !== SUPPORT_PERMISSION_SHA256 ||
      p.ownerRevision !== a.owner.memoryMembershipRevision ||
      p.permissionRevision !== (a.permission?.revision ?? null) ||
      p.usedAt ||
      p.expiresAt <= deps.clock.now() ||
      !sameAudience(p.audience, a.audience)
    )
      throw stale();
    return SupportPresentation.parse({
      id: p.id,
      version: SUPPORT_PERMISSION_VERSION,
      notice_version: SUPPORT_NOTICE_VERSION,
      text: SUPPORT_PERMISSION_TEXT,
      readers: a.organisers.map((m) => ({ id: m.id, name: m.displayName })),
      expires_at: p.expiresAt.toISOString(),
    });
  });
}
export async function answerWeeklySupportPermission(
  deps: WeeklySupportDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
) {
  const parsed = SupportPermissionChoice.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "weekly.support.permission:v1", familyId, memberId, input: parsed.data },
    {
      authorize: async (tx) => {
        ownerOnly(await access(deps, tx, identity, familyId, memberId));
      },
      mutate: async (tx) => {
        const a = await access(deps, tx, identity, familyId, memberId);
        ownerOnly(a);
        const now = deps.clock.now();
        const [p] = await tx
          .select()
          .from(presentations)
          .where(
            and(
              eq(presentations.id, parsed.data.presentation_id),
              eq(presentations.memberId, memberId),
            ),
          )
          .for("update");
        if (
          !p ||
          p.userId !== a.actor.userId ||
          p.textSha256 !== SUPPORT_PERMISSION_SHA256 ||
          p.ownerRevision !== a.owner.memoryMembershipRevision ||
          p.permissionRevision !== (a.permission?.revision ?? null) ||
          p.usedAt ||
          p.expiresAt <= now ||
          !sameAudience(p.audience, a.audience)
        )
          throw stale();
        await tx
          .insert(permissions)
          .values({
            memberId,
            familyId,
            userId: a.actor.userId as string,
            revision: crypto.randomUUID(),
            ownerRevision: a.owner.memoryMembershipRevision,
            textSha256: SUPPORT_PERMISSION_SHA256,
            version: SUPPORT_PERMISSION_VERSION,
            noticeVersion: SUPPORT_NOTICE_VERSION,
            state: parsed.data.answer,
            audience: parsed.data.answer === "yes" ? p.audience : [],
            givenAt: now,
          })
          .onConflictDoUpdate({
            target: permissions.memberId,
            set: {
              userId: a.actor.userId as string,
              revision: crypto.randomUUID(),
              ownerRevision: a.owner.memoryMembershipRevision,
              textSha256: SUPPORT_PERMISSION_SHA256,
              version: SUPPORT_PERMISSION_VERSION,
              noticeVersion: SUPPORT_NOTICE_VERSION,
              state: parsed.data.answer,
              audience: parsed.data.answer === "yes" ? p.audience : [],
              givenAt: now,
            },
          });
        await tx.delete(selections).where(eq(selections.memberId, memberId));
        await tx.update(presentations).set({ usedAt: now }).where(eq(presentations.id, p.id));
        return { status: 200, body: { saved: true } };
      },
    },
  );
}
/** Withdrawal checks ownership directly: stopping daily messages or leaving must not trap a yes. */
async function lockOwnReportForStop(
  tx: Db,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
) {
  if (!z.uuid().safeParse(familyId).success || !z.uuid().safeParse(memberId).success)
    throw absent();
  const [family] = await tx
    .select({ id: families.id })
    .from(families)
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)))
    .for("share");
  const [owner] = await tx
    .select({ id: members.id, userId: members.userId })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.familyId, familyId)))
    .for("update");
  if (!family || !owner?.userId) throw absent();
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, owner.userId),
        eq(users.authSubject, identity.authSubject),
        isNull(users.deletedAt),
      ),
    )
    .for("share");
  if (!user) throw absent();
}
export async function stopWeeklySupport(
  deps: WeeklySupportDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
) {
  if (!SupportNoInput.safeParse(input).success) throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "weekly.support.stop:v1", familyId, memberId, input: {} },
    {
      authorize: async (tx) => {
        await lockOwnReportForStop(tx, identity, familyId, memberId);
      },
      mutate: async (tx) => {
        await lockOwnReportForStop(tx, identity, familyId, memberId);
        await tx
          .update(permissions)
          .set({ state: "withdrawn", revision: crypto.randomUUID(), audience: [] })
          .where(eq(permissions.memberId, memberId));
        await tx.delete(selections).where(eq(selections.memberId, memberId));
        await tx.delete(presentations).where(eq(presentations.memberId, memberId));
        return { status: 200, body: { saved: true } };
      },
    },
  );
}
export async function reviewWeeklySupport(
  deps: WeeklySupportDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
) {
  const parsed = SupportReviewChoice.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "weekly.support.review:v1", familyId, memberId, input: parsed.data },
    {
      authorize: async (tx) => {
        const a = await access(deps, tx, identity, familyId, memberId);
        if (!a.reader || a.actor.role !== "organiser")
          throw new WeeklySupportForbiddenError("Report review not allowed");
        const now = deps.clock.now();
        if (
          !(await sources(tx, a, now)).some(
            (s) => s.id === parsed.data.source_id && s.digest === parsed.data.source_digest,
          ) ||
          new Date(parsed.data.valid_until) <= now
        )
          throw stale();
      },
      mutate: async (tx) => {
        const a = await access(deps, tx, identity, familyId, memberId);
        const now = deps.clock.now();
        if (!a.reader || a.actor.role !== "organiser" || !a.permission) throw absent();
        const source = (await sources(tx, a, now)).find(
          (s) => s.id === parsed.data.source_id && s.digest === parsed.data.source_digest,
        );
        const until = new Date(parsed.data.valid_until);
        if (!source || until <= now || until.getTime() > now.getTime() + 7 * DAY) throw stale();
        const expiry = new Date(
          Math.min(until.getTime(), new Date(source.occurred_at).getTime() + 30 * DAY),
        );
        const existing = await tx
          .select()
          .from(selections)
          .where(and(eq(selections.memberId, memberId), eq(selections.familyId, familyId)));
        const existingSources = await sources(
          tx,
          a,
          now,
          existing.map((r) => r.answerId),
        );
        const validExisting = existing.filter(
          (r) =>
            r.permissionRevision === a.permission?.revision &&
            r.templateVersion === SUPPORT_TEMPLATE_VERSION &&
            r.expiresAt > now &&
            existingSources.some((s) => s.id === r.answerId && s.digest === r.sourceDigest) &&
            a.named.some(
              (m) => m.id === r.reviewerId && m.memoryMembershipRevision === r.reviewerRevision,
            ),
        );
        const validIds = new Set(validExisting.map((r) => r.id));
        const staleIds = existing.filter((r) => !validIds.has(r.id)).map((r) => r.id);
        if (staleIds.length > 0)
          await tx
            .delete(selections)
            .where(and(eq(selections.memberId, memberId), inArray(selections.id, staleIds)));
        if (validExisting.length >= 3 && !validExisting.some((r) => r.answerId === source.id))
          throw stale();
        await tx
          .insert(selections)
          .values({
            familyId,
            memberId,
            answerId: source.id,
            permissionRevision: a.permission.revision,
            sourceDigest: source.digest,
            kind: parsed.data.kind,
            templateVersion: SUPPORT_TEMPLATE_VERSION,
            reviewerId: a.actor.id,
            reviewerRevision: a.actor.memoryMembershipRevision,
            reviewedAt: now,
            expiresAt: expiry,
          })
          .onConflictDoUpdate({
            target: [selections.memberId, selections.answerId],
            set: {
              permissionRevision: a.permission.revision,
              sourceDigest: source.digest,
              kind: parsed.data.kind,
              templateVersion: SUPPORT_TEMPLATE_VERSION,
              reviewerId: a.actor.id,
              reviewerRevision: a.actor.memoryMembershipRevision,
              reviewedAt: now,
              expiresAt: expiry,
            },
          });
        return { status: 200, body: { saved: true } };
      },
    },
  );
}
export async function removeWeeklySupportReview(
  deps: WeeklySupportDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
) {
  const parsed = SupportRemoveChoice.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "weekly.support.remove:v1", familyId, memberId, input: parsed.data },
    {
      authorize: async (tx) => {
        const a = await access(deps, tx, identity, familyId, memberId, true);
        if (a.actor.id !== memberId && !a.reader) throw absent();
      },
      mutate: async (tx) => {
        await tx
          .delete(selections)
          .where(
            and(eq(selections.memberId, memberId), eq(selections.answerId, parsed.data.source_id)),
          );
        return { status: 200, body: { saved: true } };
      },
    },
  );
}
