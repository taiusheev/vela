import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import type {
  ApiToday,
  ApiTodayAnswer,
  ApiTodayExchange,
  ApiTomorrowTurn,
  MemberLight,
} from "@vela/contracts";
import { useCallback } from "react";
import { ApiError, apiConfigured, fetchMe, fetchToday } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import type { LightState } from "../components/light.tsx";
import { dayName, timeOfDay } from "./format.ts";
import { replyLine } from "./lines.ts";
import { demoDataAllowed } from "./live-state.ts";
import {
  type Today,
  type TodayExchange,
  type TodayLight,
  type TomorrowTurn,
  todayFixture,
} from "./today.ts";

// Kept as an export here, where Ask and Exchanges already take it from.
export { dayName };

/** The line under each name: "answered 8:12" · "quiet" · "away · Sunday" · "resting" (spec A6). */
export function stateText(light: MemberLight): string {
  switch (light.state) {
    case "lit": {
      if (light.answered_at === null) return t`answered`;
      const time = timeOfDay(light.answered_at, light.tz);
      return t`answered ${time}`;
    }
    case "quiet":
      return t`quiet`;
    case "away": {
      if (light.away_until === null) return t`away`;
      const day = dayName(light.away_until);
      return t`away · ${day}`;
    }
    case "paused":
      return t`paused`;
    case "none":
      return t`waiting for her yes`;
    default:
      return t`resting`;
  }
}

export function toTodayLight(light: MemberLight): TodayLight {
  // `none` is a light that does not exist yet: drawn resting, and marked so nobody asks her early.
  const invited = light.state === "none";
  return {
    memberId: light.member_id,
    displayName: light.display_name,
    ...(light.tz === undefined ? {} : { timeZone: light.tz }),
    ...(light.local_date === undefined ? {} : { localDate: light.local_date }),
    state: invited ? "resting" : (light.state as LightState),
    stateText: stateText(light),
    ...(invited ? { invited: true } : {}),
    ...(light.quiet_event_id === null ? {} : { quietEventId: light.quiet_event_id }),
    ...(light.away_id == null ? {} : { awayId: light.away_id }),
    ...(light.unreachable_on == null ? {} : { unreachableOn: messengerName(light.unreachable_on) }),
    ...(light.away_id == null || light.away_until === null
      ? {}
      : { awayUntil: dayName(light.away_until) }),
  };
}

/** What an answer that carried no words was: a tap is still something she said. */
function wordlessAnswer(answer: ApiTodayAnswer): string {
  switch (answer.kind) {
    case "heart":
      return t`sent a heart`;
    case "fine":
      return t`said she is fine`;
    case "photo":
      return t`sent a photo`;
    case "photo_pick": {
      // By the number her buttons showed, which still says which one once the photo is deleted.
      const number = answer.picked_number;
      return number === null ? t`picked a photo` : t`picked photo ${number}`;
    }
    case "sticker":
      return t`sent a sticker`;
    case "voice":
      return t`sent a voice message`;
    case "vote":
      return t`voted`;
    case "chip":
      return t`tapped an answer`;
    default:
      return t`answered`;
  }
}

/** "Mom saw it · 8:12", once she has. */
function receiptOf(exchange: ApiTodayExchange, timeZone?: string): string | undefined {
  if (exchange.seen_at === null) return undefined;
  const recipient = exchange.recipient_name;
  const time = timeOfDay(exchange.seen_at, timeZone);
  return t`${recipient} saw it · ${time}`;
}

export function toTodayExchange(exchange: ApiTodayExchange, timeZone?: string): TodayExchange {
  const recipientZone = exchange.recipient_tz ?? timeZone;
  const answer = exchange.answer;
  // Her words in the reader's language when the family's translation is in it (flows §3.10); her
  // own words stay as the original, which Exchanges offers.
  const translated =
    answer?.translation != null && answer.text !== null && answer.translation.lang === i18n.locale
      ? answer.translation.text
      : undefined;
  const receipt = receiptOf(exchange, recipientZone);
  return {
    id: exchange.id,
    recipientId: exchange.recipient_id,
    ...(exchange.asker_name === null ? {} : { asker: exchange.asker_name }),
    recipient: exchange.recipient_name,
    ...(exchange.voice_hello == null ? {} : { voiceHello: exchange.voice_hello }),
    ...(exchange.ask === null ? {} : { ask: exchange.ask }),
    ...(answer === null
      ? {}
      : {
          answer: {
            text: translated ?? answer.text ?? wordlessAnswer(answer),
            at: timeOfDay(answer.at, recipientZone),
            ...(answer.audio == null ? {} : { audio: answer.audio }),
            ...(answer.photo == null ? {} : { photo: answer.photo }),
            ...(translated === undefined || answer.text === null ? {} : { original: answer.text }),
          },
        }),
    replies: exchange.replies.map((reply) => ({
      from: reply.from,
      text: replyLine(reply.from, reply.kind, reply.text),
      ...(reply.photo == null ? {} : { photo: reply.photo }),
      ...(reply.audio == null ? {} : { audio: reply.audio }),
    })),
    ...(receipt === undefined ? {} : { receipt }),
    ...(exchange.photos.length === 0
      ? {}
      : {
          photos: exchange.photos.map((photo) => ({
            id: photo.id,
            width: photo.width,
            height: photo.height,
            stored: photo.stored,
            ...(photo.expires_at === undefined ? {} : { expires_at: photo.expires_at }),
          })),
        }),
    ...(answer?.picked_media_id == null ? {} : { picked: answer.picked_media_id }),
  };
}

