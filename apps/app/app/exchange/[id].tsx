import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComposeReply, ReactionKind } from "@vela/contracts";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  apiConfigured,
  fetchExchange,
  replyRefusal,
  replyTo,
} from "../../src/api/client.ts";
import { photoRefusal, uploadMedia, uploadVoice } from "../../src/api/upload.ts";
import type { Recorded } from "../../src/audio/useRecording.ts";
import { VoicePlayback } from "../../src/audio/VoicePlayback.tsx";
import { accountsConfigured, useAccount } from "../../src/auth/clerk.tsx";
import { BackButton } from "../../src/components/back-button.tsx";
import { AnswerPanel } from "../../src/components/brand/experience.tsx";
import { ExchangePhotos, ReplyPhoto } from "../../src/components/family-photo.tsx";
import { type ChosenPhoto, PhotoReply } from "../../src/components/photo-reply.tsx";
import {
  Card,
  Chip,
  Eyebrow,
  PrimaryButton,
  ReceiptChip,
  SecondaryButton,
  TextField,
  Words,
} from "../../src/components/ui.tsx";
import { VoiceReply } from "../../src/components/voice-reply.tsx";
import { exchangeFamily } from "../../src/data/exchange-family.ts";
import type { ExchangeReply } from "../../src/data/exchanges.ts";
import { replyLine } from "../../src/data/lines.ts";
import { demoDataAllowed } from "../../src/data/live-state.ts";
import { toExchange, useExchanges } from "../../src/data/useExchanges.ts";
import { useToday } from "../../src/data/useToday.ts";
import { useDraft } from "../../src/storage/useDraft.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

export default function ExchangeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExchangeReader key={id} id={id} />;
}

