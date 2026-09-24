/**
 * What an invitation is made of, the same whether onboarding creates the first one (flows §3.1) or
 * the founder's `create_invite` makes a new one after a No or an invite nobody answered (§3.17): the
 * invited kept-light member's profile, her arrival time from her wake time, and a single-use link
 * that is good for a week.
 */
import type { Lang, LocalTime } from "@vela/contracts";
import { type Invite, invites, type Member, members, type VelaTransaction } from "@vela/db";
import type { Deps } from "./deps.ts";

/** An invite link is good for a week (flows §3.1). */
export const INVITE_DAYS = 7;
/** Her arrival comes half an hour after she usually wakes (flows §3.1). */
export const ARRIVAL_AFTER_WAKE_MINUTES = 30;
/** What the family calls her, as onboarding's name step takes it. */
export const NAME_MAX_LENGTH = 40;
/** How Vela greets her, as onboarding's address step takes it. */
export const ADDRESS_MAX_LENGTH = 60;

const MINUTES_PER_DAY = 24 * 60;

/** `HH:MM` plus minutes, wrapping at midnight. */
export function addMinutesToLocalTime(time: LocalTime, minutes: number): LocalTime {
  const [hourText, minuteText] = time.split(":");
  const total = (Number(hourText) * 60 + Number(minuteText) + minutes) % MINUTES_PER_DAY;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export interface InvitedMemberProfile {
  familyId: string;
  name: string;
  address: string;
  language: Lang;
  timeZone: string;
  country: string;
  wakeTime: LocalTime;
}

/**
 * The kept-light member before her answer: invited, out of the turn rotation, light off, reached on
 * Telegram, arriving half an hour after she wakes.
 */
export async function insertInvitedMember(
  tx: VelaTransaction,
  profile: InvitedMemberProfile,
  now: Date,
): Promise<Member> {
  const [member] = await tx
    .insert(members)
    .values({
      familyId: profile.familyId,
      role: "member",
      displayName: profile.name,
      addressForm: profile.address,
      language: profile.language,
      tz: profile.timeZone,
      country: profile.country,
      status: "invited",
      turnsIn: false,
      primarySurface: "telegram",
      lightOn: false,
      wakeTime: profile.wakeTime,
      arrivalTime: addMinutesToLocalTime(profile.wakeTime, ARRIVAL_AFTER_WAKE_MINUTES),
      createdAt: now,
    })
    .returning();
  if (member === undefined) {
    throw new Error("kept-light member insert returned no row");
  }
  return member;
}

/**
 * What making an invite needs: a token and the bot the link opens. Narrower than `Deps`, so the
 * API can make one without the pilot Worker's ports.
 */
export interface InviteDeps {
  random: Deps["random"];
  config: Pick<Deps["config"], "telegramBotUsername">;
}

/**
 * A single-use invite for the member, from a fresh token, with the link to send her: the token is
 * never logged, and reaches only the organiser's own chat.
 */
export async function insertInvite(
  deps: InviteDeps,
  tx: VelaTransaction,
  input: { familyId: string; invitedBy: string; forMemberId: string },
  now: Date,
): Promise<{ invite: Invite; link: string }> {
  const token = deps.random.token();
  const [invite] = await tx
    .insert(invites)
    .values({
      familyId: input.familyId,
      invitedBy: input.invitedBy,
      forMemberId: input.forMemberId,
      token,
      channel: "link",
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITE_DAYS * MINUTES_PER_DAY * 60_000),
    })
    .returning();
  if (invite === undefined) {
    throw new Error("invite insert returned no row");
  }
  return { invite, link: `https://t.me/${deps.config.telegramBotUsername}?start=${token}` };
}
