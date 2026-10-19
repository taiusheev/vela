import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { t as herWords } from "@vela/copy";
import { type ReactNode, useState } from "react";
import { Animated, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { clockTime, timeOfDay } from "../../data/format.ts";
import {
  arrivalAfter,
  countries,
  deviceZone,
  firstQuestionChoices,
  firstWeek,
  interestTopics,
  languages,
  nextMorningAt,
  relationships,
  replyWays,
  wakeTimes,
} from "../../data/onboarding.ts";
import {
  answered,
  CHAPTERS,
  chapterOf,
  firstQuestion,
  type Messenger,
  type OnboardingDraft,
  previousStep,
  type QuestionStep,
  updateDraft,
  updateDraftForRun,
} from "../../data/onboarding-draft.ts";
import {
  discardOnboardingPortrait,
  pickOnboardingPortrait,
} from "../../data/onboarding-portrait.ts";
import { usePalette } from "../../theme/theme.tsx";
import { hitSlop, space, type } from "../../theme/tokens.ts";
import { Chip, PrimaryButton, TextField, Words } from "../ui.tsx";
import { NightScene, night, useRise } from "./night-scene.tsx";
import { PaneWindow } from "./pane-window.tsx";

/** "08:30" written as the app writes a time: "8:30", or "08:30" in Chinese. */
function clock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return clockTime(hour ?? 0, minute ?? 0);
}

/** What the screens call her: the organiser's own word for her, or who she is until they type one. */
export function nameFor(draft: OnboardingDraft, fallback: string): string {
  const name = draft.callName.trim();
  return name.length > 0 ? name : fallback;
}

/** One line under every question: why Vela asks it (Tan et al. 2014: a reason earns the answer). */
function Why({ children, lock = false }: { children: string; lock?: boolean }) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: space.s, alignItems: "flex-start" }}>
      <Svg width={16} height={16} viewBox="0 0 24 24" style={{ marginTop: 3 }}>
        {lock ? (
          <>
            <Rect
              x={5}
              y={11}
              width={14}
              height={10}
              rx={2}
              fill="none"
              stroke={palette.action}
              strokeWidth={2}
            />
            <Path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke={palette.action} strokeWidth={2} />
          </>
        ) : (
          <>
            <Circle cx={12} cy={12} r={9} fill="none" stroke={palette.action} strokeWidth={2} />
            <Path
              d="M12 11v5M12 8h.01"
              fill="none"
              stroke={palette.action}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        )}
      </Svg>
      <View style={{ flex: 1 }}>
        <Words variant="caption" tone="ink2">
          {children}
        </Words>
      </View>
    </View>
  );
}

/** A choice as a row: a radio for one-of, a check for many; selected rows take the action colour. */
function PickRow({
  title,
  detail,
  selected,
  onPress,
  leading,
  editorial = false,
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  leading?: ReactNode;
  editorial?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        minHeight: 56,
        paddingVertical: space.m,
        paddingHorizontal: space.l,
        borderRadius: 16,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? palette.action : palette.rule,
        backgroundColor: selected ? palette.actionSoft : palette.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[editorial ? type.preview : type.bodyMedium, { color: palette.ink }]}>
          {title}
        </Text>
        {detail === undefined ? null : (
          <Text style={[type.caption, { color: palette.ink2 }]}>{detail}</Text>
        )}
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: selected ? 0 : 1.5,
          borderColor: palette.control,
          backgroundColor: selected ? palette.action : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <Svg width={13} height={13} viewBox="0 0 24 24">
            <Path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke={palette.onAction}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>
    </Pressable>
  );
}

