import {
  ApiQuestionProfile,
  ForgetQuestionProfile,
  QUESTION_PROFILE_NOTICE_VERSION,
  QUESTION_PROFILE_RETENTION_DAYS,
  SaveQuestionProfile,
} from "@vela/contracts";
import { families, members, questionProfiles, users } from "@vela/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import { canBeAsked } from "./askable.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { pilotFamilyAllowed } from "./pilot-admission.ts";
import type { Queryable } from "./repo.ts";

export class QuestionProfileChangedError extends Error {
  readonly code = "question_profile_changed";
  constructor() {
    super("Saved question choices changed");
    this.name = "QuestionProfileChangedError";
  }
}
type ProfileDeps = Pick<Deps, "db" | "clock"> & {
  config?: Pick<Deps["config"], "pilotAdmission">;
  savingEnabled?: boolean;
};
const absent = () => new VelaError("not_found", "Question profile not found");
const uuid = z.uuid();
const lifetime = QUESTION_PROFILE_RETENTION_DAYS * 86_400_000;

/** Account -> family -> members in id order -> profile, before any content is read or written. */
async function scope(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  recipientId: string,
  lock = false,
  saving = false,
) {
  if (!uuid.safeParse(familyId).success || !uuid.safeParse(recipientId).success) throw absent();
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted" || access.access.memberId === recipientId) throw absent();
  const [target] = await db
    .select()
    .from(members)
    .where(and(eq(members.id, recipientId), eq(members.familyId, familyId)));
  if (!target) throw absent();
  if (lock) {
    const accountIds = [
      ...new Set([access.access.userId, ...(target.userId ? [target.userId] : [])]),
    ];
    const accounts = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, accountIds), isNull(users.deletedAt)))
      .orderBy(asc(users.id))
      .for("share");
    if (accounts.length !== accountIds.length) throw absent();
    const [family] = await db
      .select({ id: families.id })
      .from(families)
      .where(and(eq(families.id, familyId), isNull(families.deletedAt)))
      .for("share");
    if (!family) throw absent();
  }
  const query = db
    .select()
    .from(members)
    .where(
      and(
        eq(members.familyId, familyId),
        inArray(members.id, [access.access.memberId, recipientId]),
      ),
    )
    .orderBy(asc(members.id));
  const people = lock ? await query.for("share") : await query;
  const author = people.find((person) => person.id === access.access.memberId);
  const recipient = people.find((person) => person.id === recipientId);
  if (
    !author ||
    !recipient ||
    author.userId !== access.access.userId ||
    author.leftAt !== null ||
    !["active", "paused"].includes(author.status) ||
    recipient.userId !== target.userId
  )
    throw absent();
  if (saving && (author.status !== "active" || !canBeAsked(recipient, familyId))) throw absent();
  return { familyId, authorId: author.id, recipientId, userId: access.access.userId };
}

function pair(owner: { familyId: string; authorId: string; recipientId: string; userId: string }) {
  return and(
    eq(questionProfiles.familyId, owner.familyId),
    eq(questionProfiles.authorId, owner.authorId),
    eq(questionProfiles.recipientId, owner.recipientId),
    eq(questionProfiles.ownerUserId, owner.userId),
  );
}

/** Also the private data-copy component: no processing switch or paid plan is needed to read own data. */
export async function loadApiQuestionProfile(
  deps: ProfileDeps,
  identity: SessionIdentity,
  rawFamily: string,
  rawRecipient: string,
): Promise<z.infer<typeof ApiQuestionProfile>> {
  const owner = await scope(deps.db, identity, rawFamily.toLowerCase(), rawRecipient.toLowerCase());
  const [row] = await deps.db.select().from(questionProfiles).where(pair(owner));
  const current = row && row.data !== null && row.expiresAt > deps.clock.now();
  return ApiQuestionProfile.parse({
    revision: row?.revision ?? null,
    saving_available: deps.savingEnabled === true,
    profile: current
      ? {
          settings: row.data,
          saved_at: row.changedAt.toISOString(),
          expires_at: row.expiresAt.toISOString(),
          notice_version: row.noticeVersion,
        }
      : null,
  });
}

