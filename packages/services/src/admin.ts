/**
 * The founder's admin page (flows §3.17, code design §8 "Admin actions"): one function per
 * `ADMIN_ACTIONS` value, served by the worker as POST forms under `/admin` behind a verified
 * Cloudflare Access token, plus the reads the two pages need.
 *
 * Every write validates its form input, checks that every id belongs to the family, and then, in
 * one transaction, applies the change, writes one `admin_access_log` row, and records one domain
 * event. A form a browser resubmits is harmless: an action whose effect is already in place writes
 * nothing at all, so the log holds one row per change rather than one per click. `what` names a
 * kind, dates, or an id, never message content, names, or phone numbers. Nothing here sends a
 * message except the weekly read, and that only to organisers, through the gateway.
 */
import { type AdminAction, type Channel, type DomainEvent, Lang, LocalDate } from "@vela/contracts";
import {
  addDays,
  localDateOf,
  outboundKey,
  renderWeeklyRead,
  type WeeklyReadStats,
} from "@vela/core";
import {
  type AiCall,
  type Answer,
  type AwayPeriod,
  adminAccessLog,
  aiCalls,
  answers,
  awayPeriods,
  type ChannelLink,
  type Consent,
  channelLinks,
  consents,
  deletions,
  type Exchange,
  exchanges,
  type Family,
  families,
  invites,
  type Member,
  members,
  NEARBY_CONTACT_CHANNELS,
  type NearbyContact,
  nearbyContacts,
  type QuietEvent,
  quietEvents,
  translations,
  type VelaTransaction,
  type WeeklyRead,
  weeklyReads,
} from "@vela/db";
import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Config, Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { enqueueOutbound } from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import {
  activeOrganisersWithLinks,
  exchangeForLocalDate,
  familyById,
  keptLightMembersOfFamily,
  markWakeDue,
  memberById,
  type Queryable,
} from "./repo.ts";

/** The pilot's organisers are reached on Telegram (flows §3.17). */
const ORGANISER_CHANNEL: Channel = "telegram";

/** Spec Appendix A: at most two people near her, so a quiet notice stays a short list to call. */
const MAX_NEARBY_CONTACTS = 2;

/**
 * The understanding re-run gives up after this many starts (flows §3.15); an answer that reached it
 * without `understood_at` is one the founder is told about and the family page lists.
 */
const UNDERSTANDING_ATTEMPT_LIMIT = 3;

/** The overview counts a family's AI calls and failures over this window. */
const DAY_MS = 86_400_000;

const DAYS_IN_WEEK = 7;

/**
 * The founder reads the admin conversation in English, the copy's source language: every
 * `admin.*` message is written in it, whatever the family speaks.
 */
export const ADMIN_LANG: Lang = "en";

/**
 * The admin conversation is one chat on one channel: the founder's chat with the bot on Telegram,
 * like the pilot's families (flows §3.14). Every row addressed to `Config.adminConversationId`
 * carries this channel, whatever channel the family that caused it is on, or the row would be
 * handed to another channel's adapter with a Telegram chat id.
 */
export const ADMIN_CHANNEL: Channel = "telegram";

/** The path of the overview; the family page is `familyPagePath`. The worker serves both (§9). */
export const ADMIN_OVERVIEW_PATH = "/admin";

export function familyPagePath(familyId: string): string {
  return `/admin/families/${familyId}`;
}

