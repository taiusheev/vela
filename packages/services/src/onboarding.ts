/**
 * Organiser onboarding in a private chat (flows §3.1): a small state machine over
 * `onboarding_sessions`, one step per question, ending in the family, its two members, the nearby
 * contacts, and the single-use invite link in one transaction.
 *
 * Until the family exists there is no member to address an outbound row to, so the prompts go to
 * the adapter directly; the session remembers the last event it handled, so a redelivered update
 * neither moves a step nor repeats a prompt. Only `onboarding.done`, sent once the organiser is a
 * member, goes through the gateway.
 */
import {
  type Button,
  type InboundEvent,
  Lang,
  type LocalTime,
  type MVP_LANGS,
  type OutboundMessage,
  type Region,
} from "@vela/contracts";
import { type MessageKey, t } from "@vela/copy";
import { decodeButton, encodeButton, isValidTimeZone, outboundKey } from "@vela/core";
import {
  channelLinks,
  families,
  members,
  nearbyContacts,
  type OnboardingSession,
  onboardingSessions,
  type VelaTransaction,
} from "@vela/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { enqueueOutbound } from "./gateway.ts";
import { isKeptLightMember, languageOfSender, sendOutsideGateway } from "./group.ts";
import {
  ADDRESS_MAX_LENGTH,
  insertInvite,
  insertInvitedMember,
  NAME_MAX_LENGTH,
} from "./invites.ts";
import { type MemberWithFamily, memberByChannelUser } from "./repo.ts";

/** A session that hears nothing for a day is abandoned (flows §3.1). */
const SESSION_HOURS = 24;
/** Two people the organiser would call first (schema: nearby_contacts). */
const NEARBY_MAX = 2;
/** A contact's name and how they know her are each short, as the step asks for them. */
const NEARBY_FIELD_MAX_LENGTH = 40;
/** Telegram shows at most four buttons comfortably in one row on a phone. */
const BUTTONS_PER_ROW = 4;
/** The kept-light member's country when the organiser chose "Other": ISO 3166-1's user-assigned code. */
const OTHER_COUNTRY = "ZZ";
/** A wake time as typed: `7:30` and `07:30` both mean the same morning. */
const TYPED_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/**
 * A run of digits, spaces, and `+ - ( ) .`. One that holds six digits or more is a phone number,
 * which the nearby step never keeps (L8): a contact's number arrives only with their own yes.
 */
const PHONE_RUN = /[\d\s+\-().]+/g;
const PHONE_MIN_DIGITS = 6;
/** Where a name ends and how they know her begins: "Anna, neighbour", "王小姐，鄰居", "王小姐、鄰居". */
const NEARBY_SEPARATOR = /[,，、]/u;
const SKIP_VALUE = "skip";