/** An unchanged, unexpired saved setup must still exist before/after model work and at composition. */
export async function assertQuestionProfileRevision(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  recipientId: string,
  revision: string,
  now: Date,
): Promise<void> {
  const owner = await scope(db, identity, familyId, recipientId);
  const [row] = await db
    .select({
      revision: questionProfiles.revision,
      data: questionProfiles.data,
      expiresAt: questionProfiles.expiresAt,
    })
    .from(questionProfiles)
    .where(pair(owner));
  if (!row || row.revision !== revision || row.data === null || row.expiresAt <= now)
    throw new QuestionProfileChangedError();
}

/** Only metadata enters mutation receipts. Saving is explicit and never happens on reads/drafting. */
export async function saveApiQuestionProfile(
  deps: ProfileDeps,
  identity: SessionIdentity,
  key: string,
  rawFamily: string,
  rawRecipient: string,
  rawInput: unknown,
) {
  const parsed = SaveQuestionProfile.safeParse(rawInput);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (deps.savingEnabled !== true) throw absent();
  const familyId = rawFamily.toLowerCase(),
    recipientId = rawRecipient.toLowerCase();
  return runApiMutation(
    deps,
    identity,
    {
      key,
      familyId,
      memberId: recipientId,
      operation: "question_profile.save:v1",
      input: parsed.data,
    },
    {
      authorize: async (tx) => {
        await scope(tx, identity, familyId, recipientId, true, true);
        if (!(await pilotFamilyAllowed(tx, deps.config?.pilotAdmission, familyId))) throw absent();
      },
      mutate: async (tx) => {
        const owner = await scope(tx, identity, familyId, recipientId, true, true);
        const [previous] = await tx
          .select()
          .from(questionProfiles)
          .where(pair(owner))
          .for("update");
        if ((previous?.revision ?? null) !== parsed.data.expected_revision)
          throw new QuestionProfileChangedError();
        const now = deps.clock.now();
        const values = {
          data: parsed.data.settings,
          noticeVersion: parsed.data.notice_version,
          changedAt: now,
          expiresAt: new Date(now.getTime() + lifetime),
        };
        const rows = previous
          ? await tx
              .update(questionProfiles)
              .set({ ...values, revision: sql`uuidv7()` })
              .where(pair(owner))
              .returning()
          : await tx
              .insert(questionProfiles)
              .values({
                familyId,
                authorId: owner.authorId,
                recipientId,
                ownerUserId: owner.userId,
                ...values,
              })
              .returning();
        const row = rows[0];
        if (!row) throw new Error("Question profile save failed");
        return {
          status: 200 as const,
          body: { saved: true, revision: row.revision, expires_at: row.expiresAt.toISOString() },
        };
      },
    },
  );
}

/** A null-data revision prevents stale create/save requests from resurrecting forgotten words. */
export async function forgetApiQuestionProfile(
  deps: ProfileDeps,
  identity: SessionIdentity,
  key: string,
  rawFamily: string,
  rawRecipient: string,
  rawInput: unknown,
) {
  if (!ForgetQuestionProfile.safeParse(rawInput).success) throw new ApiIdempotencyError("invalid");
  const familyId = rawFamily.toLowerCase(),
    recipientId = rawRecipient.toLowerCase();
  return runApiMutation(
    deps,
    identity,
    { key, familyId, memberId: recipientId, operation: "question_profile.forget:v1", input: {} },
    {
      authorize: async (tx) => {
        await scope(tx, identity, familyId, recipientId, true);
      },
      mutate: async (tx) => {
        const owner = await scope(tx, identity, familyId, recipientId, true);
        const now = deps.clock.now();
        await tx
          .insert(questionProfiles)
          .values({
            familyId,
            authorId: owner.authorId,
            recipientId,
            ownerUserId: owner.userId,
            data: null,
            noticeVersion: QUESTION_PROFILE_NOTICE_VERSION,
            changedAt: now,
            expiresAt: new Date(now.getTime() + lifetime),
          })
          .onConflictDoUpdate({
            target: [
              questionProfiles.familyId,
              questionProfiles.authorId,
              questionProfiles.recipientId,
            ],
            set: {
              data: null,
              revision: sql`uuidv7()`,
              changedAt: now,
              expiresAt: new Date(now.getTime() + lifetime),
            },
          });
        return { status: 200 as const, body: { forgotten: true } };
      },
    },
  );
}
