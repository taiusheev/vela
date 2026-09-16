/**
 * The append-only event log (spec §18). Every event is validated against the contract before it is
 * written, so a name outside `EVENT_NAMES` or a property carrying content fails here rather than at
 * the database's CHECK, and the same call works inside a caller's transaction.
 */
import { DomainEvent } from "@vela/contracts";
import { events, type VelaDatabase, type VelaTransaction } from "@vela/db";

export async function recordEvent(
  db: VelaDatabase | VelaTransaction,
  event: DomainEvent,
  at: Date,
): Promise<void> {
  const parsed = DomainEvent.parse(event);
  await db.insert(events).values({
    at,
    name: parsed.name,
    familyId: parsed.familyId ?? null,
    memberId: parsed.memberId ?? null,
    exchangeId: parsed.exchangeId ?? null,
    surface: parsed.surface ?? null,
    props: parsed.props,
  });
}