function ExchangeReader({ id }: { id: string }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const { t } = useLingui();
  const queries = useQueryClient();
  const { exchanges, live } = useExchanges();
  const listed = exchanges.find((candidate) => candidate.id === id);
  // A link or a tapped notice can name an exchange the list has not loaded: it is read on its own.
  const single = useQuery({
    queryKey: ["exchange", id],
    enabled:
      apiConfigured() &&
      account.ready &&
      account.signedIn &&
      listed === undefined &&
      id !== undefined,
    queryFn: async () => toExchange(await fetchExchange(id ?? "", await account.token())),
    retry: false,
  });
  const exchange = listed ?? single.data;
  // What was sent in the demo, as typed or tapped: the line around it is built in the language shown.
  const [sent, setSent] = useState<{ kind: ExchangeReply["kind"]; text?: string }[]>([]);
  // The reactions this reader gave here in this visit, shown chosen; a second tap gives nothing new.
  const [reacted, setReacted] = useState<ReactionKind[]>([]);
  const draft = useDraft(`reply.${id ?? ""}`);
  const { text, setText } = draft;
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const day = useToday();
  const familyId = exchangeFamily(day.familyId, day.today.lights, exchange?.recipientId);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState<"limit" | "trouble" | null>(null);

  const post = useMutation({
    mutationFn: async (reply: ComposeReply) =>
      replyTo(id ?? "", await draft.keyFor(reply), reply, await account.token()),
    // A reaction that did not go through is not shown as given, so it can be tapped again.
    onError: (_error, failed) => {
      if ("reaction" in failed) {
        setReacted((earlier) => earlier.filter((kind) => kind !== failed.reaction));
      }
    },
    onSuccess: async (_reply, sentReply) => {
      if ("text" in sentReply) await draft.clear();
      else await draft.clearAttempt();
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["exchanges"] }),
        queries.invalidateQueries({ queryKey: ["exchange", id] }),
        queries.invalidateQueries({ queryKey: ["today"] }),
      ]);
    },
  });

  if (exchange === undefined) {
    return (
      <>
        <Stack.Screen
          options={{ headerShown: true, title: t`Exchange`, headerLeft: () => <BackButton /> }}
        />
        <View style={{ flex: 1, backgroundColor: palette.bg, padding: space.margin, gap: space.l }}>
          <Words variant="body" tone="ink2">
            {single.isError &&
            !(single.error instanceof ApiError && single.error.status === 404) ? (
              <Trans>That exchange could not be reached just now.</Trans>
            ) : demo || single.isError || (live && !single.isPending) ? (
              <Trans>That exchange is not here.</Trans>
            ) : (
              <Trans>Looking for that exchange…</Trans>
            )}
          </Words>
          {single.isError ? (
            <SecondaryButton label={t`Try again`} onPress={() => void single.refetch()} />
          ) : null}
        </View>
      </>
    );
  }

  const asker = exchange.asker;
  const recipient = exchange.recipient;
  const time = exchange.answer?.at ?? "";
  const you = t`You`;
  const replies = [
    ...exchange.replies,
    ...sent.map(
      (reply, index): ExchangeReply => ({
        id: `local-${index}`,
        from: you,
        kind: reply.kind,
        ...(reply.text === undefined ? {} : { text: reply.text }),
      }),
    ),
  ];
  const answered = exchange.answer !== undefined;
  const words = text.trim();
  const send = () => {
    if (words.length === 0) return;
    if (demo) {
      setSent((earlier) => [...earlier, { kind: "text", text: words }]);
      setText("");
      return;
    }
    post.mutate({ text: words });
  };
  const react = (kind: ReactionKind) => {
    if (reacted.includes(kind)) return;
    setReacted((earlier) => [...earlier, kind]);
    if (demo) {
      setSent((earlier) => [...earlier, { kind }]);
      return;
    }
    post.mutate({ reaction: kind });
  };
  // The voice goes up under its own key, then the reply names it; false keeps it to send again.
  const sendVoice = async (recording: Recorded): Promise<boolean> => {
    if (demo) {
      setSent((earlier) => [...earlier, { kind: "voice" }]);
      return true;
    }
    if (familyId === undefined) return false;
    setVoiceFailed(false);
    try {
      const voice = await uploadVoice(familyId, recording, await account.token());
      await post.mutateAsync({ voice });
      return true;
    } catch {
      setVoiceFailed(true);
      return false;
    }
  };
  // The photo goes up under the key minted when it was chosen, then the reply names it.
  const sendPhoto = async (photo: ChosenPhoto): Promise<boolean> => {
    if (demo) {
      setSent((earlier) => [...earlier, { kind: "photo" }]);
      return true;
    }
    if (familyId === undefined) return false;
    setPhotoFailed(null);
    try {
      const uploaded = await uploadMedia(
        familyId,
        photo.key,
        photo.uri,
        await account.token(),
        () => {},
      );
      await post.mutateAsync({ photo: uploaded.id });
      return true;
    } catch (error) {
      setPhotoFailed(photoRefusal(error) === "limit" ? "limit" : "trouble");
      return false;
    }
  };
  const reactions: { kind: ReactionKind; label: string }[] = [
    { kind: "heart", label: `❤️ ${t`Heart`}` },
    { kind: "laugh", label: `😂 ${t`Laugh`}` },
    { kind: "hug", label: `🤗 ${t`Hug`}` },
  ];

  const refusal = post.isError ? replyRefusal(post.error) : null;
  const trouble =
    refusal === "not_answered"
      ? t`She has not answered yet, so there is nothing to reply to.`
      : refusal === "her_own"
        ? t`This is your own morning; replies are for the family.`
        : post.isError
          ? t`That could not be sent just now. Your words are kept.`
          : voiceFailed
            ? t`That voice could not be sent just now. It is kept to send again.`
            : photoFailed === "limit"
              ? t`Too many photos for now. Try again tomorrow.`
              : photoFailed === "trouble"
                ? t`That photo could not be sent just now. It is kept to send again.`
                : null;
  // What the caption under the composer may promise, which depends on the day (API contract §4).
  const reach =
    exchange.repliesReachHer === true
      ? t`She hears it in her read-back tomorrow morning.`
      : t`The family sees it here. She will not hear it: her mornings read back only her latest day.`;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `${exchange.asker} → ${exchange.recipient}`,
          headerLeft: () => <BackButton />,
        }}
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
        {!demo && familyId === undefined ? (
          <Words variant="body" tone="ink2">
            <Trans>Choose this exchange's family on Today to play or send attachments.</Trans>
          </Words>
        ) : null}
        <Card>
          <Eyebrow>
            {[exchange.day, t`${asker} asked`].filter((part) => part.length > 0).join(" · ")}
          </Eyebrow>
          {demo || familyId !== undefined ? (
            <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size="full" />
          ) : null}
          <Words variant="body" tone="ink2">
            {exchange.ask}
          </Words>
          {exchange.voiceHello === undefined || familyId === undefined ? null : (
            <VoicePlayback
              familyId={familyId}
              mediaId={exchange.voiceHello.id}
              durationMs={exchange.voiceHello.duration_ms}
              expiresAt={exchange.voiceHello.expires_at}
              state={exchange.voiceHello.state}
              ready={exchange.voiceHello.state === "ready"}
              label={t`Listen to the family’s voice ask`}
            />
          )}
          {exchange.deliveryNotice === undefined ? null : (
            <Words variant="bodyMedium">{exchange.deliveryNotice}</Words>
          )}
          {exchange.answer === undefined ? (
            exchange.deliveryNotice === undefined ? (
              <Words variant="body" tone="ink2">
                <Trans>No word yet.</Trans>
              </Words>
            ) : null
          ) : (
            <AnswerPanel>
              <Words variant="voice">{exchange.answer.text}</Words>
              {exchange.answer.photo === undefined || (!demo && familyId === undefined) ? null : (
                <ReplyPhoto photo={exchange.answer.photo} size="full" />
              )}
              {exchange.answer.audio === undefined || familyId === undefined ? null : (
                <VoicePlayback
                  familyId={familyId}
                  mediaId={exchange.answer.audio.id}
                  durationMs={exchange.answer.audio.duration_ms}
                  expiresAt={exchange.answer.audio.expires_at}
                  state={exchange.answer.audio.state}
                  ready={exchange.answer.audio.state === "ready"}
                />
              )}
              <Words variant="caption" tone="ink3">
                <Trans>
                  {recipient} answered at {time}
                </Trans>
              </Words>
              {exchange.answer.original === undefined ? null : (
                <Words variant="body" tone="ink2">
                  {exchange.answer.original}
                </Words>
              )}
            </AnswerPanel>
          )}
          {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
        </Card>

        {/*
          A heart, a laugh or a hug is the same row a Telegram reaction writes; the group's own set
          never removes one given here (API contract §4, "Reactions").
        */}
        {answered ? (
          <View style={{ gap: space.m }}>
            <Words variant="heading">
              <Trans>Reply</Trans>
            </Words>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
              {reactions.map((reaction) => (
                <Chip
                  key={reaction.kind}
                  label={reaction.label}
                  selected={reacted.includes(reaction.kind)}
                  disabled={post.isPending}
                  onPress={() => react(reaction.kind)}
                />
              ))}
            </View>
            <TextField
              label={t`Reply`}
              value={text}
              onChangeText={setText}
              placeholder={t`Say something short`}
              helper={reach}
              multiline
              maxLength={1000}
              disabled={!draft.ready || post.isPending}
            />
            {draft.saveFailed ? (
              <Words variant="body" tone="ink2">
                <Trans>
                  This iPhone could not keep a draft. Leave this screen open until your send
                  succeeds.
                </Trans>
              </Words>
            ) : null}
            {trouble === null ? null : (
              <Words variant="body" tone="ink2">
                {trouble}
              </Words>
            )}
            {draft.savedBody<ComposeReply>() === null ? null : (
              <PrimaryButton
                label={t`Retry saved reply`}
                disabled={post.isPending}
                onPress={() => {
                  const reply = draft.savedBody<ComposeReply>();
                  if (reply !== null) post.mutate(reply);
                }}
              />
            )}
            {draft.savedBody<ComposeReply>() === null ? (
              <PrimaryButton
                label={post.isPending ? t`Sending…` : t`Send`}
                onPress={send}
                disabled={post.isPending || !draft.ready || words.length === 0}
              />
            ) : (
              <SecondaryButton
                label={post.isPending ? t`Sending…` : t`Send`}
                onPress={send}
                disabled={post.isPending || !draft.ready || words.length === 0}
              />
            )}
            <VoiceReply
              disabled={post.isPending || (!demo && familyId === undefined)}
              send={sendVoice}
            />
            <PhotoReply
              disabled={post.isPending || (!demo && familyId === undefined)}
              send={sendPhoto}
            />
          </View>
        ) : (
          <Words variant="body" tone="ink2">
            <Trans>You can reply once she has answered.</Trans>
          </Words>
        )}

        <View style={{ gap: space.m }}>
          <Words variant="heading">
            <Trans>What the family said</Trans>
          </Words>
          {replies.length === 0 ? (
            <Words variant="body" tone="ink3">
              <Trans>Nothing yet.</Trans>
            </Words>
          ) : (
            replies.map((reply) => {
              const from = reply.from;
              return (
                <View key={reply.id} style={{ gap: space.s }}>
                  <Words variant="body" tone="ink2">
                    {replyLine(reply.from, reply.kind, reply.text)}
                  </Words>
                  {reply.photo === undefined || (!demo && familyId === undefined) ? null : (
                    <ReplyPhoto photo={reply.photo} size="full" />
                  )}
                  {reply.audio === undefined || familyId === undefined ? null : (
                    <VoicePlayback
                      familyId={familyId}
                      mediaId={reply.audio.id}
                      durationMs={reply.audio.duration_ms}
                      expiresAt={reply.audio.expires_at}
                      state={reply.audio.state}
                      ready={reply.audio.state === "ready"}
                      label={t`Listen to ${from}’s voice reply`}
                    />
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </>
  );
}
