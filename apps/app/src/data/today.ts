import type { LightState } from "../components/light.tsx";

/**
 * What Today needs (spec §14.1 A6). The API has no `/v1/families/:id/today` yet (API contract §4),
 * so the screen reads these fixtures; the shapes are what that route will answer with.
 */

export interface TodayLight {
  memberId: string;
  displayName: string;
  state: LightState;
  /** The state line under the name: "answered 8:12", "quiet", "away · Sunday", "resting". */
  stateText: string;
}

export interface TodayReply {
  from: string;
  /** Words, never counts: the family hears substance, not a number. */
  text: string;
}

export interface TodayExchange {
  asker: string;
  recipient: string;
  ask: string;
  answer?: { text: string; at: string };
  replies: TodayReply[];
  /** "Mom saw it · 8:12", shown only once she has. */
  receipt?: string;
}

export interface TomorrowTurn {
  name: string;
  suggestion: string;
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
    suggestion: "Ask her about the seeds she saved from last year",
  },
};
