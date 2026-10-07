import { Trans, useLingui } from "@lingui/react/macro";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { BackButton, backToFamily } from "../src/components/back-button.tsx";
import { Chip, PrimaryButton, SecondaryButton, Words } from "../src/components/ui.tsx";
import { dayMonth, shortDayName } from "../src/data/format.ts";
import { selectedLight } from "../src/data/selected-light.ts";
import { useAway } from "../src/data/useAway.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/** The phone's date `days` from today, as the API writes dates. */
function dateIn(days: number, localDate?: string): string {
  if (localDate !== undefined) {
    const date = new Date(`${localDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  const at = new Date();
  at.setDate(at.getDate() + days);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** "Thu 8 Oct": a day the chips name, short enough for two weeks of them. */
function chipDay(date: string): string {
  return `${shortDayName(date)} ${dayMonth(`${date}T12:00:00Z`)}`;
}

/**
 * Away mode (spec §8), opened from You: any member of the family says she is away, from today or
 * tomorrow until a day in the next two weeks, or until she is back. Her mornings still come, and
 * nobody is told her morning went quiet while she is away.
 */
export default function AwayScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { member } = useLocalSearchParams<{ member?: string }>();
  const day = useToday();
  const { today, familyId } = day;
  const her = selectedLight(today.lights, member);
  const name = her?.displayName ?? t`Mom`;
  const { set } = useAway(familyId);
  const [from, setFrom] = useState(0);
  const [until, setUntil] = useState<number | null>(null);
  const days = Array.from({ length: 14 }, (_, index) => index + from);

  if (her === undefined)
    return (
      <>
        <Stack.Screen
          options={{ headerShown: true, title: t`Away`, headerLeft: () => <BackButton /> }}
        />
        <View style={{ padding: space.margin, gap: space.l }}>
          <Words variant="body">
            {day.loading ? (
              <Trans>Loading your family…</Trans>
            ) : day.trouble ? (
              <Trans>Your family could not be reached just now.</Trans>
            ) : (
              <Trans>Choose a parent from You before changing away dates.</Trans>
            )}
          </Words>
          {day.trouble ? <SecondaryButton label={t`Try again`} onPress={day.refresh} /> : null}
          <SecondaryButton label={t`Go to You`} onPress={() => router.replace("/(tabs)/you")} />
        </View>
      </>
    );

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Away`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <Words variant="title">
          <Trans>Is {name} away?</Trans>
        </Words>
        <Words variant="body" tone="ink2">
          <Trans>
            Her mornings still come while she is away. Nobody is told her morning went quiet, and
            nothing is sent to her again later that day.
          </Trans>
        </Words>

        <View style={{ gap: space.s }}>
          <Words variant="heading">
            <Trans>From</Trans>
          </Words>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            <Chip label={t`Today`} selected={from === 0} onPress={() => setFrom(0)} />
            <Chip label={t`Tomorrow`} selected={from === 1} onPress={() => setFrom(1)} />
          </View>
        </View>

        <View style={{ gap: space.s }}>
          <Words variant="heading">
            <Trans>Until</Trans>
          </Words>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            <Chip
              label={t`Until she's back`}
              selected={until === null}
              onPress={() => setUntil(null)}
            />
            {days.map((offset) => (
              <Chip
                key={offset}
                label={chipDay(dateIn(offset, her?.localDate))}
                selected={until === offset}
                onPress={() => setUntil(offset)}
              />
            ))}
          </View>
          {until === null ? (
            <Words variant="caption" tone="ink3">
              <Trans>It ends when she next answers, from a later day than today.</Trans>
            </Words>
          ) : null}
        </View>

        {set.isError ? (
          <Words variant="body" tone="ink2">
            <Trans>That could not be saved just now. Try again in a moment.</Trans>
          </Words>
        ) : null}
        <PrimaryButton
          label={set.isPending ? t`Saving…` : t`${name} is away`}
          disabled={set.isPending || her === undefined}
          onPress={() => {
            if (!apiConfigured() || her === undefined) {
              backToFamily();
              return;
            }
            set.mutate(
              {
                memberId: her.memberId,
                away: {
                  from: dateIn(from, her.localDate),
                  until: until === null ? null : dateIn(Math.max(until, from), her.localDate),
                },
              },
              { onSuccess: backToFamily },
            );
          }}
        />
      </ScrollView>
    </>
  );
}
