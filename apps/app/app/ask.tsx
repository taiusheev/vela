import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiAskConflict, ComposeAsk } from "@vela/contracts";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, askConflict, composeAsk } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import {
  Card,
  Chip,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import {
  type AskType,
  askTypes,
  composableType,
  previewTranslation,
  recipientLanguage,
  suggestionFixture,
} from "../src/data/ask.ts";
import { dayName, useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type When = "tomorrow" | "another_day" | "whenever";

export default function AskScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const { today, familyId, live } = useToday();
  const [kind, setKind] = useState<AskType>("question");
  const [text, setText] = useState("");
  const [when, setWhen] = useState<When>("tomorrow");
  const [taken, setTaken] = useState<ApiAskConflict | null>(null);
  const keyFor = useIdempotencyKey("ask");
  const preview = previewTranslation(text);

  // With no API this screen is the example day and sends nothing. With one, it must wait for the
  // real day: `today` is the fixture until it arrives, and its people are nobody's family.
  const demo = !apiConfigured();
  const lights = demo || live ? today.lights : [];
  // A paused light, or one not yet said yes to, cannot be asked (`canBeAsked`), so the screen offers
  // the first that can, and says why when none can.
  const recipient =
    lights.find((light) => light.state !== "paused" && light.invited !== true) ?? lights[0];
  const paused = recipient !== undefined && recipient.state === "paused";
  const invited = recipient !== undefined && recipient.invited === true;
  const ready =
    demo || (live && familyId !== undefined && recipient !== undefined && !paused && !invited);

  const compose = useMutation({
    mutationFn: async (ask: ComposeAsk) =>
      composeAsk(familyId ?? "", keyFor(ask), ask, await account.token()),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["today"] });
      router.back();
    },
    onError: (error: unknown) => {
      const conflict = askConflict(error);
      if (conflict === null) return;
      setTaken(conflict);
      setWhen(conflict.date_alternative === null ? "whenever" : "another_day");
    },
  });

  function send() {
    if (demo) {
      router.back();
      return;
    }
    const type = composableType[kind];
    // Never a silent close: a screen that is not ready keeps the words and says why below.
    if (!ready || type === undefined || recipient === undefined || familyId === undefined) return;
    const alternative = taken?.date_alternative;
    const timing: Pick<ComposeAsk, "when" | "date"> =
      when === "another_day" && alternative !== null && alternative !== undefined
        ? { when: "date", date: alternative }
        : { when: when === "whenever" ? "whenever" : "tomorrow" };
    compose.mutate({ recipient_id: recipient.memberId, type, text: text.trim(), ...timing });
  }

  const name = recipient?.displayName ?? t({ comment: "stands in for her name", message: "her" });
  const written = text.trim().length > 0;
  const trouble = compose.isError && askConflict(compose.error) === null;
  const waiting = !demo && !ready;
  const hold = waiting
    ? paused
      ? t`${name}'s light is paused just now, so nothing can be sent into her morning.`
      : invited
        ? t`${name} has not said yes yet. Once she does, her first morning is the next day.`
        : t`Waiting for today to arrive. Your words are kept.`
    : null;
  const suggestion = suggestionFixture();
  const language = i18n._(recipientLanguage);
  const holder = taken?.taken_by;
  // Named, never "the day after": the next free morning can be several days out.
  const day = taken?.date_alternative == null ? null : dayName(taken.date_alternative);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t`Ask ${name} something` }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
          <Eyebrow>
            <Trans>Prompt · from her own words</Trans>
          </Eyebrow>
          <Words variant="voice">{suggestion.text}</Words>
          <SecondaryButton label={t`Use this`} onPress={() => setText(suggestion.text)} />
        </Card>

        <View style={{ gap: space.m }}>
          <Words variant="heading">
            <Trans>What are you sending?</Trans>
          </Words>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            {askTypes.map((option) => (
              <Chip
                key={option.kind}
                label={i18n._(option.label)}
                selected={option.kind === kind}
                disabled={!option.available}
                onPress={() => setKind(option.kind)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: space.m }}>
          <TextField
            value={text}
            onChangeText={setText}
            placeholder={t`Say it the way you would say it`}
            helper={t`She reads it in ${language}. One question at a time.`}
            multiline
          />
          {preview.length === 0 ? null : (
            <Card>
              <Eyebrow>
                <Trans>She will see · {language}</Trans>
              </Eyebrow>
              <Words variant="voice">{preview}</Words>
            </Card>
          )}
        </View>

        <View style={{ gap: space.m }}>
          <Words variant="heading">
            <Trans comment="heading over the morning the ask arrives">When</Trans>
          </Words>
          {taken === null ? null : (
            <Words variant="body" tone="ink2">
              <Trans>{holder} already has that morning.</Trans>
            </Words>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            <Chip
              label={t`Tomorrow morning`}
              selected={when === "tomorrow"}
              disabled={taken !== null}
              onPress={() => setWhen("tomorrow")}
            />
            {day === null ? null : (
              <Chip
                label={t`${day} morning`}
                selected={when === "another_day"}
                onPress={() => setWhen("another_day")}
              />
            )}
            <Chip
              label={t`Whenever`}
              selected={when === "whenever"}
              onPress={() => setWhen("whenever")}
            />
          </View>
        </View>

        {hold === null ? null : (
          <Words variant="body" tone="ink2">
            {hold}
          </Words>
        )}
        {trouble ? (
          <Words variant="body" tone="ink2">
            <Trans>That could not be sent just now. Look at Today before sending it again.</Trans>
          </Words>
        ) : null}
        <PrimaryButton
          label={compose.isPending ? t`Sending…` : t`Into her morning`}
          onPress={send}
          disabled={compose.isPending || (!demo && (!ready || !written))}
        />
      </ScrollView>
    </>
  );
}
