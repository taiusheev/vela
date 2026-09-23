import { useQuery } from "@tanstack/react-query";
import type { ApiToday, ApiTodayExchange, ApiTomorrowTurn, MemberLight } from "@vela/contracts";
import { apiConfigured, fetchMe, fetchToday } from "../api/client.ts";
import { useAccount } from "../auth/clerk.tsx";
import type { LightState } from "../components/light.tsx";
import {
  type Today,
  type TodayExchange,
  type TodayLight,
  type TomorrowTurn,
  todayFixture,
} from "./today.ts";

function timeOfDay(instant: string): string {
  const at = new Date(instant);
  return Number.isFinite(at.getTime())
    ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
}

function dayName(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(day.getTime())
    ? day.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" })
    : date;
}

/** The line under each name: "answered 8:12" · "quiet" · "away · Sunday" · "resting" (spec A6). */
export function stateText(light: MemberLight): string {
  switch (light.state) {
    case "lit":
      return light.answered_at === null ? "answered" : `answered ${timeOfDay(light.answered_at)}`;
    case "quiet":
      return "quiet";
    case "away":
      return light.away_until === null ? "away" : `away · ${dayName(light.away_until)}`;
    case "paused":
      return "paused";
    default:
      return "resting";
  }
}

export function toTodayLight(light: MemberLight): TodayLight {
  return {
    memberId: light.member_id,
    displayName: light.display_name,
    state: light.state as LightState,
    stateText: stateText(light),
  };
}

/** What an answer that carried no words was: a tap is still something she said. */
function wordlessAnswer(kind: string): string {
  switch (kind) {
    case "heart":
      return "sent a heart";
    case "fine":
      return "said she is fine";
    case "photo":
      return "sent a photo";
    case "photo_pick":
      return "picked a photo";
    case "sticker":
      return "sent a sticker";
    case "voice":
      return "sent a voice message";
    case "vote":
      return "voted";
    case "chip":
      return "tapped an answer";
    default:
      return "answered";
  }
}

/** The same for a reply: reactions are read as what they are, words as themselves. */
function replyWords(kind: string, text: string | null): string {
  if (text !== null && text.trim().length > 0) return text;
  switch (kind) {
    case "heart":
      return "sent a heart";
    case "laugh":
      return "laughed";
    case "hug":
      return "sent a hug";
    case "voice":
      return "sent a voice message";
    case "photo":
      return "sent a photo";
    default:
      return "replied";
  }
}

export function toTodayExchange(exchange: ApiTodayExchange): TodayExchange {
  const answer = exchange.answer;
  return {
    ...(exchange.asker_name === null ? {} : { asker: exchange.asker_name }),
    recipient: exchange.recipient_name,
    ...(exchange.ask === null ? {} : { ask: exchange.ask }),
    ...(answer === null
      ? {}
      : {
          answer: {
            text: answer.text ?? wordlessAnswer(answer.kind),
            at: timeOfDay(answer.at),
          },
        }),
    replies: exchange.replies.map((reply) => ({
      from: reply.from,
      text: replyWords(reply.kind, reply.text),
    })),
    ...(exchange.seen_at === null
      ? {}
      : { receipt: `${exchange.recipient_name} saw it · ${timeOfDay(exchange.seen_at)}` }),
  };
}

export function toTomorrowTurn(turn: ApiTomorrowTurn, viewerMemberId?: string): TomorrowTurn {
  return {
    name: turn.holder_name ?? "Anyone",
    mine: turn.holder_id !== null && turn.holder_id === viewerMemberId,
    ...(turn.suggestion === null ? {} : { suggestion: turn.suggestion.text }),
  };
}

export function toToday(day: ApiToday, viewerMemberId?: string): Today {
  const exchange = day.exchanges[0];
  const tomorrow = day.tomorrow[0];
  return {
    lights: day.lights.map(toTodayLight),
    ...(exchange === undefined ? {} : { exchange: toTodayExchange(exchange) }),
    ...(tomorrow === undefined ? {} : { tomorrow: toTomorrowTurn(tomorrow, viewerMemberId) }),
  };
}

export interface TodayView {
  today: Today;
  /** True while the real day is on its way; the fixtures show in the meantime. */
  loading: boolean;
  /** Set when the API is configured but would not answer, so the screen can say so plainly. */
  trouble: boolean;
  live: boolean;
}

/**
 * Today reads the API when the app is pointed at one and someone is signed in, and its fixtures
 * otherwise. The first membership is the family shown; a second one waits for the family switcher.
 */
export function useToday(): TodayView {
  const account = useAccount();
  const enabled = apiConfigured() && account.ready && account.signedIn;

  const me = useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => fetchMe(await account.token()),
  });
  const membership = me.data?.memberships[0];
  const familyId = membership?.family.id;

  const day = useQuery({
    queryKey: ["today", familyId],
    enabled: enabled && familyId !== undefined,
    queryFn: async () => fetchToday(familyId ?? "", await account.token()),
  });

  if (!enabled) return { today: todayFixture, loading: false, trouble: false, live: false };
  const live = day.data !== undefined;
  return {
    today: live ? toToday(day.data, membership?.member_id) : todayFixture,
    loading: me.isPending || day.isPending,
    trouble: me.isError || day.isError,
    live,
  };
}
