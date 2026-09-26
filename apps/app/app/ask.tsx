import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiAskConflict, ComposeAsk } from "@vela/contracts";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, askConflict, composeAsk } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { photoRefusal } from "../src/api/upload.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { PhotoSlots, useAskPhotos } from "../src/components/photo-slots.tsx";
import {
  Card,
  Chip,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import { freshVoteOptions, type VoteOption, VoteOptions } from "../src/components/vote-options.tsx";
import {
  type AskType,
  askTypes,
  composableType,
  previewTranslation,
  recipientLanguage,
  suggestedKind,
} from "../src/data/ask.ts";
import { askExtras, photoCount } from "../src/data/photos.ts";
import type { TodayLight, TomorrowSuggestion } from "../src/data/today.ts";
import { dayName, useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type When = "tomorrow" | "another_day" | "whenever";

/** A paused light, or one not yet said yes to, cannot be asked (`canBeAsked`). */
function askable(light: TodayLight): boolean {
  return light.state !== "paused" && light.invited !== true;
}

export default function AskScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const { today, familyId, live, photos: photosOn } = useToday();
  const params = useLocalSearchParams<{ recipient?: string; suggestion?: string }>(); // suggestion
  const [kind, setKind] = useState<AskType>("question");
  const [text, setText] = useState("");
  const [when, setWhen] = useState<When>("tomorrow");
  const [taken, setTaken] = useState<ApiAskConflict | null>(null);
  // A vote's options and a photo ask's photos (ADR-33), and what they add to the ask when sent.
  const [options, setOptions] = useState<VoteOption[]>(freshVoteOptions);
  const photos = useAskPhotos({
    kind,
    familyId,
    demo: !apiConfigured(),
    on: photosOn,
    known: live,
    text,
    setText,
  });
  const optionWords = options.map((option) => option.text);
  const extras = askExtras(kind, photos.slots, optionWords);
  // A photo ask names its morning (B1): Whenever is not offered, and moves to the next one there is.
  useEffect(() => {
    if (photos.count === 0 || when !== "whenever") return;
    setWhen(taken === null ? "tomorrow" : "another_day");
  }, [photos.count, when, taken]);
  const [used, setUsed] = useState<{ id: string; recipientId: string } | undefined>(); // suggestion
  const keyFor = useIdempotencyKey("ask");
  const preview = previewTranslation(text);

  // With no API this screen is the example day and sends nothing. With one, it must wait for the
  // real day: `today` is the fixture until it arrives, and its people are nobody's family.
  const demo = !apiConfigured();
  const lights = demo || live ? today.lights : [];
  // The screen asks the person Today's card was for when she can be asked, and otherwise the first
  // who can; it says why when nobody can.
  const recipient =
    lights.find((light) => light.memberId === params.recipient && askable(light)) ??
    lights.find(askable) ??
    lights[0];
  // Vela's suggestion for her own morning, and never another's (a claimed morning has none).
  const suggestion = (demo || live ? today.tomorrow : []).find(
    (turn) => turn.recipientId === recipient?.memberId && turn.asked === undefined,
  )?.suggestion;
  // suggestion: a used one goes with the ask only while its person is the one being asked.
  const usedSuggestionId =
    used !== undefined && used.recipientId === recipient?.memberId ? used.id : undefined;
  // "Use this": the suggestion's words and its kind, remembered with whose morning it was for.
  const fill = useCallback((chosen: TomorrowSuggestion, recipientId: string) => {
    setText(chosen.text);
    setKind(suggestedKind(chosen.type));
    setUsed({ id: chosen.id, recipientId });
  }, []);
  // Today's card sends its suggestion along. The live day can arrive after the screen opens, so it
  // fills the field once, when it is there, and never over words already typed.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || recipient === undefined || suggestion === undefined) return;
    if (suggestion.id !== params.suggestion) return;
    offered.current = true;
    if (text.trim().length === 0) fill(suggestion, recipient.memberId);
  }, [recipient, suggestion, params.suggestion, text, fill]);
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
      if (photos.refusedAsk(error)) return;
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
    if (extras === undefined) return;
    const alternative = taken?.date_alternative;
    const timing: Pick<ComposeAsk, "when" | "date"> =
      when === "another_day" && alternative !== null && alternative !== undefined
        ? { when: "date", date: alternative }
        : { when: when === "whenever" ? "whenever" : "tomorrow" };
    compose.mutate({
      recipient_id: recipient.memberId,
      type,
      text: text.trim(),
      ...timing,
      ...(usedSuggestionId === undefined ? {} : { suggestion_id: usedSuggestionId }), // suggestion
      ...extras,
    });
  }

  const name = recipient?.displayName ?? t({ comment: "stands in for her name", message: "her" });
  const written = text.trim().length > 0;
  const trouble =
    compose.isError &&
    askConflict(compose.error) === null &&
    photoRefusal(compose.error) !== "missing";
  const waiting = !demo && !ready;
  const hold = waiting
    ? paused
      ? t`${name}'s light is paused just now, so nothing can be sent into her morning.`
      : invited
        ? t`${name} has not said yes yet. Once she does, her first morning is the next day.`
        : t`Waiting for today to arrive. Your words are kept.`
    : null;
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
        {/* Live with no suggestion for her morning, there is no card. */}
        {suggestion === undefined || recipient === undefined ? null : (
          <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
            <Eyebrow>
              {suggestion.fromHerWords ? (
                <Trans>Vela suggests · from her own words</Trans>
              ) : (
                <Trans>Vela suggests</Trans>
              )}
            </Eyebrow>
            <Words variant="voice">{suggestion.text}</Words>
            <SecondaryButton
              label={t`Use this`}
              onPress={() => fill(suggestion, recipient.memberId)}
            />
          </Card>
        )}

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
                disabled={!option.available || (photos.off && photoCount(option.kind) > 0)}
                onPress={() => setKind(option.kind)}
              />
            ))}
          </View>
          {photos.explain ? (
            <Words variant="caption" tone="ink3">
              <Trans>Photos are not switched on here yet.</Trans>
            </Words>
          ) : null}
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
        <PhotoSlots photos={photos} />
        {kind === "vote" ? <VoteOptions options={options} onChange={setOptions} /> : null}

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
            {photos.count > 0 ? null : (
              <Chip
                label={t`Whenever`}
                selected={when === "whenever"}
                onPress={() => setWhen("whenever")}
              />
            )}
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
          disabled={compose.isPending || extras === undefined || (!demo && (!ready || !written))}
        />
      </ScrollView>
    </>
  );
}
