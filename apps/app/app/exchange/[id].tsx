import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComposeReply } from "@vela/contracts";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, replyRefusal, replyTo } from "../../src/api/client.ts";
import { useIdempotencyKey } from "../../src/api/idempotency.ts";
import { useAccount } from "../../src/auth/clerk.tsx";
import { ExchangePhotos } from "../../src/components/family-photo.tsx";
import {
  Card,
  Eyebrow,
  Hairline,
  PrimaryButton,
  ReceiptChip,
  TextField,
  Words,
} from "../../src/components/ui.tsx";
import type { ExchangeReply } from "../../src/data/exchanges.ts";
import { replyLine } from "../../src/data/lines.ts";
import { useExchanges } from "../../src/data/useExchanges.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

export default function ExchangeScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const { t } = useLingui();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { exchanges, live } = useExchanges();
  const exchange = exchanges.find((candidate) => candidate.id === id);
  // Words sent in the demo, as typed: the line around them is built in the language shown.
  const [sent, setSent] = useState<string[]>([]);
  const [text, setText] = useState("");
  const keyFor = useIdempotencyKey("reply");
  const demo = !apiConfigured();

  const post = useMutation({
    mutationFn: async (reply: ComposeReply) =>
      replyTo(id ?? "", keyFor(reply), reply, await account.token()),
    onSuccess: async () => {
      setText("");
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["exchanges"] }),
        queries.invalidateQueries({ queryKey: ["today"] }),
      ]);
    },
  });

  if (exchange === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, padding: space.margin }}>
        <Words variant="body" tone="ink2">
          {live || demo ? (
            <Trans>That exchange is not here.</Trans>
          ) : (
            <Trans>Looking for that exchange…</Trans>
          )}
        </Words>
      </View>
    );
  }

  const asker = exchange.asker;
  const recipient = exchange.recipient;
  const time = exchange.answer?.at ?? "";
  const you = t`You`;
  const replies = [
    ...exchange.replies,
    ...sent.map(
      (words, index): ExchangeReply => ({
        id: `local-${index}`,
        from: you,
        kind: "text",
        text: words,
      }),
    ),
  ];
  const answered = exchange.answer !== undefined;
  const words = text.trim();
  const send = () => {
    if (words.length === 0) return;
    if (demo) {
      setSent((earlier) => [...earlier, words]);
      setText("");
      return;
    }
    post.mutate({ text: words });
  };

  const refusal = post.isError ? replyRefusal(post.error) : null;
  const trouble =
    refusal === "not_answered"
      ? t`She has not answered yet, so there is nothing to reply to.`
      : refusal === "her_own"
        ? t`This is your own morning; replies are for the family.`
        : post.isError
          ? t`That could not be sent just now. Your words are kept.`
          : null;
  // What the caption under the composer may promise, which depends on the day (API contract §4).
  const reach =
    exchange.repliesReachHer === true
      ? t`She hears it in her read-back tomorrow morning.`
      : t`The family sees it here. She will not hear it: her mornings read back only her latest day.`;

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: `${exchange.asker} → ${exchange.recipient}` }}
      />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <Card>
          <Eyebrow>
            {[exchange.day, t`${asker} asked`].filter((part) => part.length > 0).join(" · ")}
          </Eyebrow>
          <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size="full" />
          <Words variant="voice">{exchange.ask}</Words>
          {exchange.answer === undefined ? (
            <Words variant="body" tone="ink2">
              <Trans>No word yet.</Trans>
            </Words>
          ) : (
            <>
              <Hairline />
              <Words variant="voice">{exchange.answer.text}</Words>
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
            </>
          )}
          {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
        </Card>

        <View style={{ gap: space.m }}>
          <Words variant="heading">
            <Trans>What the family said</Trans>
          </Words>
          {replies.length === 0 ? (
            <Words variant="body" tone="ink3">
              <Trans>Nothing yet.</Trans>
            </Words>
          ) : (
            replies.map((reply) => (
              <Words key={reply.id} variant="body" tone="ink2">
                {replyLine(reply.from, reply.kind, reply.text)}
              </Words>
            ))
          )}
        </View>

        {/*
          Words only. A heart, a laugh or a hug is the same row a Telegram reaction writes, and the
          Telegram path makes a member's reactions equal to their platform set, so one sent from
          here would vanish the next time that member reacted in the group.
        */}
        {answered ? (
          <View style={{ gap: space.m }}>
            <Words variant="heading">
              <Trans>Reply</Trans>
            </Words>
            <TextField
              value={text}
              onChangeText={setText}
              placeholder={t`Say something short`}
              helper={reach}
              multiline
            />
            {trouble === null ? null : (
              <Words variant="body" tone="ink2">
                {trouble}
              </Words>
            )}
            <PrimaryButton
              label={post.isPending ? t`Sending…` : t`Send`}
              onPress={send}
              disabled={post.isPending || words.length === 0}
            />
          </View>
        ) : (
          <Words variant="body" tone="ink2">
            <Trans>You can reply once she has answered.</Trans>
          </Words>
        )}
      </ScrollView>
    </>
  );
}