export function toTomorrowTurn(turn: ApiTomorrowTurn, viewerMemberId?: string): TomorrowTurn {
  const ask = turn.ask;
  const words = ask?.text?.trim() ?? "";
  const suggestion = turn.suggestion;
  return {
    recipientId: turn.recipient_id,
    recipient: turn.recipient_name,
    name: turn.holder_name ?? t`Anyone`,
    mine: turn.holder_id !== null && turn.holder_id === viewerMemberId,
    pending: turn.turn_pending,
    ...(ask === null || words.length === 0
      ? {}
      : {
          asked: {
            by: ask.on_behalf_of ?? ask.asker_name ?? "Vela",
            text: words,
            ...(ask.withdrawable === true ? { withdrawableId: ask.id } : {}),
          },
        }),
    ...(suggestion === null
      ? {}
      : {
          suggestion: {
            id: suggestion.id,
            text: suggestion.text,
            type: suggestion.type,
            fromHerWords: suggestion.from_her_words,
          },
        }),
  };
}

/**
 * What Today says under an ask that has no answer yet. Her day can be answered by words to an
 * earlier ask (flows §3.9): her tap today on yesterday's arrival, or a message before today's,
 * which attaches to the one before. Her light then reads "answered 14:32", so saying she sent no
 * word today would be false; the line says where her answer went instead.
 */
function unansweredLine(exchange: ApiTodayExchange, light: MemberLight | undefined): string {
  if (light === undefined || light.answered_at === null) return t`No word yet today.`;
  const recipient = exchange.recipient_name;
  const time = timeOfDay(light.answered_at, light.tz);
  return t`${recipient} answered an earlier ask at ${time}. This one has no answer yet.`;
}

export function toToday(day: ApiToday, viewerMemberId?: string): Today {
  return {
    lights: day.lights.map(toTodayLight),
    exchanges: day.exchanges.map((exchange) => {
      const light = day.lights.find((row) => row.member_id === exchange.recipient_id);
      return {
        ...toTodayExchange(exchange, light?.tz),
        ...(exchange.answer === null ? { unanswered: unansweredLine(exchange, light) } : {}),
      };
    }),
    tomorrow: day.tomorrow.map((turn) => toTomorrowTurn(turn, viewerMemberId)),
  };
}

export interface TodayView {
  today: Today;
  /** The family the screens are showing, once the API has said which; Ask writes to it. */
  familyId?: string;
  /** True while the real day is on its way; live screens show a loading state. */
  loading: boolean;
  /** Set when the API is configured but would not answer, so the screen can say so plainly. */
  trouble: boolean;
  /** Signed in, but the API knows no account here yet: a first run, not a failure. */
  noAccount: boolean;
  /** Signed in with an account that belongs to no family yet: onboarding's turn (spec A1). */
  noFamily: boolean;
  /** The reader organises this family, so the quiet notice is for them (spec A11). */
  organiser: boolean;
  /** True only once the real day has arrived; pending live data is empty. */
  live: boolean;
  /**
   * Whether photo asks can be sent: the API keeps photos (`ApiMe.photos`, ADR-33), or there is no
   * API and the example day shows the photos chosen without sending them anywhere.
   */
  photos: boolean;
  updatedAt: number;
  refresh(): void;
  /**
   * Whether the API sends pushes (`ApiMe.push`, ADR-34). While it does not, nothing offers
   * notifications in passing, since none would come; You still shows this phone's state.
   */
  pushSent: boolean;
}

/**
 * Today reads the API when the app is pointed at one and someone is signed in, and its fixtures
 * otherwise. The first membership is the family shown; a second one waits for the family switcher.
 */
export function useToday(): TodayView {
  // Read so a change of language renders Today again with its lines in the new one.
  useLingui();
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
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });

  const refetchMe = me.refetch;
  const refetchDay = day.refetch;
  const refresh = useCallback(() => {
    if (!enabled) return;
    void refetchMe();
    if (familyId !== undefined) void refetchDay();
  }, [enabled, familyId, refetchMe, refetchDay]);

  if (!enabled) {
    return {
      today: demoDataAllowed(apiConfigured(), accountsConfigured())
        ? todayFixture()
        : { lights: [], exchanges: [], tomorrow: [] },
      loading: false,
      trouble: false,
      noAccount: false,
      noFamily: false,
      organiser: true,
      live: false,
      photos: demoDataAllowed(apiConfigured(), accountsConfigured()),
      updatedAt: 0,
      refresh,
      pushSent: false,
    };
  }
  const live = enabled && day.data !== undefined;
  // A 404 from /v1/me is the ordinary first run: the account signed in before anything was set up.
  const noAccount = me.error instanceof ApiError && me.error.status === 404;
  return {
    today: live
      ? toToday(day.data, membership?.member_id)
      : { lights: [], exchanges: [], tomorrow: [] },
    ...(familyId === undefined ? {} : { familyId }),
    loading: me.isPending || (familyId !== undefined && day.isPending),
    updatedAt: day.dataUpdatedAt,
    refresh,
    trouble: (me.isError && !noAccount) || day.isError,
    noAccount,
    noFamily: me.data !== undefined && me.data.memberships.length === 0,
    organiser: membership?.role === "organiser",
    live,
    photos: me.data?.photos === true,
    pushSent: me.data?.push === true,
  };
}

/** Each messenger's own name, the same in every language: a brand, never translated. */
const MESSENGER_NAMES: Readonly<Record<string, string>> = {
  telegram: "Telegram",
  line: "LINE",
  whatsapp: "WhatsApp",
};

function messengerName(channel: string): string {
  return MESSENGER_NAMES[channel] ?? channel;
}
