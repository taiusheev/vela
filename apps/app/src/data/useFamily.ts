import { useQuery } from "@tanstack/react-query";
import { fetchFamily, fetchMe } from "../api/client.ts";
import { useAccount } from "../auth/clerk.tsx";
import { toYouFamily, type YouFamily, youFixture } from "./family.ts";

export interface FamilyView {
  family: YouFamily;
  /** True only once the real family has arrived: until then `family` is the example one. */
  live: boolean;
  trouble: boolean;
}

/**
 * The family behind You, for the family Today shows (the first membership). It shares `["me"]`
 * with Today, so opening You costs one read, not two.
 */
export function useFamily(familyId: string | undefined, enabled: boolean): FamilyView {
  const account = useAccount();
  const me = useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => fetchMe(await account.token()),
  });
  const read = useQuery({
    queryKey: ["family", familyId],
    enabled: enabled && familyId !== undefined,
    queryFn: async () => fetchFamily(familyId ?? "", await account.token()),
  });
  return read.data === undefined
    ? { family: youFixture, live: false, trouble: read.isError }
    : { family: toYouFamily(read.data, me.data), live: true, trouble: false };
}
