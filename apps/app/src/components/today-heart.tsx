import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import { useMotionPreference } from "../accessibility/use-reduced-motion.ts";
import { apiConfigured, replyRefusal, replyTo } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "../data/live-state.ts";
import { useDraft } from "../storage/useDraft.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Words } from "./ui.tsx";

const native = Platform.OS !== "web";

/**
 * A heart for her answer, as the Memories heart is drawn: a bare outline to tap, then filled with
 * the light's amber once it is on its way, with one beat and a ring of warmth, and no words — the
 * heart itself says it was sent. A separate attempt cannot overwrite a text reply already saved.
 */
export function TodayHeart({
  id,
  recipient,
  given = false,
  onTrouble,
}: {
  id: string;
  recipient: string;
  /** The reader's heart is already on her answer (Today knows it): drawn filled, still. */
  given?: boolean;
  /** Where the page shows why a heart did not go, as a line of its own, never beside the heart. */
  onTrouble?: (message: string | null) => void;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const account = useAccount();
  const draft = useDraft(`heart.${id}`);
  const queries = useQueryClient();
  const busy = useRef(false);
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const reduced = useMotionPreference();
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
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
  // Filled from the tap on, so it answers at once; back to an outline only if sending failed.
  const filled = given || post.isPending || post.isSuccess;
  const sent = given || post.isSuccess;
  useEffect(() => {
    // Only a heart given here beats: one already given is simply shown.
    if (!(post.isPending || post.isSuccess) || reduced !== false) return;
    ring.setValue(0);
    const beat = Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.3,
          duration: 140,
          easing: Easing.out(Easing.quad),
          useNativeDriver: native,
        }),
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: native }),
      ]),
      Animated.timing(ring, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: native,
      }),
    ]);
    beat.start();
    return () => beat.stop();
  }, [post.isPending, post.isSuccess, reduced, scale, ring]);
  const refusal = post.isError ? replyRefusal(post.error) : null;
  const trouble =
    refusal === "not_answered"
      ? t`She has not answered yet, so there is nothing to reply to.`
      : refusal === "her_own"
        ? t`This is your own morning; replies are for the family.`
        : post.isError
          ? t`That heart could not be sent just now. Tap to try again.`
          : null;
  useEffect(() => {
    onTrouble?.(trouble);
  }, [trouble, onTrouble]);
  const sendHeart = () => {
    if (busy.current || sent || !draft.ready) return;
    busy.current = true;
    void post
      .mutateAsync()
      .catch(() => {})
      .finally(() => {
        busy.current = false;
      });
  };
  const sentLabel = demo && !given ? t`Example · heart sent` : t`Heart sent`;
  return (
    <View accessibilityLiveRegion="polite" style={{ alignItems: "flex-end", gap: space.xs }}>
      <Pressable
        testID={`today-heart-${id}`}
        accessibilityRole="button"
        accessibilityLabel={sent ? sentLabel : t`Heart for ${recipient}`}
        accessibilityState={{ disabled: !draft.ready || filled, selected: sent }}
        disabled={!draft.ready || filled}
        hitSlop={hitSlop}
        onPress={sendHeart}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.light,
            opacity: ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.35, 0] }),
            transform: [
              { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.6] }) },
            ],
          }}
        />
        <Animated.View style={{ transform: [{ scale }] }}>
          <BrandIcon
            name="heart"
            size={26}
            strokeWidth={filled ? 2 : 1.8}
            color={filled ? palette.lightDeep : palette.ink2}
            {...(filled ? { fill: palette.light } : {})}
          />
        </Animated.View>
      </Pressable>
      {trouble === null || onTrouble !== undefined ? null : (
        <Words variant="caption" tone="ink2">
          {trouble}
        </Words>
      )}
    </View>
  );
}
