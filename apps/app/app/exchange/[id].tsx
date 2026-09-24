import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComposeReply } from "@vela/contracts";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, replyRefusal, replyTo } from "../../src/api/client.ts";
import { useIdempotencyKey } from "../../src/api/idempotency.ts";
import { useAccount } from "../../src/auth/clerk.tsx";
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
import { useExchanges } from "../../src/data/useExchanges.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

function replyWords(reply: ExchangeReply): string {
  return reply.reaction === undefined
    ? `${reply.from}: ${reply.text ?? ""}`
    : `${reply.from} sent a ${reply.reaction}`;
}

/** What the caption under the composer may promise, which depends on the day (API contract §4). */
function reachLine(reachesHer: boolean | undefined): string {
  return reachesHer === true
    ? "She hears it in her read-back tomorrow morning."
    : "The family sees it here. She will not hear it: her mornings read back only her latest day.";
}

export default function ExchangeScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { exchanges, live } = useExchanges();
  const exchange = exchanges.find((candidate) => candidate.id === id);
  const [sent, setSent] = useState<ExchangeReply[]>([]);
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
          {live || demo ? "That exchange is not here." : "Looking for that exchange…"}
        </Words>
      </View>
    );
  }

  const replies = [...exchange.replies, ...sent];
  const answered = exchange.answer !== undefined;
  const words = text.trim();
  const send = () => {
    if (words.length === 0) return;
    if (demo) {
      setSent((earlier) => [
        ...earlier,
        { id: `local-${earlier.length}`, from: "You", text: words },
      ]);
      setText("");
      return;
    }
    post.mutate({ text: words });
  };

  const refusal = post.isError ? replyRefusal(post.error) : null;
  const trouble =
    refusal === "not_answered"
      ? "She has not answered yet, so there is nothing to reply to."
      : refusal === "her_own"
        ? "This is your own morning; replies are for the family."
        : post.isError
          ? "That could not be sent just now. Your words are kept."
          : null;

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
            {[exchange.day, `${exchange.asker} asked`]
              .filter((part) => part.length > 0)
              .join(" · ")
              .toUpperCase()}
          </Eyebrow>
          <Words variant="voice">{exchange.ask}</Words>
          {exchange.answer === undefined ? (
            <Words variant="body" tone="ink2">
              No word yet.
            </Words>
          ) : (
            <>
              <Hairline />
              <Words variant="voice">{exchange.answer.text}</Words>
              <Words variant="caption" tone="ink3">
                {`${exchange.recipient} answered at ${exchange.answer.at}`}
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
          <Words variant="heading">What the family said</Words>
          {replies.length === 0 ? (
            <Words variant="body" tone="ink3">
              Nothing yet.
            </Words>
          ) : (
            replies.map((reply) => (
              <Words key={reply.id} variant="body" tone="ink2">
                {replyWords(reply)}
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
            <Words variant="heading">Reply</Words>
            <TextField
              value={text}
              onChangeText={setText}
              placeholder="Say something short"
              helper={reachLine(exchange.repliesReachHer)}
              multiline
            />
            {trouble === null ? null : (
              <Words variant="body" tone="ink2">
                {trouble}
              </Words>
            )}
            <PrimaryButton
              label={post.isPending ? "Sending…" : "Send"}
              onPress={send}
              disabled={post.isPending || words.length === 0}
            />
          </View>
        ) : (
          <Words variant="body" tone="ink2">
            You can reply once she has answered.
          </Words>
        )}
      </ScrollView>
    </>
  );
}