function Icon({ path }: { path: string }) {
  const palette = usePalette();
  return (
    <View
      style={{
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: palette.surface2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path
          d={path}
          fill="none"
          stroke={palette.action}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const CHAT = "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z";
const PHONE =
  "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2";
const REPLY_ICONS: Record<string, string> = {
  text: "M4 7h16M4 12h16M4 17h10",
  voice: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  photo: "M4 7h3l2-2h6l2 2h3v12H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  tap: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
};

/** Brings a question's content up into place each time the question changes. */
function Rising({ children }: { children: ReactNode }) {
  const rise = useRise(0);
  return <Animated.View style={[rise, { flexGrow: 1, gap: space.l }]}>{children}</Animated.View>;
}

/**
 * The ten questions (See It First), in three chapters under a window whose panes light as each
 * chapter is done: the story lit the first, so the window starts a quarter lit (Nunes & Drèze 2006).
 * Easy questions come first and personal ones last; every one says why it is asked, and none has a
 * Skip. A question whose honest answer is "none" offers that as an answer.
 */
export function Questions({ draft, step }: { draft: OnboardingDraft; step: QuestionStep }) {
  const { t, i18n } = useLingui();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const relationship = relationships.find((choice) => choice.value === draft.relationship);
  const name = nameFor(draft, relationship === undefined ? t`them` : i18n._(relationship.label));
  const { chapter, index, size } = chapterOf(step);
  const chapterName = [t`${name}’s mornings`, t`${name}’s world`, t`Close by`][chapter - 1] ?? "";
  const lit = chapter;
  const paneLine =
    step === "who"
      ? t`You’ve seen how it works. First pane lit.`
      : t`${ph({ count: lit })} of 4 panes lit · ${chapterName}`;
  const back = () => {
    const previous = previousStep(step);
    if (previous !== null) updateDraft({ step: previous });
  };
  const go = (next: QuestionStep | "build") => updateDraft({ step: next });
  const ready = answered(step, draft);

  return (
    <NightScene dim={0.9} glow={0}>
      <View
        style={{
          paddingTop: insets.top + space.m,
          paddingBottom: space.xl,
          alignItems: "center",
          gap: space.s,
        }}
      >
        <PaneWindow lit={lit} width={34} frame={night.cream} unlit="#3A332C" />
        <Text style={[type.caption, { color: night.cream, fontFamily: type.heading.fontFamily }]}>
          {paneLine}
        </Text>
      </View>
      <View
        style={{
          flex: 1,
          backgroundColor: palette.bg,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: space.m,
            paddingLeft: space.s,
            paddingRight: space.margin,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t`Back`}
            hitSlop={hitSlop}
            onPress={back}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke={palette.ink}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.s }}
            accessibilityRole="progressbar"
            accessibilityLabel={chapterName}
            accessibilityValue={{ min: 1, max: size, now: index + 1 }}
          >
            <Text style={[type.label, { color: palette.ink3 }]}>{chapterName}</Text>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {(CHAPTERS[chapter - 1] ?? []).map((question, dot) => (
                <View
                  key={question}
                  style={{
                    width: dot === index ? 18 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor:
                      dot === index ? palette.action : dot < index ? palette.control : palette.rule,
                  }}
                />
              ))}
            </View>
          </View>
        </View>

        <ScrollView
          key={step}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: space.margin,
            paddingTop: space.s,
            paddingBottom: insets.bottom + space.xl,
            gap: space.l,
          }}
        >
          <Rising key={step}>
            {step === "who" ? <Who draft={draft} /> : null}
            {step === "where" ? <Where draft={draft} name={name} /> : null}
            {step === "wake" ? <Wake draft={draft} name={name} /> : null}
            {step === "messenger" ? <Messengers draft={draft} name={name} /> : null}
            {step === "world" ? <World draft={draft} name={name} /> : null}
            {step === "replies" ? <Replies draft={draft} name={name} /> : null}
            {step === "first" ? <First draft={draft} name={name} /> : null}
            {step === "nobody" ? <Nobody draft={draft} name={name} /> : null}
            {step === "nearby" ? <Nearby draft={draft} name={name} /> : null}
            {step === "photo" ? <Photo draft={draft} name={name} /> : null}
            <View style={{ flexGrow: 1 }} />
            <PrimaryButton
              label={
                step === "world" && !ready
                  ? t`Choose at least one`
                  : step === "photo"
                    ? t`Build ${name}’s first week`
                    : t`Continue`
              }
              disabled={!ready}
              onPress={() => {
                if (step === "photo") {
                  updateDraft({
                    week: firstWeek(draft.interests, firstQuestion(draft), draft.language),
                    step: "build",
                  });
                  return;
                }
                const next = {
                  who: "where",
                  where: "wake",
                  wake: "messenger",
                  messenger: "world",
                  world: "replies",
                  replies: "first",
                  first: "nobody",
                  nobody: "nearby",
                  nearby: "photo",
                } as const;
                go(next[step]);
              }}
            />
          </Rising>
        </ScrollView>
      </View>
    </NightScene>
  );
}

function Title({ children, why, lock }: { children: string; why: string; lock?: boolean }) {
  return (
    <View style={{ gap: space.m }}>
      <Words variant="title" accessibilityRole="header">
        {children}
      </Words>
      <Why lock={lock ?? false}>{why}</Why>
    </View>
  );
}

function Who({ draft }: { draft: OnboardingDraft }) {
  const { t, i18n } = useLingui();
  return (
    <>
      <Title why={t`So every message sounds like your family, not like an app.`}>
        {t`Who are you keeping a light on for?`}
      </Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        {relationships.map((choice) => (
          <Chip
            key={choice.value}
            label={i18n._(choice.label)}
            selected={draft.relationship === choice.value}
            onPress={() => {
              const previous = relationships.find((each) => each.value === draft.relationship);
              const untouched =
                draft.callName.trim().length === 0 ||
                (previous !== undefined && draft.callName === i18n._(previous.label));
              updateDraft({
                relationship: choice.value,
                ...(untouched
                  ? { callName: choice.value === "other" ? "" : i18n._(choice.label) }
                  : {}),
              });
            }}
          />
        ))}
      </View>
      <TextField
        label={t`What you call them`}
        value={draft.callName}
        onChangeText={(callName) => updateDraft({ callName })}
        placeholder={t`Mom, Mẹ, 媽…`}
        helper={t`Every morning starts with it.`}
        maxLength={40}
      />
      <TextField
        autoFocus
        label={t`What they call you`}
        value={draft.you}
        onChangeText={(you) => updateDraft({ you })}
        placeholder={t`Your name`}
        helper={t`Your questions are signed with it.`}
        maxLength={40}
      />
    </>
  );
}

function Where({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t, i18n } = useLingui();
  const country = countries.find((choice) => choice.code === draft.country);
  return (
    <>
      <Title why={t`Mornings arrive on ${name}’s clock, not yours.`}>
        {t`Where does ${name} live?`}
      </Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        {countries.map((choice) => (
          <Chip
            key={choice.code}
            label={i18n._(choice.label)}
            selected={draft.country === choice.code}
            onPress={() =>
              updateDraft({
                country: choice.code,
                zone: choice.zones[0]?.zone ?? draft.zone,
                ...(draft.languageChosen
                  ? {}
                  : { language: choice.code === "TW" ? "zh-TW" : "en" }),
              })
            }
          />
        ))}
      </View>
      {country !== undefined && country.zones.length > 1 ? (
        <View style={{ gap: space.s }}>
          <Words variant="bodyMedium">{t`Which part?`}</Words>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            {country.zones.map((choice) => (
              <Chip
                key={choice.zone}
                label={i18n._(choice.label)}
                selected={draft.zone === choice.zone}
                onPress={() => updateDraft({ zone: choice.zone })}
              />
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ gap: space.s }}>
        <Words variant="bodyMedium">{t`${name} reads`}</Words>
        <View style={{ gap: space.s }}>
          {languages.map((choice) => (
            <PickRow
              key={choice.value}
              title={choice.label}
              detail={herWords(choice.value, "arrival.greeting", { address: name })}
              selected={draft.language === choice.value}
              onPress={() => updateDraft({ language: choice.value, languageChosen: true })}
            />
          ))}
        </View>
      </View>
    </>
  );
}

function Wake({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t, i18n } = useLingui();
  const palette = usePalette();
  const arrival = arrivalAfter(draft.wake);
  const time = clock(arrival);
  const zone = countries
    .find((choice) => choice.code === draft.country)
    ?.zones.find((choice) => choice.zone === draft.zone);
  const place = zone === undefined ? draft.zone : i18n._(zone.label);
  const yours = timeOfDay(nextMorningAt(arrival, draft.zone), deviceZone(draft.zone));
  return (
    <>
      <Title
        why={t`The message comes half an hour later, so it’s there when ${name} first picks up the phone.`}
      >
        {t`When does ${name} usually wake up?`}
      </Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        {wakeTimes.map((wake) => (
          <View key={wake} style={{ width: "31%" }}>
            <Chip
              label={clock(wake)}
              selected={draft.wake === wake}
              onPress={() => updateDraft({ wake })}
            />
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: "row",
          gap: space.m,
          padding: space.l,
          borderRadius: 18,
          backgroundColor: palette.lightSoft,
        }}
      >
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={4} fill="none" stroke={palette.lightDeep} strokeWidth={2} />
          <Path
            d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke={palette.lightDeep}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
        <View style={{ flex: 1, gap: 2 }}>
          <Words variant="heading">{t`${name}’s morning: ${time} in ${place}`}</Words>
          <Words variant="caption" tone="ink2">
            {yours === time
              ? t`The same time as yours.`
              : t`That’s ${ph({ time: yours })} for you.`}
          </Words>
        </View>
      </View>
    </>
  );
}

function Messengers({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t } = useLingui();
  const choices: { value: Messenger; title: string; detail: string; icon: string }[] = [
    {
      value: "telegram",
      title: t`On Telegram`,
      detail: t`Vela writes in a chat of its own.`,
      icon: CHAT,
    },
    { value: "line", title: t`On LINE`, detail: t`Vela writes in a chat of its own.`, icon: CHAT },
    {
      value: "phone",
      title: t`${name}’s own phone, with Vela`,
      detail: t`Big words, one message at a time. You set it up together.`,
      icon: PHONE,
    },
  ];
  return (
    <>
      <Title why={t`${name} answers there. No new app to learn.`}>
        {t`Where does ${name} chat already?`}
      </Title>
      <View style={{ gap: space.s }}>
        {choices.map((choice) => (
          <PickRow
            key={choice.value}
            title={choice.title}
            detail={choice.detail}
            selected={draft.messenger === choice.value}
            onPress={() => updateDraft({ messenger: choice.value })}
            leading={<Icon path={choice.icon} />}
          />
        ))}
      </View>
    </>
  );
}

function World({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t, i18n } = useLingui();
  return (
    <>
      <Title why={t`Vela suggests questions about what ${name} enjoys. Choose as many as fit.`}>
        {t`What does ${name} love to talk about?`}
      </Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        {interestTopics.map((choice) => {
          const chosen = draft.interests.includes(choice.value);
          return (
            <Chip
              key={choice.value}
              label={i18n._(choice.label)}
              selected={chosen}
              onPress={() =>
                updateDraft({
                  interests: chosen
                    ? draft.interests.filter((each) => each !== choice.value)
                    : [...draft.interests, choice.value],
                  firstPick: null,
                })
              }
            />
          );
        })}
      </View>
    </>
  );
}

function Replies({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t, i18n } = useLingui();
  return (
    <>
      <Title why={t`So Vela can make answering easy for ${name}, the way ${name} likes.`}>
        {t`How does ${name} like to reply?`}
      </Title>
      <View style={{ gap: space.s }}>
        {replyWays.map((choice) => {
          const chosen = draft.replyWays.includes(choice.value);
          return (
            <PickRow
              key={choice.value}
              title={i18n._(choice.label)}
              selected={chosen}
              leading={<Icon path={REPLY_ICONS[choice.value] ?? CHAT} />}
              onPress={() =>
                updateDraft({
                  unsure: false,
                  replyWays: chosen
                    ? draft.replyWays.filter((each) => each !== choice.value)
                    : [...draft.replyWays, choice.value],
                })
              }
            />
          );
        })}
        <View style={{ alignSelf: "flex-start" }}>
          <Chip
            label={t`Not sure yet`}
            selected={draft.unsure}
            onPress={() => updateDraft({ unsure: !draft.unsure, replyWays: [] })}
          />
        </View>
      </View>
    </>
  );
}

function First({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t } = useLingui();
  const palette = usePalette();
  const choices = firstQuestionChoices(draft.interests, draft.language);
  const shown = firstQuestion(draft) || (choices[0] ?? "");
  const you = draft.you.trim();
  const time = clock(arrivalAfter(draft.wake));
  return (
    <>
      <Title
        why={t`Picked from what ${name} loves. It comes on the first morning, signed with your name.`}
      >
        {t`${name}’s first question`}
      </Title>
      <View style={{ gap: space.s }}>
        {choices.map((choice) => (
          <PickRow
            key={choice}
            title={choice}
            editorial
            selected={draft.own.trim().length === 0 && draft.firstPick === choice}
            onPress={() => updateDraft({ firstPick: choice, own: "" })}
          />
        ))}
        <TextField
          value={draft.own}
          onChangeText={(own) => updateDraft({ own })}
          placeholder={t`Or write your own…`}
          maxLength={500}
        />
      </View>
      <View
        style={{
          alignSelf: "flex-start",
          maxWidth: 320,
          padding: space.l,
          paddingBottom: space.m,
          borderRadius: 20,
          borderBottomLeftRadius: 6,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.rule,
          gap: 4,
        }}
        accessibilityLabel={t`How it reaches ${name}`}
      >
        <Text style={[type.label, { color: palette.ink3, marginBottom: 4 }]}>
          {t`First morning · ${time}`}
        </Text>
        <Text style={[type.preview, { color: palette.ink }]}>
          {herWords(draft.language, "arrival.greeting", { address: name })}
        </Text>
        <Text style={[type.preview, { color: palette.ink }]}>{shown}</Text>
        <Text style={[type.preview, { color: palette.ink2, fontStyle: "italic" }]}>
          {`— ${you.length > 0 ? you : t`you`}`}
        </Text>
      </View>
    </>
  );
}

function Nobody({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t } = useLingui();
  const you = draft.you.trim();
  return (
    <>
      <Title
        why={t`Most days someone in the family asks. This covers the days nobody does, so ${name} always has a morning.`}
      >
        {t`On mornings nobody writes`}
      </Title>
      <View style={{ gap: space.s }}>
        <PickRow
          title={t`Vela writes one in my name`}
          detail={t`In your style, signed “— ${you}”. In your app it’s marked “written by Vela”.`}
          selected={draft.nobody === "me"}
          onPress={() => updateDraft({ nobody: "me" })}
        />
        <PickRow
          title={t`Vela asks in its own name`}
          detail={t`Signed “— Vela”. Your name is only on what you write.`}
          selected={draft.nobody === "vela"}
          onPress={() => updateDraft({ nobody: "vela" })}
        />
      </View>
    </>
  );
}

function Nearby({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t } = useLingui();
  const palette = usePalette();
  const [person, setPerson] = useState("");
  const relations = [t`Neighbour`, t`Friend`, t`Relative`, t`Other`];
  const [relation, setRelation] = useState(relations[0] ?? "");
  const add = () => {
    const who = person.trim();
    if (who.length === 0) return;
    updateDraft({ people: [...draft.people, { name: who, relation }], noneNearby: false });
    setPerson("");
  };
  return (
    <>
      <Title
        why={t`On a quiet morning you’ll see them with a Call button. Nobody hears from Vela until they say yes themselves.`}
      >
        {t`Who lives close to ${name}?`}
      </Title>
      {draft.people.length === 0 ? null : (
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: palette.rule,
            backgroundColor: palette.surface,
          }}
        >
          {draft.people.map((someone, index) => (
            <View
              key={`${someone.name}-${someone.relation}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.m,
                paddingVertical: space.s,
                paddingLeft: space.l,
                paddingRight: space.xs,
                borderTopWidth: index === 0 ? 0 : 1,
                borderColor: palette.rule,
              }}
            >
              <View style={{ flex: 1 }}>
                <Words variant="bodyMedium">{someone.name}</Words>
                <Words variant="caption" tone="ink2">
                  {t`${ph({ relation: someone.relation })} · asked after setup`}
                </Words>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`Remove ${ph({ name: someone.name })}`}
                hitSlop={hitSlop}
                onPress={() =>
                  updateDraft({ people: draft.people.filter((_, each) => each !== index) })
                }
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24">
                  <Path
                    d="M6 6l12 12M18 6L6 18"
                    stroke={palette.ink3}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </Svg>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {draft.people.length >= 2 || draft.noneNearby ? null : (
        <View
          style={{
            gap: space.m,
            padding: space.l,
            borderRadius: 16,
            backgroundColor: palette.surface2,
          }}
        >
          <TextField
            label={draft.people.length === 0 ? t`Add someone (up to two)` : t`Add one more`}
            value={person}
            onChangeText={setPerson}
            placeholder={t`Their name`}
            maxLength={40}
            onSubmit={add}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            {relations.map((choice) => (
              <Chip
                key={choice}
                label={choice}
                selected={relation === choice}
                onPress={() => setRelation(choice)}
              />
            ))}
          </View>
          <PrimaryButton label={t`Add`} disabled={person.trim().length === 0} onPress={add} />
        </View>
      )}
      <PickRow
        title={t`There’s no one nearby yet`}
        detail={t`You can add someone from Today later.`}
        selected={draft.noneNearby}
        onPress={() => updateDraft({ noneNearby: !draft.noneNearby, people: [] })}
      />
    </>
  );
}

function Photo({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t } = useLingui();
  const palette = usePalette();
  const [trouble, setTrouble] = useState(false);
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);
  const picked = draft.photo?.kind === "picked" ? draft.photo.source : null;
  return (
    <>
      <Title
        lock
        why={t`It’s how ${name} appears in your app. It stays on this phone and is never uploaded.`}
      >
        {t`Add a photo of ${name}`}
      </Title>
      <View
        style={{
          alignSelf: "center",
          width: 150,
          height: 192,
          borderTopLeftRadius: 75,
          borderTopRightRadius: 75,
          borderBottomLeftRadius: 16,
          borderBottomRightRadius: 16,
          backgroundColor: palette.surface2,
          borderWidth: picked === null ? 2 : 0,
          borderStyle: "dashed",
          borderColor: draft.photo?.kind === "initials" ? palette.action : palette.control,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {picked === null ? (
          <Text style={[type.display, { fontSize: 44, lineHeight: 52, color: palette.ink2 }]}>
            {initials}
          </Text>
        ) : (
          <Image
            source={{ uri: picked }}
            resizeMode="cover"
            accessibilityLabel={t`The photo of ${name} you chose`}
            style={{ width: 150, height: 192 }}
          />
        )}
      </View>
      <View style={{ gap: space.s }}>
        <PickRow
          title={picked === null ? t`Choose from Photos` : t`Chosen · choose another`}
          selected={picked !== null}
          leading={
            <Icon path="M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM21 16l-5-5-8 8M9 10.5h.01" />
          }
          onPress={() => {
            setTrouble(false);
            void pickOnboardingPortrait().then(
              (source) => {
                if (source === null) return;
                if (draft.photo?.kind === "picked") discardOnboardingPortrait(draft.photo.source);
                updateDraftForRun(draft.run, { photo: { kind: "picked", source } });
              },
              () => setTrouble(true),
            );
          }}
        />
        <PickRow
          title={t`No photo on this phone`}
          detail={t`Show ${name}’s initials for now.`}
          selected={draft.photo?.kind === "initials"}
          onPress={() => {
            if (draft.photo?.kind === "picked") discardOnboardingPortrait(draft.photo.source);
            updateDraft({ photo: { kind: "initials" } });
          }}
        />
        {trouble ? (
          <Words variant="caption" tone="ink2">
            {t`That photo could not be opened. Try another, or use initials for now.`}
          </Words>
        ) : null}
      </View>
    </>
  );
}