/** The `{link}` in admin messages: the family's page on the Worker's public origin. */
export function adminLink(config: Config, familyId: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}${familyPagePath(familyId)}`;
}

// Input ---------------------------------------------------------------------------------------------

const Uuid = z.uuid();

const AdminContextSchema = z.object({
  admin: z.string().trim().min(1).max(320),
  familyId: Uuid.optional(),
});

export interface AdminContext {
  /** The identity in the verified Cloudflare Access JWT (the `email` claim): every log row's `admin`. */
  admin: string;
  /**
   * The family the page the form was posted from is about, when the route names one: every id in
   * the form must then belong to it, so a form cannot act on another family's rows.
   */
  familyId?: string;
}

type ParsedContext = z.output<typeof AdminContextSchema>;

/** Only the founder's own words: a message id, a screen, a paper form's reference. */
const Evidence = z.record(z.string().min(1).max(60), z.string().max(500));

const TextVersion = z.string().trim().min(1).max(80);
const ConsentChannel = z.string().trim().min(1).max(40);

const AdminViewSchema = z.object({
  familyIds: z.array(Uuid).max(1000),
  memberId: Uuid.nullable(),
  /** The page path, so a family's copy of the log names every page that showed its records. */
  what: z.string().trim().min(1).max(200),
});
export type AdminView = z.input<typeof AdminViewSchema>;

const RecordConsentSchema = z.object({
  memberId: Uuid,
  kind: z.enum(["pilot", "privacy_notice"]),
  textVersion: TextVersion,
  lang: Lang,
  channel: ConsentChannel,
  givenAt: z.date(),
  evidence: Evidence,
});
export type RecordConsentInput = z.input<typeof RecordConsentSchema>;

const RecordContactConsentSchema = z.object({
  contactId: Uuid,
  answer: z.enum(["yes", "no"]),
  at: z.date(),
  textVersion: TextVersion,
  lang: Lang,
  channel: ConsentChannel,
  evidence: Evidence,
});
export type RecordContactConsentInput = z.input<typeof RecordContactConsentSchema>;

const AddContactSchema = z.object({
  memberId: Uuid,
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(1).max(40),
  // An empty relation field on the form means none.
  relation: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .transform((value) => (value === "" ? null : value)),
  channel: z.enum(NEARBY_CONTACT_CHANNELS).nullable(),
});
export type AddContactInput = z.input<typeof AddContactSchema>;

const SetAwaySchema = z
  .object({
    memberId: Uuid,
    /** The organiser who asked for the away period. */
    setBy: Uuid,
    from: LocalDate,
    until: LocalDate.nullable(),
  })
  .refine((input) => input.until === null || input.until >= input.from, {
    message: "an away period cannot end before it starts",
    path: ["until"],
  });
export type SetAwayInput = z.input<typeof SetAwaySchema>;

/**
 * The lines as the founder edited them: the model's own bounds (`WeeklyRead` in @vela/ai), blank
 * lines dropped, so `sent_lines` keeps the shape of `lines`. An empty suggestion means the founder
 * removed it.
 */
const SendWeeklyReadSchema = z.object({
  weeklyReadId: Uuid,
  lines: z
    .array(z.string().trim().max(300))
    .max(4)
    .transform((lines) => lines.filter((line) => line.length > 0)),
  suggestion: z.string().trim().max(200),
});
export type SendWeeklyReadInput = z.input<typeof SendWeeklyReadSchema>;

export type SendWeeklyReadResult = "sent" | "already_sent" | "no_organiser" | "budget";

/** `weekly_reads.stats` as `renderWeeklyRead` needs it; the other numbers in the column are ignored. */
const StoredWeeklyReadStats = z.object({
  counted_days: z.number().int().min(1).max(DAYS_IN_WEEK),
  answered_days: z.number().int().min(0).max(DAYS_IN_WEEK),
  hello_mornings: z.number().int().min(0).max(DAYS_IN_WEEK),
  family_asks: z.number().int().min(0),
});

/** A form that does not parse is refused before anything is read; the cause never reaches a page. */
function parse<S extends z.ZodType>(schema: S, value: unknown, action: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new VelaError("invalid_payload", `${action}: the input does not parse`, {
      cause: result.error,
    });
  }
  return result.data;
}

function parseContext(ctx: AdminContext): ParsedContext {
  return parse(AdminContextSchema, ctx, "admin");
}

// Scope and the log --------------------------------------------------------------------------------

/** Every id in a form must belong to the family the form was posted from. */
function assertInScope(ctx: ParsedContext, familyId: string, action: string): void {
  if (ctx.familyId !== undefined && ctx.familyId !== familyId) {
    throw new VelaError("not_found", `${action}: the row is not in this family`);
  }
}

interface MemberScope {
  member: Member;
  family: Family;
}

/**
 * The member a form is about, locked for the transaction so two clicks on one button decide one
 * after the other, with their family.
 */
async function lockMember(
  tx: VelaTransaction,
  ctx: ParsedContext,
  memberId: string,
  action: string,
): Promise<MemberScope> {
  const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (member === undefined) {
    throw new VelaError("not_found", `${action}: member ${memberId} does not exist`);
  }
  assertInScope(ctx, member.familyId, action);
  const family = await familyById(tx, member.familyId);
  if (family === null) {
    throw new VelaError("not_found", `${action}: family ${member.familyId} does not exist`);
  }
  return { member, family };
}

async function lockContact(
  tx: VelaTransaction,
  ctx: ParsedContext,
  contactId: string,
  action: string,
): Promise<NearbyContact | null> {
  const [contact] = await tx
    .select()
    .from(nearbyContacts)
    .where(eq(nearbyContacts.id, contactId))
    .for("update");
  if (contact === undefined) {
    return null;
  }
  assertInScope(ctx, contact.familyId, action);
  return contact;
}

interface AdminChange {
  action: Exclude<AdminAction, "view">;
  familyId: string;
  /** The member the action is about, when it is about one. */
  memberId: string | null;
  /** A kind, dates, or an id: never content, names, or phone numbers. */
  what: string;
  event: DomainEvent;
}

/** The log row and the domain event, in the transaction that made the change. */
async function logChange(
  tx: VelaTransaction,
  ctx: ParsedContext,
  at: Date,
  change: AdminChange,
): Promise<void> {
  await tx.insert(adminAccessLog).values({
    admin: ctx.admin,
    familyId: change.familyId,
    memberId: change.memberId,
    action: change.action,
    what: change.what,
    at,
  });
  await recordEvent(tx, change.event, at);
}

/** The repo's rule for a kept-light member: her light is on, or was consented to once. */
function isKeptLight(member: Member): boolean {
  return member.lightOn || member.lightConsentedAt !== null;
}

/**
 * Points her scheduler at now, so the next decision sees the change (an away period set or ended).
 * Only an active kept-light member has a schedule to re-decide: a paused one had it cleared when she
 * said stop, and `start` re-arms it. Returns whether the caller must wake the scheduler after commit.
 */
async function scheduleTick(tx: VelaTransaction, member: Member, at: Date): Promise<boolean> {
  if (!(isKeptLight(member) && member.status === "active")) {
    return false;
  }
  await markWakeDue(tx, member.id, at);
  return true;
}

function inserted<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${what}: the insert returned no row`);
  }
  return row;
}

// Views ---------------------------------------------------------------------------------------------

/**
 * One `view` row and one `admin_page_opened` event per family whose records the page shows, so a
 * family's copy of the log names every page that showed them: the family page passes its family,
 * the overview every family it lists.
 */
export async function recordAdminView(
  deps: Deps,
  ctx: AdminContext,
  view: AdminView,
): Promise<void> {
  const admin = parseContext(ctx);
  const input = parse(AdminViewSchema, view, "view");
  const familyIds = [...new Set(input.familyIds)];
  if (familyIds.length === 0) {
    return;
  }
  const at = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    for (const familyId of familyIds) {
      await tx.insert(adminAccessLog).values({
        admin: admin.admin,
        familyId,
        memberId: input.memberId,
        action: "view",
        what: input.what,
        at,
      });
      await recordEvent(
        tx,
        {
          name: "admin_page_opened",
          familyId,
          memberId: input.memberId ?? undefined,
          props: { what: input.what },
        },
        at,
      );
    }
  });
}

