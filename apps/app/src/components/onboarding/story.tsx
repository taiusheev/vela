import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Animated, Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import EXAMPLE_PORTRAIT from "../../../assets/onboarding/example-mom.jpg";
import MORNING_TEA from "../../../assets/onboarding/morning-tea.jpg";
import { exampleNames } from "../../data/example-names.ts";
import { clockTime } from "../../data/format.ts";
import {
  readDraft,
  STORY_STEPS,
  type StoryStep,
  updateDraft,
} from "../../data/onboarding-draft.ts";
import { hitSlop, space, type } from "../../theme/tokens.ts";
import { Text } from "../scaled-text.tsx";
import { NightScene, night, useRise } from "./night-scene.tsx";

/** The example organiser who signs the example question: a name, the same in every language. */

/** How dark the room is and how bright her window, scene by scene. */
const LIGHTING: Record<StoryStep, { dim: number; glow: number }> = {
  night: { dim: 0.72, glow: 0 },
  send: { dim: 0.6, glow: 0 },
  answer: { dim: 0, glow: 1 },
  quiet: { dim: 0.86, glow: 0 },
};

/** A button on the night scenes: amber with ink for the next step, plain for a way out. */
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
        backgroundColor: quiet ? "transparent" : night.amber,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={[
          type.button,
          { fontSize: 17, textAlign: "center", color: quiet ? night.cream : night.onAmber },
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

function Card({ children, align }: { children: ReactNode; align: "start" | "end" | "stretch" }) {
  const rise = useRise(0);
  return (
    <Animated.View
      style={[
        rise,
        {
          alignSelf: align === "start" ? "flex-start" : align === "end" ? "flex-end" : "stretch",
          maxWidth: align === "stretch" ? undefined : 320,
          marginBottom: space.l,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The story the onboarding opens with (See It First): twenty seconds of what Vela does, played
 * before any question. An example morning, said to be one, so the mother in it is never taken for
 * a real person in the family. There is no Skip: it is four taps, and the questions after it read
 * better for it.
 */
export function Story({ step, signedIn }: { step: StoryStep; signedIn: boolean }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const at = STORY_STEPS.indexOf(step);
  const go = (next: StoryStep) => updateDraft({ step: next });
  const time = clockTime(8, 0);

  return (
    <NightScene dim={LIGHTING[step].dim} glow={LIGHTING[step].glow}>
      <View
        style={{
          position: "absolute",
          top: insets.top + space.m,
          left: space.margin,
          right: space.margin,
          flexDirection: "row",
          gap: 5,
        }}
        accessibilityRole="progressbar"
        accessibilityLabel={t`Example morning`}
        accessibilityValue={{ min: 1, max: STORY_STEPS.length, now: at + 1 }}
      >
        {STORY_STEPS.map((scene, index) => (
          <View
            key={scene}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: index <= at ? night.cream : "rgba(251,244,231,0.25)",
            }}
          />
        ))}
      </View>

      <View
        key={step}
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.xl,
          gap: space.l,
        }}
      >
        {step === "night" ? (
          <>
            <NightCopy
              eyebrow={t`An example morning · ${time} in Da Nang`}
              title={t`Far from you, Mom’s day is beginning.`}
              body={t`See what Vela does with it. It takes twenty seconds.`}
            />
            <View style={{ gap: space.xs }}>
              <NightButton label={t`Send her a morning question`} onPress={() => go("send")} />
              {signedIn ? null : (
                <NightButton
                  quiet
                  label={t`I already have an account`}
                  onPress={() => router.push("/sign-in")}
                />
              )}
            </View>
          </>
        ) : null}

        {step === "send" ? (
          <>
            <Card align="start">
              <View
                style={{
                  padding: space.l,
                  paddingBottom: space.m,
                  borderRadius: 22,
                  borderBottomLeftRadius: 6,
                  backgroundColor: "#FFFFFF",
                  gap: space.xs,
                }}
              >
                <Text
                  style={[type.preview, { color: night.onAmber }]}
                >{t`Good morning, Mom.`}</Text>
                <Text style={[type.preview, { color: night.onAmber }]}>
                  {t`What did you have for breakfast?`}
                </Text>
                <Text style={[type.preview, { color: "#5A534B", fontStyle: "italic" }]}>
                  {`— ${exampleNames().mia}`}
                </Text>
                <Text style={[type.caption, { color: "#6D655B", alignSelf: "flex-end" }]}>
                  {t`${time} · in her Telegram`}
                </Text>
              </View>
            </Card>
            <NightCopy
              eyebrow={t`One message from you`}
              title={t`In her own messenger. No new app for her.`}
              body={t`She answers when she likes: a few words, a photo, or her voice.`}
            />
            <NightButton label={t`Wait for her answer`} onPress={() => go("answer")} />
          </>
        ) : null}

        {step === "answer" ? (
          <>
            <Card align="end">
              <View
                style={{
                  padding: space.s,
                  borderRadius: 22,
                  borderBottomRightRadius: 6,
                  backgroundColor: "#FBEBCF",
                  gap: space.s,
                }}
              >
                <Image
                  source={MORNING_TEA}
                  resizeMode="cover"
                  accessibilityLabel={t`An example mother at her kitchen table with tea`}
                  style={{ width: 296, maxWidth: "100%", height: 112, borderRadius: 16 }}
                />
                <Text style={[type.preview, { color: night.onAmber, paddingHorizontal: space.s }]}>
                  {t`Phở with Auntie Lan. Too much, as always.`}
                </Text>
                <Text
                  style={[
                    type.caption,
                    { color: "#6D655B", alignSelf: "flex-end", paddingHorizontal: space.s },
                  ]}
                >
                  {t`Mom · ${ph({ time: clockTime(8, 14) })}`}
                </Text>
              </View>
            </Card>
            <NightCopy
              eyebrow={t`${ph({ time: clockTime(8, 14) })} · She answered`}
              title={t`And her window lights up.`}
              body={t`That’s all the light means: she answered. Reply, listen, or just send a heart.`}
            />
            <NightButton label={t`And on a quiet morning?`} onPress={() => go("quiet")} />
          </>
        ) : null}

        {step === "quiet" ? (
          <>
            <Card align="stretch">
              <View
                style={{
                  padding: space.l,
                  borderRadius: 22,
                  backgroundColor: "#FBF7F0",
                  gap: space.m,
                }}
              >
                <View style={{ flexDirection: "row", gap: space.m, alignItems: "center" }}>
                  <Image
                    source={EXAMPLE_PORTRAIT}
                    resizeMode="cover"
                    style={{
                      width: 44,
                      height: 56,
                      borderTopLeftRadius: 22,
                      borderTopRightRadius: 22,
                      borderBottomLeftRadius: 8,
                      borderBottomRightRadius: 8,
                      opacity: 0.7,
                    }}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.heading, { color: night.onAmber }]}>
                      {t`No answer from Mom yet today.`}
                    </Text>
                    <Text style={[type.caption, { color: "#5A534B" }]}>
                      {t`Her morning was sent at ${time}. If you can, give her a call.`}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: space.s }}>
                  <View
                    style={{
                      flex: 1,
                      minHeight: 46,
                      borderRadius: 13,
                      backgroundColor: "#3A2A1F",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={[type.button, { color: "#FFFFFF" }]}>{t`Call Mom`}</Text>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      minHeight: 46,
                      borderRadius: 13,
                      borderWidth: 1,
                      borderColor: "#948779",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={[type.button, { color: night.onAmber }]}>{t`Message`}</Text>
                  </View>
                </View>
              </View>
            </Card>
            <NightCopy
              eyebrow={t`${ph({ time: clockTime(12, 0) })} · A quiet morning`}
              title={t`If she doesn’t answer, you know the same day.`}
              body={t`Once, gently, with something you can do. Never an alarm.`}
            />
            <NightButton
              label={t`Set this up for my family`}
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
          </>
        ) : null}
      </View>
    </NightScene>
  );
}
