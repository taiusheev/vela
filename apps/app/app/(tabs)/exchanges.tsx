import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Eyebrow, Hairline, ReceiptChip, Words } from "../../src/components/ui.tsx";
import { type Exchange, exchangesFixture } from "../../src/data/exchanges.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, space } from "../../src/theme/tokens.ts";

function replyLine(exchange: Exchange): string | undefined {
  const words = exchange.replies.map((reply) =>
    reply.reaction === undefined
      ? `${reply.from}: ${reply.text ?? ""}`
      : `${reply.from} sent a ${reply.reaction}`,
  );
  return words.length === 0 ? undefined : words.join(" · ");
}

function ExchangeRow({ exchange, originals }: { exchange: Exchange; originals: boolean }) {
  const answer = exchange.answer;
  const shown = originals ? (answer?.original ?? answer?.text) : answer?.text;
  const replies = replyLine(exchange);
  return (
    <Link href={{ pathname: "/exchange/[id]", params: { id: exchange.id } }} asChild>
      <Pressable accessibilityRole="button" hitSlop={hitSlop}>
        <Card>
          <Eyebrow>{`${exchange.day.toUpperCase()} · ${exchange.asker.toUpperCase()} → ${exchange.recipient.toUpperCase()}`}</Eyebrow>
          <Words variant="voice">{exchange.ask}</Words>
          {shown === undefined ? (
            <Words variant="body" tone="ink2">
              No word yet.
            </Words>
          ) : (
            <>
              <Hairline />
              <Words variant="voice">{shown}</Words>
              <Words variant="caption" tone="ink3">
                {`${exchange.recipient} answered at ${answer?.at ?? ""}${answer?.transcript === true ? " · from her voice note" : ""}`}
              </Words>
            </>
          )}
          {replies === undefined ? null : (
            <Words variant="body" tone="ink2">
              {replies}
            </Words>
          )}
          {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
        </Card>
      </Pressable>
    </Link>
  );
}

export default function ExchangesScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [originals, setOriginals] = useState(false);

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.l,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Words variant="title">Exchanges</Words>
        <Pressable
          accessibilityRole="button"
          hitSlop={hitSlop}
          onPress={() => setOriginals((shown) => !shown)}
        >
          <Words variant="button" tone="action">
            {originals ? "Show translations" : "Show originals"}
          </Words>
        </Pressable>
      </View>
      {exchangesFixture.map((exchange) => (
        <ExchangeRow key={exchange.id} exchange={exchange} originals={originals} />
      ))}
      {/* No infinite scroll: after thirty days the list ends in the family book (spec A8). */}
      <Words variant="body" tone="ink2">
        Older than thirty days lives in the family book.
      </Words>
    </ScrollView>
  );
}
