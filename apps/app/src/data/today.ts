import type { LightState } from "../components/light.tsx";

/**
 * What Today needs (spec §14.1 A6), in the screen's own idiom: times already read as times, words
 * already chosen for a tap that carried none. `GET /v1/families/:id/today` answers it in the wire's
 * shape (API contract §4); `useToday` turns one into the other, and these fixtures stand in when
 * the app has no API to talk to.
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
  /** Words, never counts: the family hears substance, not a number. */
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

export const todayFixture: Today = {
  lights: [
    { memberId: "m1", displayName: "Mom", state: "lit", stateText: "answered 8:12" },
    { memberId: "m2", displayName: "Dad", state: "resting", stateText: "resting" },
  ],
  exchange: {
    asker: "Mia",
    recipient: "Mom",
    ask: "What did the garden look like this morning?",
    answer: {
      text: "The tomatoes finally turned. I picked three before breakfast and left them on the sill.",
      at: "8:12",
    },
    replies: [
      { from: "Mia", text: "sent a heart" },
      { from: "Anna", text: "Those are the ones from the seeds you saved" },
    ],
    receipt: "Mom saw it · 8:12",
  },
  tomorrow: {
    name: "Anna",
    mine: false,
    suggestion: "Ask her about the seeds she saved from last year",
  },
};
