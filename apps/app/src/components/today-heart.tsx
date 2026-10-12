import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { apiConfigured, replyRefusal, replyTo } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "../data/live-state.ts";
import { useDraft } from "../storage/useDraft.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Chip, ReceiptChip, Words } from "./ui.tsx";

/** A separate attempt cannot overwrite a text reply the reader has already saved. */
export function TodayHeart({
  id,
  recipient,
  compact = false,
}: {
  id: string;
  recipient: string;
  compact?: boolean;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const account = useAccount();
  const draft = useDraft(`heart.${id}`);
  const queries = useQueryClient();
  const busy = useRef(false);
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const post = useMutation({
    mutationFn: async () => {
      if (demo) return;
      const body = { reaction: "heart" } as const;
      await replyTo(id, await draft.keyFor(body), body, await account.token());
    },
    onSuccess: () => {
      // Keep the accepted identity: remounting/retrying can only replay this same heart.
      if (!demo) {
        void queries.invalidateQueries({ queryKey: ["today"] });
        void queries.invalidateQueries({ queryKey: ["exchanges"] });
        void queries.invalidateQueries({ queryKey: ["exchange", id] });
      }
    },
  });
  const refusal = post.isError ? replyRefusal(post.error) : null;
  const trouble =
    refusal === "not_answered"
      ? t`She has not answered yet, so there is nothing to reply to.`
      : refusal === "her_own"
        ? t`This is your own morning; replies are for the family.`
        : post.isError
          ? t`That heart could not be sent just now. Tap to try again.`
          : null;
  const sendHeart = () => {
    if (busy.current || post.isSuccess || !draft.ready) return;
    busy.current = true;
    void post
      .mutateAsync()
      .catch(() => {})
      .finally(() => {
        busy.current = false;
      });
  };
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: space.s,
        alignItems: "flex-start",
        flexShrink: 1,
        maxWidth: compact ? 160 : undefined,
      }}
    >
      {compact && !post.isSuccess ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Heart for ${recipient}`}
          accessibilityState={{ disabled: !draft.ready || post.isPending || post.isSuccess }}
          disabled={!draft.ready || post.isPending || post.isSuccess}
          onPress={sendHeart}
          style={({ pressed }) => ({
            minHeight: 54,
            minWidth: 54,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: palette.control,
            borderRadius: radius.button,
            backgroundColor: "transparent",
            opacity: post.isPending ? 0.45 : pressed ? 0.8 : 1,
          })}
        >
          <BrandIcon name="heart" color={palette.ink} size={22} />
        </Pressable>
      ) : post.isSuccess ? (
        <ReceiptChip label={demo ? t`Example · heart sent` : t`Heart sent`} />
      ) : (
        <Chip
          label={post.isPending ? t`Sending…` : t`Heart for ${recipient}`}
          disabled={!draft.ready || post.isPending}
          onPress={sendHeart}
        />
      )}
      {trouble === null ? null : (
        <Words variant="body" tone="ink2">
          {trouble}
        </Words>
      )}
    </View>
  );
}