export const ONBOARDING_STEPS = [
  "name",
  "address",
  "language",
  "country",
  "zone",
  "wake",
  "nearby",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
const Step = z.enum(ONBOARDING_STEPS);

const NearbyEntry = z.object({ name: z.string().min(1), relation: z.string().min(1).nullable() });
type NearbyEntry = z.infer<typeof NearbyEntry>;

const SessionData = z.object({
  organiserLanguage: Lang,
  /** The last platform event applied, so a redelivered update changes nothing. */
  lastEventId: z.string().optional(),
  name: z.string().optional(),
  address: z.string().optional(),
  language: Lang.optional(),
  country: z.string().optional(),
  timeZone: z.string().optional(),
  wakeTime: z.string().optional(),
  nearby: z.array(NearbyEntry).default([]),
});
type SessionData = z.infer<typeof SessionData>;

const CompleteData = SessionData.required({
  name: true,
  address: true,
  language: true,
  country: true,
  timeZone: true,
  wakeTime: true,
});
type CompleteData = z.infer<typeof CompleteData>;

/** The wake times offered as buttons: 06:00 to 09:00 by half hours (flows §3.1). */
export const WAKE_OPTIONS: readonly LocalTime[] = [
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
];

/** Language names are autonyms, the same in every catalog. */
const LANGUAGE_OPTIONS: readonly { value: (typeof MVP_LANGS)[number]; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

interface ZoneOption {
  readonly label: string;
  readonly zone: string;
}

/**
 * The zones of countries that span several. The labels are the names people use for their zone;
 * the copy catalog has no keys for them, so they read the same in every language.
 */
export const ZONE_OPTIONS: Readonly<Record<string, readonly ZoneOption[]>> = {
  US: [
    { label: "Eastern", zone: "America/New_York" },
    { label: "Central", zone: "America/Chicago" },
    { label: "Mountain", zone: "America/Denver" },
    { label: "Pacific", zone: "America/Los_Angeles" },
    { label: "Alaska", zone: "America/Anchorage" },
    { label: "Hawaii", zone: "Pacific/Honolulu" },
  ],
  CA: [
    { label: "Atlantic", zone: "America/Halifax" },
    { label: "Eastern", zone: "America/Toronto" },
    { label: "Central", zone: "America/Winnipeg" },
    { label: "Mountain", zone: "America/Edmonton" },
    { label: "Pacific", zone: "America/Vancouver" },
  ],
  AU: [
    { label: "Sydney", zone: "Australia/Sydney" },
    { label: "Brisbane", zone: "Australia/Brisbane" },
    { label: "Adelaide", zone: "Australia/Adelaide" },
    { label: "Darwin", zone: "Australia/Darwin" },
    { label: "Perth", zone: "Australia/Perth" },
  ],
};

interface CountryOption {
  readonly code: string;
  readonly key: MessageKey;
  /** The region the country's data should live in (code design §8). */
  readonly region: Region;
  /** The country's one zone; null when the zone step asks. */
  readonly zone: string | null;
}

const COUNTRIES: readonly CountryOption[] = [
  { code: "TW", key: "onboarding.country_tw", region: "apac", zone: "Asia/Taipei" },
  { code: "US", key: "onboarding.country_us", region: "us", zone: null },
  { code: "GB", key: "onboarding.country_gb", region: "eu", zone: "Europe/London" },
  { code: "CA", key: "onboarding.country_ca", region: "us", zone: null },
  { code: "AU", key: "onboarding.country_au", region: "apac", zone: null },
  { code: "SG", key: "onboarding.country_sg", region: "apac", zone: "Asia/Singapore" },
  { code: "JP", key: "onboarding.country_jp", region: "apac", zone: "Asia/Tokyo" },
  { code: "DE", key: "onboarding.country_de", region: "eu", zone: "Europe/Berlin" },
  { code: "IN", key: "onboarding.country_in", region: "apac", zone: "Asia/Kolkata" },
  { code: OTHER_COUNTRY, key: "onboarding.country_other", region: "apac", zone: null },
];

function countryOf(code: string): CountryOption | undefined {
  return COUNTRIES.find((country) => country.code === code);
}

/**
 * The region a new family lives in: the country's preferred region when this environment has a
 * database there, and `apac` otherwise, so every pilot family is `apac` (code design §8).
 */
export function regionForCountry(regions: readonly Region[], country: string): Region {
  const preferred = countryOf(country)?.region ?? "apac";
  return regions.includes(preferred) ? preferred : "apac";
}

/** Whether a text holds a phone number anywhere in it (`PHONE_RUN`). */
function holdsPhoneNumber(text: string): boolean {
  return [...text.matchAll(PHONE_RUN)].some(
    (match) => (match[0].match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS,
  );
}

/**
 * "Name" or "Name, relation": the name before the first separator and how they know her after it,
 * each 1 to 40 characters, the relation null when nothing follows; null when the text is not that.
 */
function parseNearbyEntry(text: string): NearbyEntry | null {
  const trimmed = text.trim();
  const separator = NEARBY_SEPARATOR.exec(trimmed);
  const name = (separator === null ? trimmed : trimmed.slice(0, separator.index)).trim();
  const relation = separator === null ? "" : trimmed.slice(separator.index + 1).trim();
  if (name.length === 0 || name.length > NEARBY_FIELD_MAX_LENGTH) {
    return null;
  }
  if (relation.length > NEARBY_FIELD_MAX_LENGTH) {
    return null;
  }
  return { name, relation: relation === "" ? null : relation };
}

function normaliseTime(text: string): LocalTime | null {
  const match = TYPED_TIME.exec(text.trim());
  if (match === null) {
    return null;
  }
  return `${(match[1] ?? "").padStart(2, "0")}:${match[2] ?? ""}`;
}

function button(step: OnboardingStep, value: string, label: string): Button {
  return { id: encodeButton({ type: "onboarding", step, value }), label };
}

function rows(buttons: readonly Button[]): Button[][] {
  const out: Button[][] = [];
  for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW) {
    out.push(buttons.slice(index, index + BUTTONS_PER_ROW));
  }
  return out;
}

interface Prompt {
  text: string;
  buttons?: Button[][];
}

/** The question for a step, with its buttons; the name step opens with the welcome when `first`. */
function promptFor(lang: Lang, step: OnboardingStep, data: SessionData, first: boolean): Prompt {
  switch (step) {
    case "name":
      return {
        text: first
          ? `${t(lang, "onboarding.welcome")}\n\n${t(lang, "onboarding.ask_name")}`
          : t(lang, "onboarding.ask_name"),
      };
    case "address":
      return { text: t(lang, "onboarding.ask_address") };
    case "language":
      return {
        text: t(lang, "onboarding.ask_language"),
        buttons: rows(
          LANGUAGE_OPTIONS.map((option) => button("language", option.value, option.label)),
        ),
      };
    case "country":
      return {
        text: t(lang, "onboarding.ask_country"),
        buttons: rows(
          COUNTRIES.map((country) => button("country", country.code, t(lang, country.key))),
        ),
      };
    case "zone": {
      const zones = data.country === undefined ? undefined : ZONE_OPTIONS[data.country];
      if (zones === undefined) {
        return { text: t(lang, "onboarding.ask_zone_other") };
      }
      return {
        text: t(lang, "onboarding.ask_zone"),
        buttons: rows(zones.map((option) => button("zone", option.zone, option.label))),
      };
    }
    case "wake":
      return {
        text: t(lang, "onboarding.ask_wake"),
        buttons: rows(WAKE_OPTIONS.map((time) => button("wake", time, time))),
      };
    case "nearby":
      return {
        text: t(lang, "onboarding.ask_nearby"),
        buttons: [[button("nearby", SKIP_VALUE, t(lang, "onboarding.skip"))]],
      };
  }
}

type Input =
  | { kind: "start" }
  | { kind: "text"; text: string }
  | { kind: "button"; step: string; value: string }
  | { kind: "other" };

function readInput(event: InboundEvent): Input {
  switch (event.kind) {
    case "start":
      return event.startParam === undefined ? { kind: "start" } : { kind: "other" };
    case "text":
      return { kind: "text", text: event.text ?? "" };
    case "button": {
      const action = event.buttonData === undefined ? null : decodeButton(event.buttonData);
      return action?.type === "onboarding"
        ? { kind: "button", step: action.step, value: action.value }
        : { kind: "other" };
    }
    default:
      return { kind: "other" };
  }
}

type StepResult =
  | { kind: "repeat"; notice?: MessageKey }
  | { kind: "next"; step: OnboardingStep; data: SessionData; chosen?: string }
  | { kind: "complete"; data: CompleteData; chosen?: string };

function textOf(input: Input, max: number): string | null {
  if (input.kind !== "text") {
    return null;
  }
  const text = input.text.trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

function tapped(input: Input, step: OnboardingStep): string | null {
  return input.kind === "button" && input.step === step ? input.value : null;
}

function isSkip(input: Input, lang: Lang): boolean {
  if (tapped(input, "nearby") === SKIP_VALUE) {
    return true;
  }
  if (input.kind !== "text") {
    return false;
  }
  const typed = input.text.trim().toLowerCase();
  return typed === t(lang, "onboarding.skip").toLowerCase() || typed === SKIP_VALUE;
}

function complete(data: SessionData, chosen?: string): StepResult {
  const parsed = CompleteData.safeParse(data);
  // A session whose earlier steps are missing cannot finish; it starts over from the name.
  return parsed.success
    ? { kind: "complete", data: parsed.data, chosen }
    : {
        kind: "next",
        step: "name",
        data: { organiserLanguage: data.organiserLanguage, nearby: [] },
      };
}

/** One step's validation: what the input means for the session, or that the prompt repeats. */
function applyOnboardingStep(
  step: OnboardingStep,
  data: SessionData,
  input: Input,
  lang: Lang,
): StepResult {
  switch (step) {
    case "name": {
      const name = textOf(input, NAME_MAX_LENGTH);
      return name === null
        ? { kind: "repeat" }
        : { kind: "next", step: "address", data: { ...data, name } };
    }
    case "address": {
      const address = textOf(input, ADDRESS_MAX_LENGTH);
      return address === null
        ? { kind: "repeat" }
        : { kind: "next", step: "language", data: { ...data, address } };
    }
    case "language": {
      const value = tapped(input, "language");
      const option = LANGUAGE_OPTIONS.find((candidate) => candidate.value === value);
      return option === undefined
        ? { kind: "repeat" }
        : {
            kind: "next",
            step: "country",
            data: { ...data, language: option.value },
            chosen: option.label,
          };
    }
    case "country": {
      const value = tapped(input, "country");
      const country = value === null ? undefined : countryOf(value);
      if (country === undefined) {
        return { kind: "repeat" };
      }
      const chosen = t(lang, country.key);
      if (country.zone !== null) {
        return {
          kind: "next",
          step: "wake",
          data: { ...data, country: country.code, timeZone: country.zone },
          chosen,
        };
      }
      return { kind: "next", step: "zone", data: { ...data, country: country.code }, chosen };
    }
    case "zone": {
      const zones = data.country === undefined ? undefined : ZONE_OPTIONS[data.country];
      const value = tapped(input, "zone");
      const option = zones?.find((candidate) => candidate.zone === value);
      if (option !== undefined) {
        return {
          kind: "next",
          step: "wake",
          data: { ...data, timeZone: option.zone },
          chosen: option.label,
        };
      }
      const typed = input.kind === "text" ? input.text.trim() : null;
      if (typed !== null && isValidTimeZone(typed)) {
        return { kind: "next", step: "wake", data: { ...data, timeZone: typed } };
      }
      return { kind: "repeat", notice: "onboarding.invalid_zone" };
    }
    case "wake": {
      const value = tapped(input, "wake");
      const wakeTime =
        value !== null && WAKE_OPTIONS.includes(value)
          ? value
          : input.kind === "text"
            ? normaliseTime(input.text)
            : null;
      if (wakeTime === null) {
        return { kind: "repeat", notice: "onboarding.invalid_time" };
      }
      return {
        kind: "next",
        step: "nearby",
        data: { ...data, wakeTime },
        chosen: value === null ? undefined : value,
      };
    }
    case "nearby": {
      if (isSkip(input, lang)) {
        return complete(data, input.kind === "button" ? t(lang, "onboarding.skip") : undefined);
      }
      if (input.kind !== "text") {
        return { kind: "repeat" };
      }
      // Refused before anything is read, so nothing of a text with a number reaches the session.
      if (holdsPhoneNumber(input.text)) {
        return { kind: "repeat", notice: "onboarding.nearby_no_number" };
      }
      const entry = parseNearbyEntry(input.text);
      if (entry === null) {
        return { kind: "repeat" };
      }
      const nearby = [...data.nearby, entry];
      const next = { ...data, nearby };
      return nearby.length >= NEARBY_MAX
        ? complete(next)
        : { kind: "next", step: "nearby", data: next };
    }
  }
}

/**
 * Creates everything a finished session describes, in the caller's transaction, and returns the
 * organiser's member id. The family's name is the organiser's own display name, because nothing in
 * the flow asks for one and the admin messages need a name the founder recognises.
 */
async function createFamily(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  data: CompleteData,
  now: Date,
): Promise<string> {
  const organiserName = event.sender.displayName ?? data.name;
  const region = regionForCountry(deps.config.regions, data.country);
  const [family] = await tx
    .insert(families)
    .values({
      name: organiserName,
      region,
      country: data.country,
      language: data.organiserLanguage,
      createdAt: now,
    })
    .returning();
  if (family === undefined) {
    throw new Error("family insert returned no row");
  }
  const [organiser] = await tx
    .insert(members)
    .values({
      familyId: family.id,
      role: "organiser",
      billing: true,
      displayName: organiserName,
      language: data.organiserLanguage,
      tz: data.timeZone,
      country: data.country,
      status: "active",
      primarySurface: "telegram",
      createdAt: now,
    })
    .returning();
  if (organiser === undefined) {
    throw new Error("organiser insert returned no row");
  }
  await tx.insert(channelLinks).values({
    memberId: organiser.id,
    channel: event.channel,
    externalId: event.sender.externalUserId,
    displayName: event.sender.displayName ?? null,
    linkedAt: now,
  });
  const her = await insertInvitedMember(
    tx,
    {
      familyId: family.id,
      name: data.name,
      address: data.address,
      language: data.language,
      timeZone: data.timeZone,
      country: data.country,
      wakeTime: data.wakeTime,
    },
    now,
  );
  if (data.nearby.length > 0) {
    // Names only: a contact's number arrives with their yes, on the admin page (flows §3.17).
    await tx.insert(nearbyContacts).values(
      data.nearby.map((contact) => ({
        familyId: family.id,
        memberId: her.id,
        name: contact.name,
        relation: contact.relation,
        createdAt: now,
      })),
    );
  }
  const { link } = await insertInvite(
    deps,
    tx,
    { familyId: family.id, invitedBy: organiser.id, forMemberId: her.id },
    now,
  );
  const lang = data.organiserLanguage;
  await enqueueOutbound(deps, tx, {
    kind: "onboarding",
    idempotencyKey: outboundKey("onboarding", {
      conversationId: event.conversation.externalId,
      suffix: `done:${event.eventId}`,
    }),
    memberId: organiser.id,
    channel: event.channel,
    conversationId: event.conversation.externalId,
    lang,
    text: t(lang, "onboarding.done", { name: data.name, link }),
  });
  await recordEvent(
    tx,
    {
      name: "family_created",
      familyId: family.id,
      memberId: organiser.id,
      props: {
        country: data.country,
        region,
        language: data.language,
        nearby_contacts: data.nearby.length,
      },
    },
    now,
  );
  return organiser.id;
}

interface Outcome {
  /** Prompts to send straight to the adapter, in order. */
  messages: OutboundMessage[];
  /** The label of the tapped button, to close the buttons with. */
  chosen?: string;
}

function prompt(event: InboundEvent, lang: Lang, body: Prompt, suffix: string): OutboundMessage {
  const conversationId = event.conversation.externalId;
  return {
    kind: "onboarding",
    idempotencyKey: outboundKey("onboarding", { conversationId, suffix }),
    lang,
    to: { channel: event.channel, conversationId },
    text: body.text,
    buttons: body.buttons,
  };
}

async function deleteSession(tx: VelaTransaction, event: InboundEvent): Promise<void> {
  await tx
    .delete(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.channel, event.channel),
        eq(onboardingSessions.conversationId, event.conversation.externalId),
      ),
    );
}

async function saveSession(
  tx: VelaTransaction,
  event: InboundEvent,
  step: OnboardingStep,
  data: SessionData,
  now: Date,
): Promise<void> {
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60_000);
  await tx
    .insert(onboardingSessions)
    .values({
      channel: event.channel,
      conversationId: event.conversation.externalId,
      externalUserId: event.sender.externalUserId,
      step,
      data,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [onboardingSessions.channel, onboardingSessions.conversationId],
      set: { externalUserId: event.sender.externalUserId, step, data, updatedAt: now, expiresAt },
    });
}