// Consents ------------------------------------------------------------------------------------------

/** A pilot or privacy-notice consent the founder witnessed; nothing when that version is on file. */
export async function recordConsent(
  deps: Deps,
  ctx: AdminContext,
  rawInput: RecordConsentInput,
): Promise<void> {
  const admin = parseContext(ctx);
  const input = parse(RecordConsentSchema, rawInput, "record_consent");
  const at = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const { member, family } = await lockMember(tx, admin, input.memberId, "record_consent");
    const existing = await tx
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.memberId, member.id),
          eq(consents.kind, input.kind),
          eq(consents.textVersion, input.textVersion),
          isNull(consents.withdrawnAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return;
    }
    await tx.insert(consents).values({
      memberId: member.id,
      kind: input.kind,
      textVersion: input.textVersion,
      lang: input.lang,
      channel: input.channel,
      givenAt: input.givenAt,
      evidence: { ...input.evidence, recorded_by: "founder" },
    });
    await logChange(tx, admin, at, {
      action: "record_consent",
      familyId: family.id,
      memberId: member.id,
      what: `consent ${input.kind} ${input.textVersion}`,
      event: {
        name: "consent_given",
        familyId: family.id,
        memberId: member.id,
        props: { kind: input.kind, recorded_by: "founder" },
      },
    });
  });
}

/**
 * A nearby contact's answer to being listed in quiet notices (flows §3.17). A yes lists them from
 * `at`; a no unlists them and withdraws their nearby consents. The same answer twice changes nothing;
 * a yes after a no, or a no after a yes, is a new answer.
 */
export async function recordContactConsent(
  deps: Deps,
  ctx: AdminContext,
  rawInput: RecordContactConsentInput,
): Promise<void> {
  const admin = parseContext(ctx);
  const input = parse(RecordContactConsentSchema, rawInput, "record_contact_consent");
  const at = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const contact = await lockContact(tx, admin, input.contactId, "record_contact_consent");
    if (contact === null) {
      throw new VelaError("not_found", "record_contact_consent: contact does not exist");
    }
    const listed = contact.consentedAt !== null && contact.declinedAt === null;
    if (input.answer === "yes") {
      if (listed) {
        return;
      }
      await tx
        .update(nearbyContacts)
        .set({ consentedAt: input.at, declinedAt: null })
        .where(eq(nearbyContacts.id, contact.id));
      await tx.insert(consents).values({
        contactId: contact.id,
        kind: "nearby",
        textVersion: input.textVersion,
        lang: input.lang,
        channel: input.channel,
        givenAt: input.at,
        evidence: { ...input.evidence, recorded_by: "founder" },
      });
    } else {
      if (contact.declinedAt !== null) {
        return;
      }
      await tx
        .update(nearbyContacts)
        .set({ declinedAt: input.at })
        .where(eq(nearbyContacts.id, contact.id));
      await tx
        .update(consents)
        .set({ withdrawnAt: input.at })
        .where(
          and(
            eq(consents.contactId, contact.id),
            eq(consents.kind, "nearby"),
            isNull(consents.withdrawnAt),
          ),
        );
    }
    await logChange(tx, admin, at, {
      action: "record_contact_consent",
      familyId: contact.familyId,
      memberId: contact.memberId,
      what: `nearby ${input.answer} contact=${contact.id}`,
      event: {
        name: input.answer === "yes" ? "consent_given" : "consent_declined",
        familyId: contact.familyId,
        memberId: contact.memberId,
        props: { kind: "nearby", contact_id: contact.id, recorded_by: "founder" },
      },
    });
  });
}

// Nearby contacts -----------------------------------------------------------------------------------

/**
 * A person near her, stored unconsented: they are listed in quiet notices only once
 * `recordContactConsent` records their yes. A contact with the same number is the same person, so a
 * resubmitted form adds nobody.
 */
export async function addContact(
  deps: Deps,
  ctx: AdminContext,
  rawInput: AddContactInput,
): Promise<void> {
  const admin = parseContext(ctx);
  const input = parse(AddContactSchema, rawInput, "add_contact");
  const at = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const { member, family } = await lockMember(tx, admin, input.memberId, "add_contact");
    const existing = await tx
      .select({ phone: nearbyContacts.phone })
      .from(nearbyContacts)
      .where(eq(nearbyContacts.memberId, member.id));
    if (existing.some((contact) => contact.phone === input.phone)) {
      return;
    }
    if (existing.length >= MAX_NEARBY_CONTACTS) {
      throw new VelaError(
        "illegal_state",
        `add_contact: the member already has ${MAX_NEARBY_CONTACTS} nearby contacts`,
      );
    }
    const contact = inserted(
      await tx
        .insert(nearbyContacts)
        .values({
          familyId: family.id,
          memberId: member.id,
          name: input.name,
          relation: input.relation,
          phone: input.phone,
          channel: input.channel,
          createdAt: at,
        })
        .returning({ id: nearbyContacts.id }),
      "add_contact",
    );
    await logChange(tx, admin, at, {
      action: "add_contact",
      familyId: family.id,
      memberId: member.id,
      what: `contact=${contact.id}`,
      event: {
        name: "nearby_contact_added",
        familyId: family.id,
        memberId: member.id,
        props: { contact_id: contact.id, by: "founder" },
      },
    });
  });
}

/**
 * Deletes the contact (their consents cascade) and proves it with a `deletions` row that holds a
 * hash of the number, never the number. A contact already removed is known only from that row, which
 * is what tells a resubmitted form from a wrong id.
 */
