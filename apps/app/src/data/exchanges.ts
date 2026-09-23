/**
 * What the Exchanges list and one exchange need (spec §14.1 A8). The API has no exchange routes
 * yet (API contract §4), so these fixtures carry the shapes those routes will answer with.
 */

export type ReactionKind = "heart" | "laugh" | "hug";

export interface ExchangeReply {
  id: string;
  from: string;
  /** A reaction or words; the parent hears the substance, never a count. */
  reaction?: ReactionKind;
  text?: string;
}

export interface ExchangeAnswer {
  text: string;
  at: string;
  /** Her own words before translation, shown by the language switch. */
  original?: string;
  transcript?: boolean;
}

export interface Exchange {
  id: string;
  asker: string;
  recipient: string;
  ask: string;
  askOriginal?: string;
  day: string;
  answer?: ExchangeAnswer;
  replies: ExchangeReply[];
  receipt?: string;
}

export const exchangesFixture: Exchange[] = [
  {
    id: "x1",
    asker: "Mia",
    recipient: "Mom",
    ask: "What did the garden look like this morning?",
    day: "Today",
    answer: {
      text: "The tomatoes finally turned. I picked three before breakfast and left them on the sill.",
      at: "8:12",
      original: "Помидоры наконец покраснели. Сняла три до завтрака, оставила на подоконнике.",
    },
    replies: [
      { id: "r1", from: "Mia", reaction: "heart" },
      { id: "r2", from: "Anna", text: "Those are the ones from the seeds you saved" },
    ],
    receipt: "Mom saw it · 8:12",
  },
  {
    id: "x2",
    asker: "Anna",
    recipient: "Mom",
    ask: "Which one of us did you teach to make the pies?",
    day: "Yesterday",
    answer: {
      text: "Both of you, but only Mia listened about the butter.",
      at: "9:05",
      transcript: true,
    },
    replies: [
      { id: "r3", from: "Mia", reaction: "laugh" },
      { id: "r4", from: "Anna", text: "She is never letting that go" },
    ],
    receipt: "Mom saw it · 9:05",
  },
  {
    id: "x3",
    asker: "Mia",
    recipient: "Mom",
    ask: "A photo of the street where you grew up — do you remember the shop on the corner?",
    day: "Sunday",
    answer: {
      text: "It was a bakery, then a bookshop. We queued there for bread in the winter.",
      at: "8:40",
    },
    replies: [{ id: "r5", from: "Anna", reaction: "hug" }],
    receipt: "Mom saw it · 8:41",
  },
];

export function findExchange(id: string): Exchange | undefined {
  return exchangesFixture.find((exchange) => exchange.id === id);
}
