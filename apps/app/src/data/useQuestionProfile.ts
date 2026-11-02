import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiQuestionProfile,
  QUESTION_PROFILE_NOTICE_VERSION,
  type QuestionProfileSettings,
} from "@vela/contracts";
import { useEffect, useRef, useState } from "react";
import { fetchQuestionProfile, forgetQuestionProfile, saveQuestionProfile } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { sessionScope } from "./live-state.ts";

/** The only cached copy is scoped to account/session/pair and discarded when the screen closes. */
export function useQuestionProfile(
  familyId: string | undefined,
  recipientId: string,
  enabled: boolean,
) {
  const account = useAccount();
  const queries = useQueryClient();
  const scope = sessionScope(account);
  const queryKey = ["question-profile", scope, familyId, recipientId];
  const saveKey = useIdempotencyKey("question-profile-save");
  const forgetKey = useIdempotencyKey("question-profile-forget");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const read = useQuery({
    queryKey,
    enabled: enabled && account.signedIn && familyId !== undefined,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      ApiQuestionProfile.parse(
        await fetchQuestionProfile(familyId ?? "", recipientId, await account.token()),
      ),
  });
  async function reload() {
    const result = await read.refetch();
    if (result.error || !result.data)
      throw result.error ?? new Error("Question profile unavailable");
    return result.data;
  }
  return {
    ...read,
    busy,
    reload,
    save: async (settings: QuestionProfileSettings, revision: string | null) => {
      setBusy(true);
      try {
        const input = {
          settings,
          expected_revision: revision,
          notice_version: QUESTION_PROFILE_NOTICE_VERSION as typeof QUESTION_PROFILE_NOTICE_VERSION,
        };
        await saveQuestionProfile(
          familyId ?? "",
          recipientId,
          saveKey(input),
          input,
          await account.token(),
        );
        // A replay can acknowledge an earlier save after forgetting. Always reload current content.
        return await reload();
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    forget: async () => {
      setBusy(true);
      try {
        await forgetQuestionProfile(
          familyId ?? "",
          recipientId,
          forgetKey({ revision: read.data?.revision }),
          await account.token(),
        );
        queries.setQueryData(queryKey, { revision: null, profile: null, saving_available: false });
        return await reload().catch(() => ({
          revision: null,
          profile: null,
          saving_available: false,
        }));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    clearLocal: () =>
      queries.setQueryData(queryKey, { revision: null, profile: null, saving_available: false }),
  };
}