export async function removeContact(
  deps: Deps,
  ctx: AdminContext,
  contactId: string,
): Promise<void> {
  const admin = parseContext(ctx);
  const id = parse(Uuid, contactId, "remove_contact");
  const at = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const contact = await lockContact(tx, admin, id, "remove_contact");
    if (contact === null) {
      const gone = await tx
        .select({ id: deletions.id })
        .from(deletions)
        .where(and(eq(deletions.objectType, "nearby_contact"), eq(deletions.objectId, id)))
        .limit(1);
      if (gone.length > 0) {
        return;
      }
      throw new VelaError("not_found", "remove_contact: contact does not exist");
    }
    const contentHash = await sha256Hex(contact.phone);
    await tx.delete(nearbyContacts).where(eq(nearbyContacts.id, contact.id));
    await tx.insert(deletions).values({
      objectType: "nearby_contact",
      objectId: contact.id,
      contentHash,
      reason: "admin remove_contact",
      deletedAt: at,
    });
    await logChange(tx, admin, at, {
      action: "remove_contact",
      familyId: contact.familyId,
      memberId: contact.memberId,
      what: `contact=${contact.id}`,
      event: {
        name: "nearby_contact_removed",
        familyId: contact.familyId,
        memberId: contact.memberId,
        props: { contact_id: contact.id, by: "founder" },
      },
    });
  });
}

// Away ----------------------------------------------------------------------------------------------

/**
 * An away period an organiser asked for (source `organiser`), then her schedule is re-decided so
 * repeats and quiet notices stop for those dates. The same open period twice is stored once.
 */
export async function setAway(
  deps: Deps,
  ctx: AdminContext,
  rawInput: SetAwayInput,
): Promise<void> {
  const admin = parseContext(ctx);
  const input = parse(SetAwaySchema, rawInput, "set_away");
  const at = deps.clock.now();
  const wake = await deps.db.transaction(async (tx) => {
    const { member, family } = await lockMember(tx, admin, input.memberId, "set_away");
    // The period is credited to the organiser who asked (flows §3.17), so the form cannot name a
    // family member, or someone from another family, as its source.
    const setBy = await memberById(tx, input.setBy);
    if (setBy === null || setBy.familyId !== family.id || setBy.role !== "organiser") {
      throw new VelaError(
        "not_found",
        "set_away: the organiser who asked is not an organiser of this family",
      );
    }
    const open = await tx
      .select({ id: awayPeriods.id })
      .from(awayPeriods)
      .where(
        and(
          eq(awayPeriods.memberId, member.id),
          isNull(awayPeriods.endedAt),
          eq(awayPeriods.fromDate, input.from),
          input.until === null ? isNull(awayPeriods.toDate) : eq(awayPeriods.toDate, input.until),
        ),
      )
      .limit(1);
    if (open.length > 0) {
      return false;
    }
    await tx.insert(awayPeriods).values({
      memberId: member.id,
      fromDate: input.from,
      toDate: input.until,
      source: "organiser",
      setBy: setBy.id,
      createdAt: at,
    });
    await logChange(tx, admin, at, {
      action: "set_away",
      familyId: family.id,
      memberId: member.id,
      what: `away ${input.from}..${input.until ?? "open"}`,
      event: {
        name: "away_set",
        familyId: family.id,
        memberId: member.id,
        props: { source: "organiser", from: input.from, until: input.until, set_by: setBy.id },
      },
    });
    return scheduleTick(tx, member, at);
  });
  if (wake) {
    await deps.scheduler.wakeAt(input.memberId, at);
  }
}

/** Ends an away period now, then her schedule is re-decided. A period already ended stays as it is. */
export async function endAway(deps: Deps, ctx: AdminContext, awayPeriodId: string): Promise<void> {
  const admin = parseContext(ctx);
  const id = parse(Uuid, awayPeriodId, "end_away");
  const at = deps.clock.now();
  const outcome = await deps.db.transaction(async (tx) => {
    const [period] = await tx
      .select()
      .from(awayPeriods)
      .where(eq(awayPeriods.id, id))
      .for("update");
    if (period === undefined) {
      throw new VelaError("not_found", "end_away: away period does not exist");
    }
    const { member, family } = await lockMember(tx, admin, period.memberId, "end_away");
    if (period.endedAt !== null) {
      return null;
    }
    await tx.update(awayPeriods).set({ endedAt: at }).where(eq(awayPeriods.id, period.id));
    await logChange(tx, admin, at, {
      action: "end_away",
      familyId: family.id,
      memberId: member.id,
      what: `away ${period.fromDate}..${period.toDate ?? "open"} ended`,
      event: {
        name: "away_ended",
        familyId: family.id,
        memberId: member.id,
        props: {
          source: period.source,
          from: period.fromDate,
          until: period.toDate,
          by: "founder",
        },
      },
    });
    return (await scheduleTick(tx, member, at)) ? member.id : null;
  });
  if (outcome !== null) {
    await deps.scheduler.wakeAt(outcome, at);
  }
}

// Leaving, death, deletion ----------------------------------------------------------------------------

/**
 * The member leaves: out of the turn rotation, deleted by retention 30 days on; a kept-light
 * member's scheduler is cleared. A member who takes part in the group again becomes active (flows
 * §3.16). A member already left is left as they are.
 */
