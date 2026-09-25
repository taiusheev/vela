import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchFamily,
  fetchMe,
  leaveFamily,
  memberChangeRefusal,
  pauseSelf,
} from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { toYouFamily, type YouFamily, youFixture } from "./family.ts";

export interface FamilyView {
  family: YouFamily;
  /** True only once the real family has arrived: until then `family` is the example one. */
  live: boolean;
  trouble: boolean;
  /** Pause or resume oneself; the example family answers at once, with nothing sent. */
  setPaused(paused: boolean): void;
  /** Leave the family; `onLeft` runs once the membership is closed. */
  leave(onLeft: () => void): void;
  changing: boolean;
  /** Why the last pause or leave did not happen, in words for the screen. */
  refused?: string;
}

function refusedLine(error: unknown): string | undefined {
  const reason = memberChangeRefusal(error);
  if (reason === "last_organiser") {
    return t`You are the only organiser who is active, and an organiser who is away is not told if it goes quiet. Someone else who organises the family has to be active first.`;
  }
  if (reason === "kept_light")
    return t`Your light is paused from your own chat, where your mornings arrive.`;
  return error === null ? undefined : t`That did not go through. Try again in a moment.`;
}

/** The example family, paused or not as the reader last chose; nothing is sent for it. */
function exampleFamily(paused: boolean): YouFamily {
  const example = youFixture();
  return { ...example, me: { ...example.me, paused } };
}

/**
 * The family behind You, for the family Today shows (the first membership). It shares `["me"]`
 * with Today, so opening You costs one read, not two. Pausing and leaving read everything again,
 * since both change what Today and the tabs show.
 */
export function useFamily(familyId: string | undefined, enabled: boolean): FamilyView {
  // Its lines are built in the app's language, so a change of language builds them again.
  useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const pauseKey = useIdempotencyKey("pause");
  const leaveKey = useIdempotencyKey("leave");
  const [examplePaused, setExamplePaused] = useState(false);
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
  const live = read.data !== undefined;
  const family = live ? toYouFamily(read.data, me.data) : exampleFamily(examplePaused);

  const pause = useMutation({
    mutationFn: async (paused: boolean) =>
      pauseSelf(
        family.familyId,
        family.me.memberId,
        paused,
        pauseKey({ member: family.me.memberId, paused }),
        await account.token(),
      ),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["family"] });
      await queries.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const leave = useMutation({
    mutationFn: async () =>
      leaveFamily(
        family.familyId,
        family.me.memberId,
        leaveKey({ member: family.me.memberId }),
        await account.token(),
      ),
  });

  const failure = pause.error ?? leave.error;
  const refused = refusedLine(failure);
  return {
    family,
    live,
    trouble: read.isError,
    setPaused: (paused) => {
      if (!live) setExamplePaused(paused);
      else pause.mutate(paused);
    },
    leave: (onLeft) => {
      if (!live) return;
      leave.mutate(undefined, {
        onSuccess: async () => {
          // Nothing of this family is the reader's any more: every cached read goes with it.
          queries.clear();
          onLeft();
        },
      });
    },
    changing: pause.isPending || leave.isPending,
    ...(refused === undefined ? {} : { refused }),
  };
}
