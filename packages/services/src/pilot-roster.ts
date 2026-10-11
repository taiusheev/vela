/**
 * The English trial's roster (ADR-45): the Telegram identities the founder approved on the admin
 * page, beside the pilot Worker's private `PILOT_TELEGRAM_ALLOWLIST`. Admission reads both, so a
 * relative the founder approves takes part from the next request, with no secret to put and no
 * deploy. An empty roster admits nobody, as an empty allowlist always did.
 *
 * Each change is one row in `admin_access_log` (`roster_add`, `roster_remove`), naming the id and
 * the Access identity that made it. Ids only: never a name or a phone number.
 */
import { adminAccessLog, pilotRoster } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AdminContext } from "./admin.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import type { PilotAdmission } from "./pilot-admission.ts";
import type { Queryable } from "./repo.ts";

/** A numeric Telegram user id, as the bot shows a participant and the private allowlist holds. */
export const TelegramUserId = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,12}$/)
  .refine((id) => Number(id) <= 1099511627775);

const Admin = z.string().trim().min(1).max(320);

/** The approved ids, oldest first. */
export async function rosterIds(db: Queryable): Promise<string[]> {
  const rows = await db
    .select({ id: pilotRoster.telegramUserId })
    .from(pilotRoster)
    .orderBy(asc(pilotRoster.addedAt), asc(pilotRoster.telegramUserId));
  return rows.map((row) => row.id);
}

/**
 * Admission with the roster added to the Worker's allowlist; null (admission off) stays null, so an
 * environment without a closed pilot never reads the table.
 */
export async function admissionWithRoster(
  db: Queryable,
  base: PilotAdmission | null | undefined,
): Promise<PilotAdmission | null> {
  if (base == null) return null;
  const ids = await rosterIds(db);
  return { telegramUserIds: [...new Set([...base.telegramUserIds, ...ids])] };
}

export interface RosterEntry {
  telegramUserId: string;
  addedAt: Date;
}

/** The roster as the admin page shows it. Ids, not family data, so no family view is logged. */
export async function loadRoster(deps: Pick<Deps, "db">): Promise<RosterEntry[]> {
  return deps.db
    .select({ telegramUserId: pilotRoster.telegramUserId, addedAt: pilotRoster.addedAt })
    .from(pilotRoster)
    .orderBy(asc(pilotRoster.addedAt), asc(pilotRoster.telegramUserId));
}

function parsed(ctx: AdminContext, id: string): { admin: string; id: string } {
  const admin = Admin.safeParse(ctx.admin);
  const telegramUserId = TelegramUserId.safeParse(id);
  if (!admin.success || !telegramUserId.success) {
    throw new VelaError("invalid_payload", "A roster change needs an admin and a Telegram user id");
  }
  return { admin: admin.data, id: telegramUserId.data };
}

/** Approves an id. Approving one already there changes nothing and logs nothing. */
export async function addToRoster(
  deps: Pick<Deps, "db" | "clock">,
  ctx: AdminContext,
  id: string,
): Promise<"added" | "already"> {
  const change = parsed(ctx, id);
  const at = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(pilotRoster)
      .values({ telegramUserId: change.id, addedAt: at })
      .onConflictDoNothing()
      .returning({ id: pilotRoster.telegramUserId });
    if (row === undefined) return "already";
    await tx.insert(adminAccessLog).values({
      admin: change.admin,
      familyId: null,
      memberId: null,
      action: "roster_add",
      what: `telegram:${change.id}`,
      at,
    });
    return "added";
  });
}

/**
 * Withdraws an id's approval. Its families' automatic work pauses at once (`pilotFamilyAllowed`);
 * stop, privacy and deletion still answer it, as they do for anyone removed from the allowlist.
 */
export async function removeFromRoster(
  deps: Pick<Deps, "db" | "clock">,
  ctx: AdminContext,
  id: string,
): Promise<"removed" | "absent"> {
  const change = parsed(ctx, id);
  const at = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(pilotRoster)
      .where(eq(pilotRoster.telegramUserId, change.id))
      .returning({ id: pilotRoster.telegramUserId });
    if (row === undefined) return "absent";
    await tx.insert(adminAccessLog).values({
      admin: change.admin,
      familyId: null,
      memberId: null,
      action: "roster_remove",
      what: `telegram:${change.id}`,
      at,
    });
    return "removed";
  });
}