export async function markLeft(deps: Deps, ctx: AdminContext, memberId: string): Promise<void> {
  const admin = parseContext(ctx);
  const id = parse(Uuid, memberId, "mark_left");
  const at = deps.clock.now();
  const clearScheduler = await deps.db.transaction(async (tx) => {
    const { member, family } = await lockMember(tx, admin, id, "mark_left");
    if (member.status === "left") {
      return false;
    }
    if (member.status === "deceased") {
      throw new VelaError("illegal_state", "mark_left: the member is deceased");
    }
    const keptLight = isKeptLight(member);
    await tx
      .update(members)
      .set({
        status: "left",
        leftAt: at,
        turnsIn: false,
        ...(keptLight ? { nextWakeAt: null } : {}),
      })
      .where(eq(members.id, member.id));
    await logChange(tx, admin, at, {
      action: "mark_left",
      familyId: family.id,
      memberId: member.id,
      what: "left",
      event: {
        name: "member_left",
        familyId: family.id,
        memberId: member.id,
        props: { source: "admin", role: member.role, kept_light: keptLight },
      },
    });
    return keptLight;
  });
  if (clearScheduler) {
    await deps.scheduler.wakeAt(id, null);
  }
}

/**
 * The kept-light member has died: her light goes off, her scheduler is cleared, and nothing is sent
 * to anyone. From here the gateway drops the family's queued rows, the group's asks, replies, and
 * reactions are ignored, and so are messages from her chat (flows §3.5, §3.7, §3.9, §3.11).
 */
export async function markDeceased(deps: Deps, ctx: AdminContext, memberId: string): Promise<void> {
  const admin = parseContext(ctx);
  const id = parse(Uuid, memberId, "mark_deceased");
  const at = deps.clock.now();
  const changed = await deps.db.transaction(async (tx) => {
    const { member, family } = await lockMember(tx, admin, id, "mark_deceased");
    if (!isKeptLight(member)) {
      throw new VelaError("illegal_state", "mark_deceased: the member is not a kept-light member");
    }
    if (member.status === "deceased") {
      return false;
    }
    await tx
      .update(members)
      .set({ lightOn: false, status: "deceased", nextWakeAt: null })
      .where(eq(members.id, member.id));
    await logChange(tx, admin, at, {
      action: "mark_deceased",
      familyId: family.id,
      memberId: member.id,
      what: "deceased",
      event: { name: "member_marked_deceased", familyId: family.id, memberId: member.id },
    });
    return true;
  });
  if (changed) {
    await deps.scheduler.wakeAt(id, null);
  }
}

/**
 * The family asked to leave Vela: `deleted_at` now, every kept-light member's scheduler cleared;
 * ticks, reconcile, and the gateway skip the family from here and retention deletes it within 24
 * hours (flows §3.15). A family already marked is left as it is.
 */
export async function deleteFamily(deps: Deps, ctx: AdminContext, familyId: string): Promise<void> {
  const admin = parseContext(ctx);
  const id = parse(Uuid, familyId, "delete_family");
  const at = deps.clock.now();
  const clearIds = await deps.db.transaction(async (tx) => {
    const [family] = await tx.select().from(families).where(eq(families.id, id)).for("update");
    if (family === undefined) {
      throw new VelaError("not_found", "delete_family: family does not exist");
    }
    assertInScope(admin, family.id, "delete_family");
    if (family.deletedAt !== null) {
      return [];
    }
    await tx.update(families).set({ deletedAt: at }).where(eq(families.id, family.id));
    const keptLight = await keptLightMembersOfFamily(tx, family.id);
    const ids = keptLight.map((member) => member.id);
    if (ids.length > 0) {
      await tx.update(members).set({ nextWakeAt: null }).where(inArray(members.id, ids));
    }
    await logChange(tx, admin, at, {
      action: "delete_family",
      familyId: family.id,
      memberId: null,
      what: "deletion requested",
      event: {
        name: "family_deletion_requested",
        familyId: family.id,
        props: { kept_light_members: ids.length },
      },
    });
    return ids;
  });
  for (const memberId of clearIds) {
    await deps.scheduler.wakeAt(memberId, null);
  }
}

// The weekly read -----------------------------------------------------------------------------------

function parseStats(read: WeeklyRead): WeeklyReadStats {
  const stats = StoredWeeklyReadStats.safeParse(read.stats);
  if (!stats.success) {
    throw new VelaError("invalid_payload", `weekly read ${read.id}: stats do not parse`, {
      cause: stats.error,
    });
  }
  return {
    countedDays: stats.data.counted_days,
    answeredDays: stats.data.answered_days,
    helloMornings: stats.data.hello_mornings,
    familyAsks: stats.data.family_asks,
  };
}

/** The week's last date, the `date` part of a weekly read's outbound keys. */
function weekEndOf(read: WeeklyRead): LocalDate {
  return addDays(read.weekStart, DAYS_IN_WEEK - 1);
}

/** The organisers' text: the counts from `stats`, then the lines and the suggestion as edited. */
function organiserText(
  family: Family,
  member: Member,
  stats: WeeklyReadStats,
  lines: readonly string[],
  suggestion: string,
): string {
  const text = renderWeeklyRead({
    lang: family.language,
    name: member.displayName,
    stats,
    lines,
    suggestion,
    audience: "organiser",
  });
  if (text === null) {
    throw new VelaError("illegal_state", "the organiser weekly read rendered nothing");
  }
  return text;
}

interface SentWeeklyRead {
  read: WeeklyRead;
  member: Member;
  family: Family;
  lines: string[];
}

/**
 * Her copy for "what does the family see" (flows §3.13): the sent lines in her language when the
 * family writes in another. The suggestion is never translated, since she never sees it. A failed
 * translation stores nothing, and she reads the lines as sent.
 */
