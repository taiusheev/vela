import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "../auth/clerk.tsx";
import { devicePrivateStore } from "../storage/drafts.ts";
import { callingNumber } from "./calling-number.ts";
import { sessionScope } from "./live-state.ts";

export function useCallingNumber(familyId: string | undefined, memberId: string | undefined) {
  const account = useAccount();
  const queries = useQueryClient();
  const scope = sessionScope(account);
  const name = `call.${familyId ?? ""}.${memberId ?? ""}`;
  const queryKey = ["calling-number", scope, familyId, memberId];
  const enabled = familyId !== undefined && memberId !== undefined && account.signedIn;
  const read = useQuery({
    queryKey,
    enabled,
    queryFn: async () => {
      const value = await devicePrivateStore.read(scope, name);
      return value === null ? null : callingNumber(value);
    },
  });
  const save = useMutation({
    mutationFn: async (number: string) => devicePrivateStore.write(scope, name, number),
    onSuccess: (_result, number) => queries.setQueryData(queryKey, number),
  });
  const remove = useMutation({
    mutationFn: async () => devicePrivateStore.remove(scope, name),
    onSuccess: () => queries.setQueryData(queryKey, null),
  });
  return {
    number: enabled ? (read.data ?? null) : null,
    ready: !enabled || !read.isPending,
    failed: read.isError || save.isError || remove.isError,
    saving: save.isPending || remove.isPending,
    save: async (input: string, permitted: boolean): Promise<boolean> => {
      const valid = callingNumber(input);
      if (!permitted || valid === null || !enabled) return false;
      try {
        await save.mutateAsync(valid);
        return true;
      } catch {
        return false;
      }
    },
    remove: async () => {
      try {
        await remove.mutateAsync();
      } catch {
        /* Shown by the editor. */
      }
    },
  };
}
