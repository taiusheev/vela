import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  Chip,
  Eyebrow,
  Hairline,
  PrimaryButton,
  ReceiptChip,
  TextField,
  Words,
} from "../../src/components/ui.tsx";
import { type ExchangeReply, findExchange, type ReactionKind } from "../../src/data/exchanges.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

const reactions: { kind: ReactionKind; label: string }[] = [
  { kind: "heart", label: "♥ Heart" },
  { kind: "laugh", label: "☺ Laugh" },
  { kind: "hug", label: "◠ Hug" },
];

function replyWords(reply: ExchangeReply): string {
  return reply.reaction === undefined
    ? `${reply.from}: ${reply.text ?? ""}`
    : `${reply.from} sent a ${reply.reaction}`;
}

export default function ExchangeScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const exchange = findExchange(id ?? "");
  const [sent, setSent] = useState<ExchangeReply[]>([]);
  const [reaction, setReaction] = useState<ReactionKind | undefined>();
  const [text, setText] = useState("");

  if (exchange === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, padding: space.margin }}>
        <Words variant="body" tone="ink2">
          That exchange is not here.
        </Words>
      </View>
    );
  }

  const replies = [...exchange.replies, ...sent];
  const send = () => {
    if (reaction === undefined && text.trim().length === 0) return;
    setSent((earlier) => [
      ...earlier,
      { id: `local-${earlier.length}`, from: "You", reaction, text: text.trim() || undefined },
    ]);
    setReaction(undefined);
    setText("");
  };

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
          <Eyebrow>{`${exchange.day.toUpperCase()} · ${exchange.asker.toUpperCase()} ASKED`}</Eyebrow>
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
          {replies.map((reply) => (
            <Words key={reply.id} variant="body" tone="ink2">
              {replyWords(reply)}
            </Words>
          ))}
        </View>

        <View style={{ gap: space.m }}>
          <Words variant="heading">Reply</Words>
          <View style={{ flexDirection: "row", gap: space.s }}>
            {reactions.map((option) => (
              <Chip
                key={option.kind}
                label={option.label}
                selected={reaction === option.kind}
                onPress={() => setReaction(reaction === option.kind ? undefined : option.kind)}
              />
            ))}
          </View>
          <TextField
            value={text}
            onChangeText={setText}
            placeholder="Say something short"
            helper="She hears it in her read-back tomorrow morning."
            multiline
          />
          <PrimaryButton label="Send" onPress={send} />
        </View>
      </ScrollView>
    </>
  );
}
