import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { startTrial, trialRefusal } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { Light } from "../src/components/light.tsx";
import { Card, PrimaryButton, Words } from "../src/components/ui.tsx";
import { dayMonth } from "../src/data/format.ts";
import { useFamily } from "../src/data/useFamily.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * A13 · Vela Light (spec §14.1, §16): shown once, after her first answer, and again only when
 * opened from You. The trial is thirty days with no card; nothing is charged in the pilot, and the
 * screen says so beside the price the plan will have.
 */
export default function VelaLightScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const queries = useQueryClient();
  const trialKey = useIdempotencyKey("trial");
  const { member } = useLocalSearchParams<{ member?: string }>();
  const { familyId } = useToday();
  const { family, live } = useFamily(familyId, familyId !== undefined);
  const her = family.keptLight.find((row) => row.memberId === member) ?? family.keptLight[0];
  const name = her?.name ?? "Mom";
  const [exampleStarted, setExampleStarted] = useState(false);

  const start = useMutation({
    mutationFn: async () =>
      startTrial(
        family.familyId,
        her?.memberId ?? "",
        trialKey({ member: her?.memberId }),
        await account.token(),
      ),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["family"] });
    },
  });

  // In the example there is nothing to start, so the offer is always the one shown.
  const ends = live
    ? start.data?.trial_ends_at != null
      ? dayMonth(start.data.trial_ends_at)
      : her?.plan === "trial"
        ? her.trialEnds
        : undefined
    : exampleStarted
      ? dayMonth(new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString())
      : undefined;
  const on = ends !== undefined || (live && her?.plan === "active");
  const ended = live && her?.plan === "ended";
  const refusal = trialRefusal(start.error);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xxl,
        paddingHorizontal: space.margin,
        gap: space.l,
        alignItems: "stretch",
      }}
    >
      <Stack.Screen options={{ presentation: "modal" }} />
      <View style={{ alignItems: "center", gap: space.l }}>
        <Light state="lit" height={72} />
        <Words variant="title">{`${name}'s light is on`}</Words>
      </View>

      {on ? (
        <>
          <Words variant="body" tone="ink2">
            {ends === undefined
              ? `Vela Light is on for ${name}.`
              : `Vela Light is on for ${name} until ${ends}. Nothing is charged, and no card was asked for.`}
          </Words>
          <PrimaryButton label="Go to Today" onPress={close} />
        </>
      ) : ended ? (
        <>
          <Words variant="body" tone="ink2">
            {`${name}'s thirty days have ended. The daily ask and the exchanges carry on as before.`}
          </Words>
          <PrimaryButton label="Go to Today" onPress={close} />
        </>
      ) : (
        <>
          <Words variant="body" tone="ink2">
            {`${name} answered. For 30 days, Vela Light is on for free, so you can see what it does before you decide.`}
          </Words>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.m }}>
              <Words variant="bodyMedium">{`Vela Light · for ${name}`}</Words>
              <Words variant="bodyMedium">$79 a year</Words>
            </View>
            <Words variant="caption" tone="ink3">
              or $9.99 a month · a second person +50%
            </Words>
            <Words variant="body" tone="ink2">
              Quiet notices with the people nearby · away mode · the weekly read · memory and
              reminders · the family book to keep
            </Words>
          </Card>
          <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
            <Words variant="bodyMedium">Always free</Words>
            <Words variant="caption" tone="ink2">
              The daily ask, the exchanges, turns, translation, story day, everyone in the family.
            </Words>
          </Card>
          <Words variant="caption" tone="ink3">
            Nothing is charged during the pilot, and no card is asked for.
          </Words>
          {refusal === null ? null : (
            <Words variant="caption" tone="ink2">
              {refusal === "not_answered_yet"
                ? `The 30 days start after ${name}'s first answer.`
                : `${name}'s light is not on.`}
            </Words>
          )}
          {start.isError && refusal === null ? (
            <Words variant="caption" tone="ink2">
              That did not go through. Try again in a moment.
            </Words>
          ) : null}
          <PrimaryButton
            label={start.isPending ? "Starting…" : "Start the 30 days"}
            onPress={() => {
              if (!live) setExampleStarted(true);
              else if (her !== undefined && !start.isPending) start.mutate();
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={{ alignItems: "center", paddingVertical: space.m }}
          >
            <Words variant="button" tone="action">
              Not now
            </Words>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
