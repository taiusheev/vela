import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiMorningPreferences, SetMorningPreferences } from "@vela/contracts";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  apiConfigured,
  fetchMorningPreferences,
  setMorningPreferences,
} from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { Chip, PrimaryButton, SecondaryButton, TextField, Words } from "../src/components/ui.tsx";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { selectedLight } from "../src/data/selected-light.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

export default function MorningSettingsScreen() {
  const { t } = useLingui();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { member } = useLocalSearchParams<{ member?: string }>();
  const { today, familyId } = useToday();
  const her = selectedLight(today.lights, member);
  const account = useAccount();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const read = useQuery({
    queryKey: ["morning", familyId, member],
    enabled:
      apiConfigured() &&
      account.signedIn &&
      familyId !== undefined &&
      member !== undefined &&
      her !== undefined,
    queryFn: async () =>
      fetchMorningPreferences(familyId ?? "", member ?? "", await account.token()),
  });
  const example: ApiMorningPreferences | undefined =
    demo && her !== undefined
      ? {
          member_id: her.memberId,
          display_name: her.displayName,
          time_zone: "Asia/Taipei",
          arrival_time: "08:00",
          today_arrival_time: "08:00",
          effective_from: null,
          language: "en",
        }
      : undefined;
  const data = read.data ?? example;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t`Morning settings`,
          headerLeft: () => <BackButton />,
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          padding: space.margin,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.l,
        }}
      >
        {her === undefined ? (
          <Words>
            <Trans>Choose a parent from You before changing morning settings.</Trans>
          </Words>
        ) : read.isError && data === undefined ? (
          <>
            <Words>
              <Trans>
                Morning settings could not be reached. Your changes have not been saved.
              </Trans>
            </Words>
            <SecondaryButton label={t`Try again`} onPress={() => void read.refetch()} />
          </>
        ) : data === undefined ? (
          <Words>
            <Trans>Loading morning settings…</Trans>
          </Words>
        ) : (
          <MorningForm
            key={`${familyId}:${member}`}
            initial={data}
            familyId={familyId ?? ""}
            demo={demo}
          />
        )}
        <SecondaryButton label={t`Go to You`} onPress={() => router.replace("/(tabs)/you")} />
      </ScrollView>
    </>
  );
}

function MorningForm({
  initial,
  familyId,
  demo,
}: {
  initial: ApiMorningPreferences;
  familyId: string;
  demo: boolean;
}) {
  const { t } = useLingui();
  const { englishOnly } = useCapabilities();
  const account = useAccount();
  const queries = useQueryClient();
  const key = useIdempotencyKey("morning");
  const [time, setTime] = useState(initial.arrival_time);
  const [language, setLanguage] = useState(initial.language);
  const [saved, setSaved] = useState(false);
  const change = useMutation({
    mutationFn: async () => {
      const input = SetMorningPreferences.parse({ arrival_time: time.trim(), language });
      return setMorningPreferences(
        familyId,
        initial.member_id,
        input,
        key(input),
        await account.token(),
      );
    },
    onSuccess: (result) => {
      queries.setQueryData(["morning", familyId, initial.member_id], result);
      setSaved(true);
      void queries.invalidateQueries({ queryKey: ["today"] });
      void queries.invalidateQueries({ queryKey: ["family"] });
    },
  });
  const valid = SetMorningPreferences.safeParse({ arrival_time: time.trim(), language }).success;
  const editTime = (value: string) => {
    if (change.isPending) return;
    setSaved(false);
    setTime(value);
  };
  const editLanguage = (value: "en" | "zh-TW") => {
    if (change.isPending) return;
    setSaved(false);
    setLanguage(value);
  };
  const name = initial.display_name;
  const zone = initial.time_zone;
  const timeAgain = initial.today_arrival_time;
  return (
    <View style={{ gap: space.l }}>
      <Words variant="title">
        <Trans>{name}'s morning</Trans>
      </Words>
      {demo ? (
        <Words tone="ink2">
          <Trans>This is an example. No settings are sent to a family.</Trans>
        </Words>
      ) : null}
      <Words tone="ink2">
        <Trans>
          Times are in {zone}. Today's morning stays at {timeAgain}. A new time starts tomorrow.
        </Trans>
      </Words>
      <TextField
        label={t`Morning time (24-hour HH:MM)`}
        value={time}
        onChangeText={editTime}
        placeholder="08:00"
        disabled={change.isPending}
      />
      {!valid ? (
        <Words tone="ink2">
          <Trans>Enter a time such as 08:30 and choose a supported language.</Trans>
        </Words>
      ) : null}
      <Words variant="heading">
        <Trans>Morning language</Trans>
      </Words>
      <Words tone="ink2">
        <Trans>
          The language applies to future messages. Messages already sent stay as they are.
        </Trans>
      </Words>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        <Chip label="English" selected={language === "en"} onPress={() => editLanguage("en")} />
        {!englishOnly ? (
          <Chip
            label="繁體中文"
            selected={language === "zh-TW"}
            onPress={() => editLanguage("zh-TW")}
          />
        ) : null}
      </View>
      {change.isError ? (
        <Words tone="ink2">
          <Trans>That could not be saved just now. Your changes are still here. Try again.</Trans>
        </Words>
      ) : null}
      {saved ? (
        <Words>
          {demo ? (
            <Trans>Example settings previewed.</Trans>
          ) : (
            <Trans>Morning settings saved.</Trans>
          )}
        </Words>
      ) : null}
      <PrimaryButton
        label={
          change.isPending ? t`Saving…` : demo ? t`Preview settings` : t`Save morning settings`
        }
        disabled={!valid || change.isPending}
        onPress={() => {
          if (demo) setSaved(true);
          else change.mutate();
        }}
      />
      <SecondaryButton
        label={t`Cancel`}
        disabled={change.isPending}
        onPress={() => router.back()}
      />
    </View>
  );
}
