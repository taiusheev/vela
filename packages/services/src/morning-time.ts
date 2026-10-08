import type { LocalDate, LocalTime } from "@vela/contracts";
import type { Member } from "@vela/db";

/** Pending edits apply from tomorrow in the parent's zone, including DST transitions. */
export function morningTimeOn(
  member: Pick<Member, "arrivalTime" | "pendingArrivalTime" | "pendingArrivalDate">,
  date: LocalDate,
): LocalTime {
  return member.pendingArrivalTime != null &&
    member.pendingArrivalDate != null &&
    date >= member.pendingArrivalDate
    ? member.pendingArrivalTime
    : member.arrivalTime;
}
