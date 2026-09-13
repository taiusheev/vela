import type { ExchangeState } from "@vela/contracts";
import type { ExchangeEvent } from "./exchange.ts";

/**
 * An event the exchange state machine does not allow from the current state. It is a typed error
 * rather than a silent no-op because an illegal transition means two flows disagree about an
 * exchange (for example a withdrawal racing a delivery), and the caller must decide what wins.
 */
export class IllegalTransitionError extends Error {
  override readonly name = "IllegalTransitionError";
  readonly from: ExchangeState;
  readonly event: ExchangeEvent;

  constructor(from: ExchangeState, event: ExchangeEvent) {
    super(`An exchange in state "${from}" cannot take the event "${event}"`);
    this.from = from;
    this.event = event;
  }
}
