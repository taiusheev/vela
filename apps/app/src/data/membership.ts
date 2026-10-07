import type { ApiMe } from "@vela/contracts";

export type Membership = ApiMe["memberships"][number];

/** A removed membership cannot be kept open by a remembered selection. */
export function selectedMembership(
  memberships: readonly Membership[],
  familyId: string | undefined,
): Membership | undefined {
  return memberships.find((membership) => membership.family.id === familyId) ?? memberships[0];
}
