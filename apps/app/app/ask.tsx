import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiAskConflict, ComposeAsk } from "@vela/contracts";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, askConflict, composeAsk } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { photoRefusal, uploadVoice } from "../src/api/upload.ts";
import type { Recorded } from "../src/audio/useRecording.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { PhotoSlots, useAskPhotos } from "../src/components/photo-slots.tsx";
import { PushOffer } from "../src/components/push-offer.tsx";
import {
  Card,
  Chip,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import { VoiceHello } from "../src/components/voice-hello.tsx";
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
import { usePush } from "../src/push/provider.tsx";
import { readFlag, writeFlag } from "../src/storage/flags.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type When = "tomorrow" | "another_day" | "whenever";

/** Remembered once notifications have been offered after an ask, so they are offered only once. */
const OFFERED_AFTER_ASK = "push-offered.after-ask";

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
  const { today, familyId, live, photos: photosOn, organiser, pushSent } = useToday();
  const push = usePush();
  // push (A2): after a person's first ask, someone who does not organise is offered notifications
  // once, in the words of what they would hear: that she answered. Organisers are asked when they
  // set the family up, and on You.
  const [offering, setOffering] = useState(false);
  const offerAfterAsk = async (): Promise<boolean> => {
    const phone = push.phone;
    if (organiser || !pushSent || !push.availability.available) return false;
    if (phone === null || phone.permission === "granted" || !phone.canAskAgain) return false;
    if (await readFlag(OFFERED_AFTER_ASK)) return false;
    await writeFlag(OFFERED_AFTER_ASK);
    return true;
  };
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
  // With none free in her two weeks there is no morning to move to, and the button says so below.
  useEffect(() => {
    if (photos.count === 0 || when !== "whenever") return;
    if (taken === null) setWhen("tomorrow");
    else if (taken.date_alternative !== null) setWhen("another_day");
  }, [photos.count, when, taken]);
  const noMorning = photos.count > 0 && taken !== null && taken.date_alternative === null;
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

  // The voice hello goes up when the ask is sent, under the recording's own key, so a retry of the
  // send uploads it again as the same recording and the ask names it (spec §4).
  const [hello, setHello] = useState<Recorded | null>(null);
  const compose = useMutation({
    mutationFn: async (ask: ComposeAsk) => {
      const token = await account.token();
      const withHello =
        hello === null
          ? ask
          : { ...ask, voice_hello_id: await uploadVoice(familyId ?? "", hello, token) };
      return composeAsk(familyId ?? "", keyFor(withHello), withHello, token);
    },
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["today"] });
      if (await offerAfterAsk()) setOffering(true);
      else router.back();
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
    if (extras === undefined || noMorning) return;
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

  if (offering) {
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
          <Words variant="title">
            <Trans>Into her morning.</Trans>
          </Words>
          <PushOffer
            reason={t`Hear it on this phone when ${name} answers.`}
            onAnswered={() => router.back()}
          />
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Words variant="button" tone="action">
              <Trans>Not now</Trans>
            </Words>
          </Pressable>
        </ScrollView>
      </>
    );
  }

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
        {demo ? null : <VoiceHello onChange={setHello} />}
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
            {photos.count > 0 || hello !== null ? null : (
              <Chip
                label={t`Whenever`}
                selected={when === "whenever"}
                onPress={() => setWhen("whenever")}
              />
            )}
          </View>
          {noMorning ? (
            <Words variant="body" tone="ink2">
              <Trans>
                No morning in the next two weeks is free for a photo ask. Send it as words, or try
                again later.
              </Trans>
            </Words>
          ) : null}
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
          disabled={
            compose.isPending ||
            extras === undefined ||
            noMorning ||
            (!demo && (!ready || !written))
          }
        />
      </ScrollView>
    </>
  );
}
