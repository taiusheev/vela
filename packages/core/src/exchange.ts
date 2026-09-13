/**
 * The exchange state machine (spec §3, code design §5). One table decides every transition, so the
 * services never compare states by hand.
 *
 * Late events keep the state instead of failing: a "seen" receipt can arrive after the answer, a
 * second answer or reply after the read-back, so those events are accepted and change nothing.
 * Withdrawal is possible only before delivery (spec §19), and a withdrawn exchange takes no event
 * but a repeated withdrawal.
 */
import type { ExchangeState } from "@vela/contracts";
import { IllegalTransitionError } from "./errors.ts";

export const EXCHANGE_EVENTS = [
  "schedule",
  "deliver",
  "see",
  "answer",
  "reply",
  "read_back",
  "archive",
  "withdraw",
] as const;
export type ExchangeEvent = (typeof EXCHANGE_EVENTS)[number];

const TRANSITIONS: Readonly<
  Record<ExchangeState, Readonly<Partial<Record<ExchangeEvent, ExchangeState>>>>
> = {
  composed: { schedule: "scheduled", withdraw: "withdrawn" },
  scheduled: { schedule: "scheduled", deliver: "delivered", withdraw: "withdrawn" },
  delivered: { deliver: "delivered", see: "seen", answer: "answered", archive: "archived" },
  seen: { see: "seen", answer: "answered", archive: "archived" },
  answered: {
    see: "answered",
    answer: "answered",
    reply: "replied",
    read_back: "read_back",
    archive: "archived",
  },
  replied: {
    see: "replied",
    answer: "replied",
    reply: "replied",
    read_back: "read_back",
    archive: "archived",
  },
  read_back: {
    see: "read_back",
    answer: "read_back",
    reply: "read_back",
    read_back: "read_back",
    archive: "archived",
  },
  archived: {
    see: "archived",
    answer: "archived",
    reply: "archived",
    read_back: "archived",
    archive: "archived",
  },
  withdrawn: { withdraw: "withdrawn" },
};

function targetOf(state: ExchangeState, event: ExchangeEvent): ExchangeState | undefined {
  // Own-property lookups, so a state or event read from an unchecked row that happens to name an
  // Object.prototype member is illegal instead of resolving to a prototype function.
  if (!Object.hasOwn(TRANSITIONS, state)) {
    return undefined;
  }
  const row = TRANSITIONS[state];
  return Object.hasOwn(row, event) ? row[event] : undefined;
}

/** The state after `event`; throws `IllegalTransitionError` when the table forbids it. */
export function nextExchangeState(state: ExchangeState, event: ExchangeEvent): ExchangeState {
  const next = targetOf(state, event);
  if (next === undefined) {
    throw new IllegalTransitionError(state, event);
  }
  return next;
}

export function canApply(state: ExchangeState, event: ExchangeEvent): boolean {
  return targetOf(state, event) !== undefined;
}