async function translateForHer(deps: Deps, sent: SentWeeklyRead): Promise<void> {
  const { read, member, family, lines } = sent;
  if (lines.length === 0 || family.language === member.language) {
    return;
  }
  const outcome = await deps.ai.translate({
    text: lines.join("\n"),
    from: family.language,
    to: member.language,
    speaker: { name: family.name, ageBand: "adult", addressForm: null },
    listener: {
      name: member.displayName,
      ageBand: member.ageBand ?? "elder",
      addressForm: member.addressForm,
    },
    relationship:
      "the family's weekly note about the listener, shown to her as the family reads it",
  });
  const at = deps.clock.now();
  const { record } = outcome;
  await deps.db.transaction(async (tx) => {
    await tx.insert(aiCalls).values({
      familyId: family.id,
      memberId: member.id,
      call: record.call,
      promptVersion: record.promptVersion,
      model: record.model,
      inputRef: { weekly_read_id: read.id, lang: member.language },
      output: outcome.ok ? { text: outcome.value.text } : null,
      ok: outcome.ok,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      tokensCached: record.tokensCached,
      latencyMs: record.latencyMs,
      costUsd: record.costUsd,
      at,
    });
    if (outcome.ok) {
      await tx
        .insert(translations)
        .values({
          objectType: "weekly_read",
          objectId: read.id,
          lang: member.language,
          text: outcome.value.text,
          provider: `${record.model}:${record.promptVersion}`,
          createdAt: at,
        })
        .onConflictDoNothing();
    }
  });
  if (!outcome.ok) {
    deps.logger.warn("weekly_read_translation_failed", {
      weeklyReadId: read.id,
      error: outcome.error,
    });
  }
}

/**
 * Sends the read the founder edited to each active organiser with a Telegram link, as one budgeted
 * `weekly_read` each, keyed by the kept-light member, the week's last date, and the organiser's
 * conversation. `sent_lines`, `sent_suggestion`, and `sent_at` are written together, only when at
 * least one organiser's row was inserted, so a read recorded as sent always reached someone; `lines`
 * and `suggestion` keep the draft. A read already sent is not sent again. When no organiser can
 * receive it, or each already got a weekly read that local day, the send is refused and nothing is
 * stored, logged, or sent, so the founder can send it the next day (flows §3.17).
 */
export async function sendWeeklyRead(
  deps: Deps,
  ctx: AdminContext,
  rawInput: SendWeeklyReadInput,
): Promise<SendWeeklyReadResult> {
  const admin = parseContext(ctx);
  const input = parse(SendWeeklyReadSchema, rawInput, "send_weekly_read");
  const at = deps.clock.now();
  const outcome = await deps.db.transaction(
    async (tx): Promise<SendWeeklyReadResult | SentWeeklyRead> => {
      const [read] = await tx
        .select()
        .from(weeklyReads)
        .where(eq(weeklyReads.id, input.weeklyReadId))
        .for("update");
      if (read === undefined) {
        throw new VelaError("not_found", "send_weekly_read: weekly read does not exist");
      }
      assertInScope(admin, read.familyId, "send_weekly_read");
      if (read.sentAt !== null) {
        return "already_sent";
      }
      const member = await memberById(tx, read.memberId);
      const family = await familyById(tx, read.familyId);
      if (member === null || family === null) {
        throw new VelaError("not_found", "send_weekly_read: the read's member or family is gone");
      }
      const stats = parseStats(read);
      const organisers = await activeOrganisersWithLinks(tx, family.id, ORGANISER_CHANNEL);
      if (organisers.length === 0) {
        return "no_organiser";
      }
      const text = organiserText(family, member, stats, input.lines, input.suggestion);
      const weekEnd = weekEndOf(read);
      let sentTo = 0;
      for (const organiser of organisers) {
        const result = await enqueueOutbound(deps, tx, {
          kind: "weekly_read",
          idempotencyKey: outboundKey("weekly_read", {
            memberId: member.id,
            date: weekEnd,
            conversationId: organiser.link.externalId,
          }),
          memberId: organiser.member.id,
          channel: organiser.link.channel,
          conversationId: organiser.link.externalId,
          lang: family.language,
          text,
        });
        if ("outboundId" in result) {
          sentTo += 1;
        }
      }
      if (sentTo === 0) {
        return "budget";
      }
      await tx
        .update(weeklyReads)
        .set({ sentLines: input.lines, sentSuggestion: input.suggestion, sentAt: at })
        .where(eq(weeklyReads.id, read.id));
      await logChange(tx, admin, at, {
        action: "send_weekly_read",
        familyId: family.id,
        memberId: member.id,
        what: `weekly_read=${read.id} week=${read.weekStart} organisers=${sentTo}`,
        event: {
          name: "weekly_read_sent",
          familyId: family.id,
          memberId: member.id,
          props: {
            weekly_read_id: read.id,
            week_start: read.weekStart,
            organisers: sentTo,
            lines: input.lines.length,
            suggestion: input.suggestion.length > 0,
          },
        },
      });
      return { read, member, family, lines: input.lines };
    },
  );
  if (typeof outcome === "string") {
    deps.logger.info("weekly_read_send_refused", {
      weeklyReadId: input.weeklyReadId,
      result: outcome,
    });
    return outcome;
  }
  await translateForHer(deps, outcome);
  return "sent";
}

// The pages -------------------------------------------------------------------------------------------

/** One family on the overview: states, times, kinds, and counts; never words. */
export interface AdminOverviewRow {
  family: Pick<Family, "id" | "name" | "language" | "region" | "createdAt" | "deletedAt">;
  keptLight:
    | (Pick<Member, "id" | "status" | "lightOn" | "lightStartsOn" | "tz" | "nextWakeAt"> & {
        localToday: LocalDate;
      })
    | null;
  /** Her exchange for her local today. */
  today: Pick<
    Exchange,
    | "id"
    | "type"
    | "state"
    | "scheduledFor"
    | "deliveredAt"
    | "deliveryFailedAt"
    | "repeatedAt"
    | "answeredAt"
  > | null;
  quiet: Pick<
    QuietEvent,
    "id" | "openedAt" | "lastNotifiedAt" | "notifyCount" | "waitUntil" | "resolvedAt" | "outcome"
  > | null;
  /** Today's answers: their kinds and processing state. */
  answers: Pick<
    Answer,
    "id" | "kind" | "receivedAt" | "understoodAt" | "processingAttempts" | "flag"
  >[];
  /** AI calls for the family in the last 24 hours. */
  ai: { calls: number; failures: number };
}

