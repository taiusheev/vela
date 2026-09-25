import { t } from "@lingui/core/macro";
import type { LightState } from "../components/light.tsx";
import { clockTime } from "./format.ts";
import { reactionLine, replyLine } from "./lines.ts";

/**
 * What Today needs (spec §14.1 A6), in the screen's own idiom and the app's language: times already
 * read as times, words already chosen for a tap that carried none. `GET /v1/families/:id/today`
 * answers it in the wire's shape (API contract §4); `useToday` turns one into the other, and these
 * fixtures stand in when the app has no API to talk to.
 */

export interface TodayLight {
  memberId: string;
  displayName: string;
  state: LightState;
  /** The state line under the name: "answered 8:12", "quiet", "away · Sunday", "resting". */
  stateText: string;
  /** Invited and not yet answered: shown, but nobody may ask her anything until she says yes. */
  invited?: boolean;
  /** The open quiet event behind a quiet light, which the sheet reads and settles. */
  quietEventId?: string;
}

export interface TodayReply {
  from: string;
  /**
   * The whole line, with the name inside it: "Anna: Those are…", "Mia sent a heart". Words, never
   * counts: the family hears substance, not a number.
   */
  text: string;
}

export interface TodayExchange {
  /** Undefined for Vela's own hello, and for an ask whose asker has since been deleted. */
  asker?: string;
  recipient: string;
  /** A hello carries no question. */
  ask?: string;
  answer?: { text: string; at: string };
  replies: TodayReply[];
  /** "Mom saw it · 8:12", shown only once she has. */
  receipt?: string;
}

export interface TomorrowTurn {
  name: string;
  /** True when the turn is the reader’s own, so the card says so instead of naming them. */
  mine: boolean;
  /** Set once that morning is claimed: who asked, and what. A claimed morning has no suggestion. */
  asked?: { by: string; text: string };
  suggestion?: string;
}

export interface Today {
  lights: TodayLight[];
  exchange?: TodayExchange;
  tomorrow?: TomorrowTurn;
}

/**
 * The example day, in the language active when it is read. Its state line and receipt are the
 * messages `useToday` builds for a real day, so both read alike.
 */
export function todayFixture(): Today {
  const recipient = t`Mom`;
  const time = clockTime(8, 12);
  return {
    lights: [
      { memberId: "m1", displayName: recipient, state: "lit", stateText: t`answered ${time}` },
      { memberId: "m2", displayName: t`Dad`, state: "resting", stateText: t`resting` },
    ],
    exchange: {
      asker: "Mia",
      recipient,
      ask: t`What did the garden look like this morning?`,
      answer: {
        text: t`The tomatoes finally turned. I picked three before breakfast and left them on the sill.`,
        at: time,
      },
      replies: [
        { from: "Mia", text: reactionLine("Mia", "heart") },
        {
          from: "Anna",
          text: replyLine("Anna", "text", t`Those are the ones from the seeds you saved`),
        },
      ],
      receipt: t`${recipient} saw it · ${time}`,
    },
    tomorrow: {
      name: "Anna",
      mine: false,
      suggestion: t`Ask her about the seeds she saved from last year`,
    },
  };
}