/** The session for this chat, locked for the update that follows; an expired one is gone. */
async function lockSession(
  tx: VelaTransaction,
  event: InboundEvent,
  now: Date,
): Promise<OnboardingSession | null> {
  const [session] = await tx
    .select()
    .from(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.channel, event.channel),
        eq(onboardingSessions.conversationId, event.conversation.externalId),
      ),
    )
    .for("update");
  if (session === undefined) {
    return null;
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    await deleteSession(tx, event);
    return null;
  }
  return session;
}

/** Moves the session by one input; null when there is no session for this chat to move. */
async function advance(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  input: Input,
  now: Date,
): Promise<Outcome | null> {
  const session = await lockSession(tx, event, now);
  const stored = session === null ? null : SessionData.safeParse(session.data);
  if (input.kind === "start") {
    if (stored?.success === true && stored.data.lastEventId === event.eventId) {
      return { messages: [] };
    }
    // A /start restarts: whatever was answered before is dropped with the old session.
    const lang = languageOfSender(event.sender.languageCode);
    const data: SessionData = { organiserLanguage: lang, nearby: [], lastEventId: event.eventId };
    await saveSession(tx, event, "name", data, now);
    return { messages: [prompt(event, lang, promptFor(lang, "name", data, true), event.eventId)] };
  }
  if (session === null) {
    return null;
  }
  const step = Step.safeParse(session.step);
  if (stored === null || !stored.success || !step.success) {
    deps.logger.error("onboarding_session_corrupt", { step: session.step });
    await deleteSession(tx, event);
    return null;
  }
  const data = stored.data;
  if (data.lastEventId === event.eventId) {
    return { messages: [] };
  }
  const lang = data.organiserLanguage;
  const result = applyOnboardingStep(step.data, data, input, lang);
  switch (result.kind) {
    case "repeat": {
      await saveSession(tx, event, step.data, { ...data, lastEventId: event.eventId }, now);
      const body =
        result.notice === undefined
          ? promptFor(lang, step.data, data, false)
          : { text: t(lang, result.notice) };
      return { messages: [prompt(event, lang, body, event.eventId)] };
    }
    case "next": {
      const next = { ...result.data, lastEventId: event.eventId };
      await saveSession(tx, event, result.step, next, now);
      return {
        messages: [prompt(event, lang, promptFor(lang, result.step, next, false), event.eventId)],
        chosen: result.chosen,
      };
    }
    case "complete": {
      await createFamily(deps, tx, event, result.data, now);
      await deleteSession(tx, event);
      return { messages: [], chosen: result.chosen };
    }
  }
}