async function overviewRow(
  db: Queryable,
  family: Family,
  keptLight: Member | undefined,
  now: Date,
): Promise<AdminOverviewRow> {
  const [ai] = await db
    .select({
      calls: count(),
      failures: sql<number>`count(*) filter (where not ${aiCalls.ok})`.mapWith(Number),
    })
    .from(aiCalls)
    .where(and(eq(aiCalls.familyId, family.id), gte(aiCalls.at, new Date(now.getTime() - DAY_MS))));
  const row: AdminOverviewRow = {
    family: {
      id: family.id,
      name: family.name,
      language: family.language,
      region: family.region,
      createdAt: family.createdAt,
      deletedAt: family.deletedAt,
    },
    keptLight: null,
    today: null,
    quiet: null,
    answers: [],
    ai: { calls: ai?.calls ?? 0, failures: ai?.failures ?? 0 },
  };
  if (keptLight === undefined) {
    return row;
  }
  const localToday = localDateOf(now, keptLight.tz);
  row.keptLight = {
    id: keptLight.id,
    status: keptLight.status,
    lightOn: keptLight.lightOn,
    lightStartsOn: keptLight.lightStartsOn,
    tz: keptLight.tz,
    nextWakeAt: keptLight.nextWakeAt,
    localToday,
  };
  const exchange = await exchangeForLocalDate(db, keptLight.id, localToday);
  if (exchange === null) {
    return row;
  }
  row.today = {
    id: exchange.id,
    type: exchange.type,
    state: exchange.state,
    scheduledFor: exchange.scheduledFor,
    deliveredAt: exchange.deliveredAt,
    deliveryFailedAt: exchange.deliveryFailedAt,
    repeatedAt: exchange.repeatedAt,
    answeredAt: exchange.answeredAt,
  };
  const [quiet] = await db
    .select({
      id: quietEvents.id,
      openedAt: quietEvents.openedAt,
      lastNotifiedAt: quietEvents.lastNotifiedAt,
      notifyCount: quietEvents.notifyCount,
      waitUntil: quietEvents.waitUntil,
      resolvedAt: quietEvents.resolvedAt,
      outcome: quietEvents.outcome,
    })
    .from(quietEvents)
    .where(eq(quietEvents.exchangeId, exchange.id))
    .limit(1);
  row.quiet = quiet ?? null;
  row.answers = await db
    .select({
      id: answers.id,
      kind: answers.kind,
      receivedAt: answers.receivedAt,
      understoodAt: answers.understoodAt,
      processingAttempts: answers.processingAttempts,
      flag: answers.flag,
    })
    .from(answers)
    .where(eq(answers.exchangeId, exchange.id))
    .orderBy(asc(answers.receivedAt), asc(answers.id));
  return row;
}

/**
 * The overview (`GET /admin`): every family with today's delivery, answer, and quiet states and
 * times, the answer kinds, and the AI call counts, each linking to its page; no words. Logs one
 * `view` per family listed before reading.
 */
export async function loadAdminOverview(
  deps: Deps,
  ctx: AdminContext,
): Promise<AdminOverviewRow[]> {
  const now = deps.clock.now();
  const all = await deps.db
    .select()
    .from(families)
    .orderBy(asc(families.createdAt), asc(families.id));
  await recordAdminView(deps, ctx, {
    familyIds: all.map((family) => family.id),
    memberId: null,
    what: ADMIN_OVERVIEW_PATH,
  });
  const rows: AdminOverviewRow[] = [];
  for (const family of all) {
    rows.push(await overviewRow(deps.db, family, await overviewSubject(deps.db, family.id), now));
  }
  return rows;
}

/**
 * The member a family's overview row is about: the kept-light member, or until she has consented
 * the member the family's invite was for, so the founder sees `invited` while the link is unopened
 * or after a No (flows §3.2) rather than a family with nobody in it.
 */
async function overviewSubject(db: Queryable, familyId: string): Promise<Member | undefined> {
  const [keptLight] = await keptLightMembersOfFamily(db, familyId);
  if (keptLight !== undefined) {
    return keptLight;
  }
  const [invited] = await db
    .select({ member: members })
    .from(invites)
    .innerJoin(members, eq(members.id, invites.forMemberId))
    .where(eq(invites.familyId, familyId))
    .orderBy(desc(invites.createdAt), desc(invites.id))
    .limit(1);
  return invited?.member;
}

/** An answer as the family page shows it: its summary and processing state, never the payload. */
export type FamilyPageAnswer = Pick<
  Answer,
  | "id"
  | "exchangeId"
  | "memberId"
  | "kind"
  | "receivedAt"
  | "summary"
  | "moodWords"
  | "flag"
  | "flagReason"
  | "awayUntil"
  | "understoodAt"
  | "processingAttempts"
> & { scheduledFor: LocalDate | null };

export interface FamilyPageWeeklyRead {
  read: WeeklyRead;
  weekEnd: LocalDate;
  /** The count lines as organisers read them, not editable on the page; null when `stats` is corrupt. */
  countLines: string | null;
}

