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
import { TimeStepper } from "../src/components/time-stepper.tsx";
import { Chip, PrimaryButton, SecondaryButton, Words } from "../src/components/ui.tsx";
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
          send_as_me_available: true,
          send_as_me: false,
          sent_as: null,
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
          <>
            <Words>
              <Trans>Choose a parent in Settings before changing morning settings.</Trans>
            </Words>
            <SecondaryButton
              label={t`Go to Settings`}
              onPress={() => router.replace("/settings")}
            />
          </>
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
            invited={her.invited === true}
          />
        )}
      </ScrollView>
    </>
  );
}

function MorningForm({
  initial,
  familyId,
  demo,
  invited,
}: {
  initial: ApiMorningPreferences;
  familyId: string;
  demo: boolean;
  invited: boolean;
}) {
  const { t } = useLingui();
  const { englishOnly } = useCapabilities();
  const account = useAccount();
  const queries = useQueryClient();
  const key = useIdempotencyKey("morning");
  const [time, setTime] = useState(initial.arrival_time);
  const [language, setLanguage] = useState(initial.language);
  const [asMe, setAsMe] = useState(initial.send_as_me === true);
  const [saved, setSaved] = useState(false);
  // Only an environment that allows it hears the choice; elsewhere the field stays out, as older
  // apps leave it, and nothing changes.
  const choice = initial.send_as_me_available === true ? { send_as_me: asMe } : {};
  const change = useMutation({
    mutationFn: async () => {
      const input = SetMorningPreferences.parse({
        arrival_time: time.trim(),
        language,
        ...choice,
      });
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
  const valid = SetMorningPreferences.safeParse({
    arrival_time: time.trim(),
    language,
    ...choice,
  }).success;
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
  const editAsMe = (value: boolean) => {
    if (change.isPending) return;
    setSaved(false);
    setAsMe(value);
  };
  const name = initial.display_name;
  const otherSigner = initial.sent_as ?? null;
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
        {invited ? (
          <Trans>Choose a time in {zone}. Everything waits until they accept the invitation.</Trans>
        ) : (
          <Trans>
            Times are in {zone}. Today's morning stays at {timeAgain}. A new time starts tomorrow.
          </Trans>
        )}
      </Words>
      <TimeStepper
        label={t`Morning time`}
        value={time}
        onChange={editTime}
        disabled={change.isPending}
      />
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
      {initial.send_as_me_available === true ? (
        <>
          <Words variant="heading">
            <Trans>When nobody writes</Trans>
          </Words>
          <Words tone="ink2">
            <Trans>
              If nobody in the family writes {name} a question for the morning, Vela can send the
              one it drafted in your style, signed with your name. You will see it marked “written
              by Vela”.
            </Trans>
          </Words>
          {otherSigner !== null && !asMe ? (
            <Words tone="ink2">
              <Trans>
                {otherSigner} has this on now, so Vela’s question goes in their name. Choosing your
                name here uses yours instead.
              </Trans>
            </Words>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            <Chip label={t`Send it as me`} selected={asMe} onPress={() => editAsMe(true)} />
            <Chip label={t`Vela signs it`} selected={!asMe} onPress={() => editAsMe(false)} />
          </View>
        </>
      ) : null}
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
    </View>
  );
}