/**
 * A linked person cannot onboard: the kept-light member's /start is ignored (her chat carries only
 * her mornings), and a member of a family is told the account is already connected, since a person
 * in two families is out of scope for the pilot (flows §2).
 */
async function handleLinkedSender(
  deps: Deps,
  event: InboundEvent,
  linked: MemberWithFamily,
  input: Input,
): Promise<boolean> {
  if (input.kind !== "start") {
    return false;
  }
  if (isKeptLightMember(linked.member)) {
    deps.logger.info("onboarding_ignored_kept_light_member", { familyId: linked.family.id });
    return true;
  }
  deps.logger.info("onboarding_refused_already_linked", { familyId: linked.family.id });
  const lang = linked.member.language;
  await enqueueOutbound(deps, deps.db, {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: event.conversation.externalId,
      suffix: `already_linked:${event.eventId}`,
    }),
    memberId: linked.member.id,
    channel: event.channel,
    conversationId: event.conversation.externalId,
    lang,
    text: t(lang, "consent.already_linked"),
  });
  return true;
}

/**
 * Handles one private message, tap, or /start from a person who may be onboarding. Returns true
 * when the event belonged to onboarding (a session was live or started), false when there was no
 * session to move, so the router can answer with `help.private`.
 */
export async function handleOnboarding(deps: Deps, event: InboundEvent): Promise<boolean> {
  if (event.conversation.kind !== "private") {
    return false;
  }
  const adapter = deps.channels.get(event.channel);
  const input = readInput(event);
  if (event.kind === "button") {
    await adapter.acknowledgeButton(event);
  }
  const linked = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (linked !== null) {
    return handleLinkedSender(deps, event, linked, input);
  }
  const now = deps.clock.now();
  const outcome = await deps.db.transaction((tx) => advance(deps, tx, event, input, now));
  if (outcome === null) {
    return false;
  }
  if (outcome.chosen !== undefined && event.messageId !== undefined) {
    await adapter.closeButtons(event.conversation.externalId, event.messageId, outcome.chosen);
  }
  for (const message of outcome.messages) {
    await sendOutsideGateway(deps, message);
  }
  return true;
}