export interface FamilyPage {
  family: Family;
  members: { member: Member; link: ChannelLink | null }[];
  consents: Consent[];
  nearbyContacts: NearbyContact[];
  awayPeriods: AwayPeriod[];
  /** The most recent answers, newest first. */
  answers: FamilyPageAnswer[];
  flagged: FamilyPageAnswer[];
  /** Answers the re-run gave up on: not understood after `UNDERSTANDING_ATTEMPT_LIMIT` starts. */
  notUnderstood: FamilyPageAnswer[];
  weeklyReads: FamilyPageWeeklyRead[];
  /** The most recent AI calls, newest first. */
  aiCalls: AiCall[];
}

/** The family page lists this many recent answers and AI calls. */
const PAGE_LIMIT = 50;

const answerColumns = {
  id: answers.id,
  exchangeId: answers.exchangeId,
  memberId: answers.memberId,
  kind: answers.kind,
  receivedAt: answers.receivedAt,
  summary: answers.summary,
  moodWords: answers.moodWords,
  flag: answers.flag,
  flagReason: answers.flagReason,
  awayUntil: answers.awayUntil,
  understoodAt: answers.understoodAt,
  processingAttempts: answers.processingAttempts,
  scheduledFor: exchanges.scheduledFor,
} as const;

async function familyAnswers(
  db: Queryable,
  familyId: string,
  filter: "all" | "flagged" | "not_understood",
): Promise<FamilyPageAnswer[]> {
  const conditions = [eq(exchanges.familyId, familyId)];
  if (filter === "flagged") {
    conditions.push(eq(answers.flag, true));
  } else if (filter === "not_understood") {
    conditions.push(
      isNull(answers.understoodAt),
      gte(answers.processingAttempts, UNDERSTANDING_ATTEMPT_LIMIT),
    );
  }
  return db
    .select(answerColumns)
    .from(answers)
    .innerJoin(exchanges, eq(exchanges.id, answers.exchangeId))
    .where(and(...conditions))
    .orderBy(desc(answers.receivedAt), desc(answers.id))
    .limit(PAGE_LIMIT);
}

function pageWeeklyRead(
  read: WeeklyRead,
  family: Family,
  member: Member | undefined,
): FamilyPageWeeklyRead {
  const stats = StoredWeeklyReadStats.safeParse(read.stats);
  const countLines =
    stats.success && member !== undefined
      ? renderWeeklyRead({
          lang: family.language,
          name: member.displayName,
          stats: {
            countedDays: stats.data.counted_days,
            answeredDays: stats.data.answered_days,
            helloMornings: stats.data.hello_mornings,
            familyAsks: stats.data.family_asks,
          },
          lines: [],
          suggestion: "",
          audience: "organiser",
        })
      : null;
  return { read, weekEnd: weekEndOf(read), countLines };
}

/**
 * One family's page (`GET /admin/families/:familyId`): members, consents, nearby contacts, away
 * periods, answers with their summaries, the flagged ones and those the re-run could not read, AI
 * calls, and weekly reads with their count lines. Logs one `view` before reading. Null for a family
 * that does not exist, and then nothing is logged: no records were shown.
 */
export async function loadFamilyPage(
  deps: Deps,
  ctx: AdminContext,
  familyId: string,
): Promise<FamilyPage | null> {
  const id = parse(Uuid, familyId, "view");
  const db = deps.db;
  const family = await familyById(db, id);
  if (family === null) {
    return null;
  }
  await recordAdminView(deps, ctx, {
    familyIds: [family.id],
    memberId: null,
    what: familyPagePath(id),
  });

  const memberRows = await db
    .select({ member: members, link: channelLinks })
    .from(members)
    .leftJoin(
      channelLinks,
      and(eq(channelLinks.memberId, members.id), eq(channelLinks.channel, ORGANISER_CHANNEL)),
    )
    .where(eq(members.familyId, family.id))
    .orderBy(asc(members.createdAt), asc(members.id));
  const memberIds = memberRows.map((row) => row.member.id);
  const contacts = await db
    .select()
    .from(nearbyContacts)
    .where(eq(nearbyContacts.familyId, family.id))
    .orderBy(asc(nearbyContacts.createdAt), asc(nearbyContacts.id));
  const contactIds = contacts.map((contact) => contact.id);
  const consentRows =
    memberIds.length === 0
      ? []
      : await db
          .select()
          .from(consents)
          .where(
            contactIds.length === 0
              ? inArray(consents.memberId, memberIds)
              : or(inArray(consents.memberId, memberIds), inArray(consents.contactId, contactIds)),
          )
          .orderBy(asc(consents.givenAt), asc(consents.id));
  const away =
    memberIds.length === 0
      ? []
      : await db
          .select()
          .from(awayPeriods)
          .where(inArray(awayPeriods.memberId, memberIds))
          .orderBy(desc(awayPeriods.fromDate), desc(awayPeriods.id));
  const reads = await db
    .select()
    .from(weeklyReads)
    .where(eq(weeklyReads.familyId, family.id))
    .orderBy(desc(weeklyReads.weekStart), desc(weeklyReads.id));
  const calls = await db
    .select()
    .from(aiCalls)
    .where(eq(aiCalls.familyId, family.id))
    .orderBy(desc(aiCalls.at), desc(aiCalls.id))
    .limit(PAGE_LIMIT);
  const membersById = new Map(memberRows.map((row) => [row.member.id, row.member]));

  return {
    family,
    members: memberRows,
    consents: consentRows,
    nearbyContacts: contacts,
    awayPeriods: away,
    answers: await familyAnswers(db, family.id, "all"),
    flagged: await familyAnswers(db, family.id, "flagged"),
    notUnderstood: await familyAnswers(db, family.id, "not_understood"),
    weeklyReads: reads.map((read) => pageWeeklyRead(read, family, membersById.get(read.memberId))),
    aiCalls: calls,
  };
}
