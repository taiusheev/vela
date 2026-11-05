import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMotionPreference } from "../../accessibility/use-reduced-motion.ts";
import { readDraft, type StoryStep, updateDraft } from "../../data/onboarding-draft.ts";
import { hitSlop, space, type } from "../../theme/tokens.ts";
import { Text } from "../scaled-text.tsx";
import { NightScene, night, useRise } from "./night-scene.tsx";

/**
 * A button on the night scenes: warm paper with ink for the next step, plain for a way out. Amber is
 * kept for her lit window, so the light still means only one thing.
 */
export function NightButton({
  label,
  onPress,
  quiet = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  quiet?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: quiet ? 48 : 56,
        borderRadius: 16,
        paddingHorizontal: space.l,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: quiet ? "transparent" : night.cream,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={[
          type.button,
          { fontSize: 17, textAlign: "center", color: quiet ? night.creamSoft : night.onAmber },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The words over a night scene: a small amber line, a headline, a sentence, then the cards. */
export function NightCopy({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  const first = useRise(80);
  const second = useRise(240);
  return (
    <View style={{ gap: space.m }}>
      <Animated.View style={[first, { gap: space.m }]}>
        <Text style={[type.label, { color: night.amber, letterSpacing: 0.8 }]}>{eyebrow}</Text>
        <Text accessibilityRole="header" style={[type.display, { color: night.cream }]}>
          {title}
        </Text>
      </Animated.View>
      {body === undefined ? null : (
        <Animated.View style={second}>
          <Text style={[type.body, { color: night.creamSoft }]}>{body}</Text>
        </Animated.View>
      )}
      {children}
    </View>
  );
}

/**
 * The welcome (onboarding v2, founder 5 November 2026): her house at dusk, and a lamp coming on in
 * her window, like a real bulb, before the words rise in. It plays once, about three seconds; then the
 * light breathes slowly. With Reduce Motion it opens lit. This one picture stands for the old four-part
 * story: you ask, she answers, her window lights up.
 */
export function Story({ step: _step, signedIn }: { step: StoryStep; signedIn: boolean }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  // Undefined until the phone says whether motion is reduced: the moment plays once, so it waits
  // for the answer rather than being skipped by the safe default.
  const reduced = useMotionPreference();
  const [lit, setLit] = useState(false);
  const [breathing, setBreathing] = useState(false);
  const words = useRef(new Animated.Value(0)).current;
  const actions = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced === undefined) return;
    if (reduced) {
      setLit(true);
      words.setValue(1);
      actions.setValue(1);
      return;
    }
    const on = setTimeout(() => setLit(true), 500);
    const breathe = setTimeout(() => setBreathing(true), 3200);
    const rise = (value: Animated.Value, delay: number) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 560,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      });
    const rising = Animated.parallel([rise(words, 2200), rise(actions, 2500)]);
    rising.start();
    return () => {
      clearTimeout(on);
      clearTimeout(breathe);
      rising.stop();
    };
  }, [reduced, words, actions]);
  const risen = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  return (
    <NightScene dim={lit ? 0.25 : 0.7} glow={lit ? 1 : 0} lamp={lit ? 1 : 0} breathing={breathing}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.xl,
          gap: space.xxl,
        }}
      >
        <Animated.View style={[risen(words), { gap: space.m }]}>
          <Text accessibilityRole="header" style={[type.display, { color: night.cream }]}>
            {t`Keep a light on for Mom.`}
          </Text>
          <Text style={[type.body, { color: night.creamSoft }]}>
            {t`Each morning one small question from you reaches her where she already chats. When she answers, her window lights up on your phone.`}
          </Text>
        </Animated.View>
        <Animated.View style={[risen(actions), { gap: space.xs }]}>
          <NightButton
            label={t`Start · about 3 minutes`}
            onPress={() =>
              updateDraft({
                step: "who",
                // She starts as "Mom" until the organiser types their own word for her.
                ...(readDraft().callName === ""
                  ? { callName: t({ comment: "who the light is for", message: "Mom" }) }
                  : {}),
              })
            }
          />
          {signedIn ? null : (
            <NightButton
              quiet
              label={t`I already have an account`}
              onPress={() => router.push("/sign-in")}
            />
          )}
        </Animated.View>
      </View>
    </NightScene>
  );
}
