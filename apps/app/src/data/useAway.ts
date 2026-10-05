import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SetAway } from "@vela/contracts";
import { endAway, setAway } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";

/**
 * Away mode (spec §8) from the app: any member sets her away or ends it; Today reads her light
 * again afterwards, where the away shows.
 */
export function useAway(familyId: string | undefined) {
  const account = useAccount();
  const queries = useQueryClient();
  const setKey = useIdempotencyKey("away");
  const endKey = useIdempotencyKey("away-end");
  const again = async () => {
    await queries.invalidateQueries({ queryKey: ["today"] });
  };
  const set = useMutation({
    mutationFn: async ({ memberId, away }: { memberId: string; away: SetAway }) =>
      setAway(familyId ?? "", memberId, away, setKey({ memberId, ...away }), await account.token()),
    onSuccess: again,
  });
  const end = useMutation({
    mutationFn: async (awayId: string) =>
      endAway(awayId, endKey({ awayId }), await account.token()),
    onSuccess: again,
  });
  return { set, end };
}
