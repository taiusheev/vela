import { ApiIdempotencyKey, ApiMutationResponse } from "@vela/contracts";
import { apiRequestReceipts, members, type VelaTransaction } from "@vela/db";
import { and, count, eq, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { SessionIdentity } from "./api-access.ts";
import type { Clock, Deps } from "./deps.ts";
import { sha256Hex } from "./hash.ts";

export interface ApiMutationRequest {
  key: string;
  operation: string;
  input: unknown;
  familyId?: string;
  memberId?: string;
}

export interface ApiMutationAction {
  authorize(tx: VelaTransaction): Promise<void>;
  mutate(tx: VelaTransaction): Promise<ApiMutationResponse>;
}

const messages = {
  invalid: "Invalid API mutation request",
  conflict: "API mutation key already used",
  unavailable: "API mutation receipt unavailable",
  rate_limited: "API mutation receipt limit reached",
} as const;

export class ApiIdempotencyError extends Error {
  override readonly name = "ApiIdempotencyError";
  readonly code: "invalid" | "conflict" | "unavailable" | "rate_limited";

  constructor(code: "invalid" | "conflict" | "unavailable" | "rate_limited") {
    super(messages[code]);
    this.code = code;
  }
}

export const MAX_API_RECEIPTS_PER_ACTOR = 1_000;

const maxBytes = 16 * 1_024;
const lifetime = 24 * 60 * 60 * 1_000;
const uuid = z.uuid();
const encoder = new TextEncoder();

function canonicalJson(value: unknown): string {
  let remaining = maxBytes;
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  const fail = (): never => {
    throw new Error("Invalid bounded JSON value");
  };
  const charge = (text: string): string => {
    if (text.length > remaining) fail();
    remaining -= encoder.encode(text).length;
    if (remaining < 0) fail();
    return text;
  };
  const append = (text: string): void => {
    chunks.push(charge(text));
  };
  const quote = (text: string): string => {
    if (text.length > remaining) fail();
    return JSON.stringify(text);
  };
  const visit = (item: unknown, depth: number): void => {
    if (depth > 32) fail();
    if (item === null || typeof item === "boolean") {
      append(String(item));
    } else if (typeof item === "string") {
      append(quote(item));
    } else if (typeof item === "number" && Number.isFinite(item)) {
      append(JSON.stringify(item));
    } else if (typeof item === "object" && item !== null) {
      if (ancestors.has(item)) fail();
      ancestors.add(item);
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > remaining) fail();
        for (const key in item) {
          if (
            Object.hasOwn(item, key) &&
            (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)
          )
            fail();
        }
        append("[");
        for (let index = 0; index < item.length; index += 1) {
          if (index > 0) append(",");
          const property = Object.getOwnPropertyDescriptor(item, String(index));
          if (property === undefined || !Object.hasOwn(property, "value")) fail();
          visit(property?.value, depth + 1);
        }
        append("]");
      } else {
        const prototype: unknown = Object.getPrototypeOf(item);
        if (prototype !== Object.prototype && prototype !== null) fail();
        append("{");
        const keys: { key: string; encoded: string }[] = [];
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue;
          const encoded = charge(quote(key));
          charge(keys.length === 0 ? ":" : ",:");
          keys.push({ key, encoded });
        }
        keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        for (const [index, { key, encoded }] of keys.entries()) {
          const property = Object.getOwnPropertyDescriptor(item, key);
          if (property === undefined || !Object.hasOwn(property, "value")) fail();
          if (index > 0) chunks.push(",");
          chunks.push(encoded, ":");
          visit(property?.value, depth + 1);
        }
        append("}");
      }
      ancestors.delete(item);
    } else {
      fail();
    }
  };
  visit(value, -1);
  return chunks.join("");
}

function scopeId(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length !== 36 || !uuid.safeParse(value).success) {
    throw new ApiIdempotencyError("invalid");
  }
  return value.toLowerCase();
}

function clockTime(clock: Clock): Date {
  const now = clock.now();
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(new Date(now.getTime() + lifetime).getTime())
  ) {
    throw new Error("Invalid API mutation clock");
  }
  return new Date(now.getTime());
}

function cloneResponse(value: unknown): ApiMutationResponse {
  try {
    const clone: unknown = JSON.parse(canonicalJson(value));
    if (!ApiMutationResponse.safeParse(clone).success) {
      throw new Error("Invalid API mutation response");
    }
    return clone as ApiMutationResponse;
  } catch {
    throw new Error("Invalid API mutation response");
  }
}

