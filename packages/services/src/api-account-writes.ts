import {
  ApiAccountPatch,
  ApiAccountProfile,
  type ApiMutationResponse,
  ApiUser,
} from "@vela/contracts";
import { accountLinkChallenges, apiRequestReceipts, users, type VelaTransaction } from "@vela/db";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { SessionIdentity } from "./api-access.ts";
import { provisionApiUser } from "./api-accounts.ts";
import { ApiIdempotencyError, lockApiActor, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { sha256Hex } from "./hash.ts";

const userProjection = {
  id: users.id,
  display_name: users.displayName,
  language: users.language,
  tz: users.tz,
};

async function lockAccount(tx: VelaTransaction, authSubject: string, allowAbsent = false) {
  const [account] = await tx
    .select({ ...userProjection, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.authSubject, authSubject))
    .for("update");
  if (account === undefined ? !allowAbsent : account.deletedAt !== null) {
    throw new VelaError("not_found", "Account not found");
  }
  return account;
}

export async function provisionApiAccount(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  profile: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = ApiAccountProfile.safeParse(profile);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "account.provision:v1", input: parsed.data },
    {
      authorize: async (tx) => {
        const account = await lockAccount(tx, identity.authSubject, true);
        if (account === undefined) {
          const [actorHash, keyHash] = await Promise.all([
            sha256Hex(identity.authSubject),
            sha256Hex(key),
          ]);
          const [completed] = await tx
            .select({ id: apiRequestReceipts.id })
            .from(apiRequestReceipts)
            .where(
              and(
                eq(apiRequestReceipts.actorHash, actorHash),
                eq(apiRequestReceipts.keyHash, keyHash),
                isNotNull(apiRequestReceipts.result),
                gt(apiRequestReceipts.expiresAt, deps.clock.now()),
              ),
            );
          if (completed !== undefined) throw new VelaError("not_found", "Account not found");
        }
      },
      mutate: async (tx) => {
        await provisionApiUser(tx, identity, parsed.data);
        const account = await lockAccount(tx, identity.authSubject);
        return { status: 200, body: ApiUser.parse(account) };
      },
    },
  );
}

export async function updateApiAccount(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  patch: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = ApiAccountPatch.safeParse(patch);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "account.update:v1", input: parsed.data },
    {
      authorize: async (tx) => {
        await lockAccount(tx, identity.authSubject);
      },
      mutate: async (tx) => {
        const [account] = await tx
          .update(users)
          .set({
            ...(parsed.data.display_name === undefined
              ? {}
              : { displayName: parsed.data.display_name }),
            ...(parsed.data.language === undefined ? {} : { language: parsed.data.language }),
            ...(parsed.data.tz === undefined ? {} : { tz: parsed.data.tz }),
          })
          .where(and(eq(users.authSubject, identity.authSubject), isNull(users.deletedAt)))
          .returning(userProjection);
        if (account === undefined) throw new VelaError("not_found", "Account not found");
        return { status: 200, body: ApiUser.parse(account) };
      },
    },
  );
}

export async function disableApiAccount(
  deps: Pick<Deps, "db" | "clock">,
  authSubject: string,
): Promise<void> {
  if (typeof authSubject !== "string" || authSubject.trim().length === 0) {
    throw new ApiIdempotencyError("invalid");
  }
  const now = deps.clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Invalid API mutation clock");
  }
  const actorHash = await sha256Hex(authSubject);
  await deps.db.transaction(async (tx) => {
    await lockApiActor(tx, actorHash);
    await tx
      .insert(users)
      .values({ authSubject, displayName: "", deletedAt: now })
      .onConflictDoNothing({ target: users.authSubject });
    const [account] = await tx
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.authSubject, authSubject))
      .for("update");
    if (account === undefined) throw new VelaError("not_found", "Account not found");
    if (account.deletedAt === null) {
      await tx.update(users).set({ deletedAt: now }).where(eq(users.id, account.id));
    }
    await tx.delete(apiRequestReceipts).where(eq(apiRequestReceipts.actorHash, actorHash));
    await tx.delete(accountLinkChallenges).where(eq(accountLinkChallenges.userId, account.id));
  });
}
