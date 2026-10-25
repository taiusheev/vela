/**
 * The English trial's roster (ADR-45): the Telegram identities the founder approved on the admin
 * page, beside the pilot Worker's private `PILOT_TELEGRAM_ALLOWLIST`. Admission reads both, so a
 * relative the founder approves takes part from the next request, with no secret to put and no
 * deploy. An empty roster admits nobody, as an empty allowlist always did.
 *
 * Each change is one row in `admin_access_log` (`roster_add`, `roster_remove`), naming the id and
 * the Access identity that made it. Ids only: never a name or a phone number.
 */
import {
  adminAccessLog,
  channelLinks,
  families,
  members,
  pilotFamilies,
  pilotRoster,
} from "@vela/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
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
 * Admission with the roster added to the Worker's allowlist, and with family approval on (ADR-52)
 * the approved families; null (admission off) stays null, so an environment without a closed
 * pilot never reads the tables.
 */
export async function admissionWithRoster(
  db: Queryable,
  base: PilotAdmission | null | undefined,
): Promise<PilotAdmission | null> {
  if (base == null) return null;
  const ids = await rosterIds(db);
  const withIds = { ...base, telegramUserIds: [...new Set([...base.telegramUserIds, ...ids])] };
  if (base.familyIds === undefined) return withIds;
  const approved = await db.select({ id: pilotFamilies.familyId }).from(pilotFamilies);
  return {
    ...withIds,
    familyIds: [...new Set([...base.familyIds, ...approved.map((row) => row.id)])],
  };
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

// ADR-52: the closed test's families -----------------------------------------------------------

const FamilyId = z.string().uuid();

export interface PilotFamilyEntry {
  familyId: string;
  createdAt: Date;
  language: string;
  /** People in the family who have not left. */
  members: number;
  /** The messengers its people linked, as `telegram` or `line`; none before anyone has. */
  messengers: string[];
  approvedAt: Date | null;
}

/**
 * Every family not deleted, newest first, with whether the founder approved it. Ids, counts and
 * dates only, never a name: the family's own page, which logs its view, shows who it is.
 */
export async function loadPilotFamilies(deps: Pick<Deps, "db">): Promise<PilotFamilyEntry[]> {
  const rows = await deps.db
    .select({
      familyId: families.id,
      createdAt: families.createdAt,
      language: families.language,
      approvedAt: pilotFamilies.approvedAt,
      memberId: members.id,
      channel: channelLinks.channel,
    })
    .from(families)
    .leftJoin(pilotFamilies, eq(pilotFamilies.familyId, families.id))
    .leftJoin(members, and(eq(members.familyId, families.id), isNull(members.leftAt)))
    .leftJoin(channelLinks, eq(channelLinks.memberId, members.id))
    .where(isNull(families.deletedAt))
    .orderBy(desc(families.createdAt), asc(families.id));
  const entries = new Map<string, PilotFamilyEntry & { people: Set<string> }>();
  for (const row of rows) {
    const entry = entries.get(row.familyId) ?? {
      familyId: row.familyId,
      createdAt: row.createdAt,
      language: row.language,
      members: 0,
      messengers: [],
      approvedAt: row.approvedAt,
      people: new Set<string>(),
    };
    if (row.memberId !== null) entry.people.add(row.memberId);
    if (row.channel !== null && !entry.messengers.includes(row.channel)) {
      entry.messengers.push(row.channel);
    }
    entries.set(row.familyId, entry);
  }
  return [...entries.values()].map(({ people, ...entry }) => ({
    ...entry,
    members: people.size,
    messengers: entry.messengers.sort(),
  }));
}

function familyChange(ctx: AdminContext, familyId: string): { admin: string; familyId: string } {
  const admin = Admin.safeParse(ctx.admin);
  const id = FamilyId.safeParse(familyId);
  if (!admin.success || !id.success) {
    throw new VelaError("invalid_payload", "A family approval needs an admin and a family id");
  }
  return { admin: admin.data, familyId: id.data.toLowerCase() };
}

/**
 * Approves a family for the closed test: it takes part from its next message, on any messenger,
 * with everyone who joins it. Approving one already approved changes nothing and logs nothing.
 */
export async function approveFamily(
  deps: Pick<Deps, "db" | "clock">,
  ctx: AdminContext,
  familyId: string,
): Promise<"approved" | "already"> {
  const change = familyChange(ctx, familyId);
  const at = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const [family] = await tx
      .select({ id: families.id })
      .from(families)
      .where(and(eq(families.id, change.familyId), isNull(families.deletedAt)))
      .for("update");
    if (family === undefined) throw new VelaError("not_found", "Family not found");
    const [row] = await tx
      .insert(pilotFamilies)
      .values({ familyId: change.familyId, approvedAt: at })
      .onConflictDoNothing()
      .returning({ id: pilotFamilies.familyId });
    if (row === undefined) return "already";
    await tx.insert(adminAccessLog).values({
      admin: change.admin,
      familyId: change.familyId,
      memberId: null,
      action: "family_approve",
      what: "closed test",
      at,
    });
    return "approved";
  });
}

/**
 * Withdraws a family's approval. Its automatic work pauses at once (`pilotFamilyAllowed`); stop,
 * privacy and deletion still answer its people.
 */
export async function unapproveFamily(
  deps: Pick<Deps, "db" | "clock">,
  ctx: AdminContext,
  familyId: string,
): Promise<"unapproved" | "absent"> {
  const change = familyChange(ctx, familyId);
  const at = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(pilotFamilies)
      .where(eq(pilotFamilies.familyId, change.familyId))
      .returning({ id: pilotFamilies.familyId });
    if (row === undefined) return "absent";
    await tx.insert(adminAccessLog).values({
      admin: change.admin,
      familyId: change.familyId,
      memberId: null,
      action: "family_unapprove",
      what: "closed test",
      at,
    });
    return "unapproved";
  });
}