export async function lockApiActor(tx: VelaTransaction, actorHash: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actorHash}, 0))`);
}

export async function runApiMutation(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  request: ApiMutationRequest,
  action: ApiMutationAction,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  let actor: string;
  let key: string;
  let familyId: string | null;
  let memberId: string | null;
  let envelope: string;
  try {
    if (
      identity === null ||
      typeof identity !== "object" ||
      typeof identity.authSubject !== "string" ||
      identity.authSubject.trim().length === 0 ||
      typeof identity.sessionId !== "string" ||
      identity.sessionId.trim().length === 0 ||
      request === null ||
      typeof request !== "object" ||
      typeof request.key !== "string" ||
      request.key.length > 200 ||
      !ApiIdempotencyKey.safeParse(request.key).success ||
      /[^A-Za-z0-9._:-]/.test(request.key) ||
      typeof request.operation !== "string" ||
      request.operation.length > 100 ||
      !/^[a-z][a-z0-9_.:-]*(?![\s\S])/.test(request.operation)
    ) {
      throw new ApiIdempotencyError("invalid");
    }
    actor = identity.authSubject;
    key = request.key;
    familyId = scopeId(request.familyId);
    memberId = scopeId(request.memberId);
    if (memberId !== null && familyId === null) throw new ApiIdempotencyError("invalid");
    envelope = canonicalJson({
      operation: request.operation,
      input: request.input,
      familyId,
      memberId,
    });
  } catch {
    throw new ApiIdempotencyError("invalid");
  }
  const now = clockTime(deps.clock);
  const [actorHash, keyHash, requestHash] = await Promise.all([
    sha256Hex(actor),
    sha256Hex(key),
    sha256Hex(envelope),
  ]);
  return deps.db.transaction(async (tx) => {
    await lockApiActor(tx, actorHash);
    const [inserted] = await tx
      .insert(apiRequestReceipts)
      .values({
        actorHash,
        keyHash,
        requestHash,
        result: null,
        familyId: null,
        memberId: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + lifetime),
      })
      .onConflictDoNothing({ target: [apiRequestReceipts.actorHash, apiRequestReceipts.keyHash] })
      .returning();
    const receipt =
      inserted ??
      (
        await tx
          .select()
          .from(apiRequestReceipts)
          .where(
            and(
              eq(apiRequestReceipts.actorHash, actorHash),
              eq(apiRequestReceipts.keyHash, keyHash),
            ),
          )
          .for("update")
      )[0];
    if (receipt === undefined) throw new ApiIdempotencyError("unavailable");
    await action.authorize(tx);
    if (memberId !== null && familyId !== null) {
      const [member] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.familyId, familyId)))
        .limit(1);
      if (member === undefined) throw new Error("API mutation access denied");
    }
    const checkedAt = clockTime(deps.clock);
    const otherReceiptsForActor = and(
      eq(apiRequestReceipts.actorHash, actorHash),
      ne(apiRequestReceipts.id, receipt.id),
    );
    await tx
      .delete(apiRequestReceipts)
      .where(and(otherReceiptsForActor, lte(apiRequestReceipts.expiresAt, checkedAt)));
    if (inserted === undefined && receipt.expiresAt.getTime() > checkedAt.getTime()) {
      if (receipt.requestHash !== requestHash) throw new ApiIdempotencyError("conflict");
      return { response: cloneResponse(receipt.result), replayed: true };
    }
    const [usage] = await tx
      .select({ total: count() })
      .from(apiRequestReceipts)
      .where(otherReceiptsForActor);
    if (usage === undefined) throw new ApiIdempotencyError("unavailable");
    if (usage.total >= MAX_API_RECEIPTS_PER_ACTOR) throw new ApiIdempotencyError("rate_limited");
    const response = cloneResponse(await action.mutate(tx));
    const completedAt = clockTime(deps.clock);
    const updated = await tx
      .update(apiRequestReceipts)
      .set({
        actorHash,
        keyHash,
        requestHash,
        result: response,
        familyId,
        memberId,
        createdAt: completedAt,
        expiresAt: new Date(completedAt.getTime() + lifetime),
      })
      .where(eq(apiRequestReceipts.id, receipt.id))
      .returning({ id: apiRequestReceipts.id });
    if (updated.length !== 1) throw new Error("API mutation receipt update failed");
    return { response, replayed: false };
  });
}
