import { ph, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useReducedMotion } from "../../accessibility/use-reduced-motion.ts";
import { clockTime, listOf, shortDayName } from "../../data/format.ts";
import { arrivalAfter, countries, interestTopics } from "../../data/onboarding.ts";
import { type OnboardingDraft, updateDraft } from "../../data/onboarding-draft.ts";
import { hitSlop, space, type } from "../../theme/tokens.ts";
import { NightScene, night } from "./night-scene.tsx";
import { NightButton, NightCopy } from "./story.tsx";

function clock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return clockTime(hour ?? 0, minute ?? 0);
}

/** `YYYY-MM-DD` of the organiser's own day, `days` after today. */
function localDate(days: number, from: Date = new Date()): string {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function Tick({ text, done }: { text: string; done: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        paddingVertical: space.m,
        borderBottomWidth: 1,
        borderColor: night.creamFaint,
        opacity: done ? 1 : 0.3,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 2,
          borderColor: done ? night.amber : "rgba(251,244,231,0.3)",
          backgroundColor: done ? night.amber : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done ? (
          <Svg width={13} height={13} viewBox="0 0 24 24">
            <Path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke={night.onAmber}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>
      <Text style={[type.body, { flex: 1, color: night.cream }]}>{text}</Text>
    </View>
  );
}

/**
 * Putting her first week together, where the organiser can watch it happen (the labor illusion:
 * Buell & Norton 2011): the window's last pane lights, and each answer they gave is ticked off as
 * it becomes part of her week. Then they see the week itself.
 */
export function Build({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t, i18n } = useLingui();
  const insets = useSafeAreaInsets();
  const still = useReducedMotion();
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (still) {
      setDone(4);
      return;
    }
    const timers = [1, 2, 3, 4].map((count) =>
      setTimeout(() => setDone((current) => Math.max(current, count)), 500 + count * 650),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [still]);
  const zone = countries
    .find((choice) => choice.code === draft.country)
    ?.zones.find((choice) => choice.zone === draft.zone);
  const place = zone === undefined ? draft.zone : i18n._(zone.label);
  const topics = listOf(
    draft.interests
      .slice(0, 3)
      .map((interest) => interestTopics.find((choice) => choice.value === interest))
      .flatMap((choice) => (choice === undefined ? [] : [i18n._(choice.label)])),
  );
  const someone = draft.people[0]?.name;
  const lines = [
    t`Mornings at ${ph({ time: clock(arrivalAfter(draft.wake)) })}, ${place} time`,
    t`Questions from what ${name} loves: ${topics}`,
    draft.nobody === "me"
      ? t`Quiet days covered, signed by you`
      : t`Vela asks on mornings nobody writes`,
    someone === undefined
      ? t`Room to add someone nearby later`
      : t`${someone} nearby, for quiet days`,
  ];
  return (
    <NightScene dim={0.62} glow={0.7}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.xl,
          gap: space.l,
        }}
      >
        <NightCopy
          eyebrow={t`All four panes lit`}
          title={t`Putting together ${name}’s first week…`}
        >
          <View accessibilityLiveRegion="polite">
            {lines.map((line, index) => (
              <Tick key={line} text={line} done={done > index} />
            ))}
          </View>
        </NightCopy>
        <View style={{ minHeight: 56 }}>
          {done >= 4 ? (
            <NightButton
              label={t`See ${name}’s first week`}
              onPress={() => updateDraft({ step: "plan" })}
            />
          ) : null}
        </View>
      </View>
    </NightScene>
  );
}

/**
 * Her first week, made from the organiser's answers: the first question they chose, then six from
 * her interests in the family's own wording. Saving queues them as the organiser's asks, so each is
 * sent signed with their name, one a morning, unless someone in the family writes that day; so
 * every suggested one can be taken out first.
 */
export function Plan({
  draft,
  name,
  onSave,
}: {
  draft: OnboardingDraft;
  name: string;
  onSave: () => void;
}) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const you = draft.you.trim();
  const mornings = draft.week.length;
  return (
    <NightScene dim={0.86} glow={0.2}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl,
          gap: space.l,
        }}
      >
        <NightCopy
          eyebrow={t`If ${name} says yes today`}
          title={plural(mornings, {
            one: "# morning, ready.",
            other: "# mornings, ready.",
          })}
        />
        <View style={{ backgroundColor: "#FBF7F0", borderRadius: 22, paddingHorizontal: space.l }}>
          {draft.week.map((ask, index) => (
            <View
              key={ask}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.m,
                paddingVertical: space.m,
                borderTopWidth: index === 0 ? 0 : 1,
                borderColor: "#E8E1D6",
              }}
            >
              <Text style={[type.label, { width: 40, paddingTop: 4, color: "#6D655B" }]}>
                {shortDayName(localDate(index + 1))}
              </Text>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={[type.preview, { fontSize: 17, lineHeight: 24, color: "#1E1A16" }]}>
                  {ask}
                </Text>
                <Text style={[type.caption, { color: index === 0 ? "#8A4E06" : "#1F5C66" }]}>
                  {index === 0 ? t`Your first question` : t`Suggested from what ${name} loves`}
                </Text>
              </View>
              {index === 0 ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t`Take out “${ask}”`}
                  hitSlop={hitSlop}
                  onPress={() => updateDraft({ week: draft.week.filter((each) => each !== ask) })}
                  style={{
                    width: 44,
                    height: 44,
                    marginTop: -10,
                    marginRight: -12,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Svg width={16} height={16} viewBox="0 0 24 24">
                    <Path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="#6D655B"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </Svg>
                </Pressable>
              )}
            </View>
          ))}
        </View>
        <Text style={[type.caption, { color: night.creamSoft }]}>
          {t`Each goes to ${name} signed “— ${you}”, one a morning, unless someone in the family writes that day. Take out any you would not send.`}
        </Text>
        <NightButton label={t`Save ${name}’s mornings`} onPress={onSave} />
      </ScrollView>
    </NightScene>
  );
}
