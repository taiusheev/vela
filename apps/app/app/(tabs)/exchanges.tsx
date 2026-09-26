import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExchangePhotos } from "../../src/components/family-photo.tsx";
import {
  Card,
  Eyebrow,
  Hairline,
  ReceiptChip,
  SecondaryButton,
  Words,
} from "../../src/components/ui.tsx";
import type { Exchange } from "../../src/data/exchanges.ts";
import { replyLine } from "../../src/data/lines.ts";
import { useExchanges } from "../../src/data/useExchanges.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, space } from "../../src/theme/tokens.ts";

function repliesLine(exchange: Exchange): string | undefined {
  const lines = exchange.replies.map((reply) => replyLine(reply.from, reply.kind, reply.text));
  return lines.length === 0 ? undefined : lines.join(" · ");
}

function ExchangeRow({ exchange, originals }: { exchange: Exchange; originals: boolean }) {
  const answer = exchange.answer;
  const shown = originals ? (answer?.original ?? answer?.text) : answer?.text;
  const replies = repliesLine(exchange);
  const heading = [exchange.day, `${exchange.asker} → ${exchange.recipient}`]
    .filter((part) => part.length > 0)
    .join(" · ");
  const recipient = exchange.recipient;
  const time = answer?.at ?? "";
  return (
    <Link href={{ pathname: "/exchange/[id]", params: { id: exchange.id } }} asChild>
      <Pressable accessibilityRole="button" hitSlop={hitSlop}>
        <Card>
          <Eyebrow>{heading}</Eyebrow>
          <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={72} />
          <Words variant="voice">{exchange.ask}</Words>
          {shown === undefined ? (
            <Words variant="body" tone="ink2">
              <Trans>No word yet.</Trans>
            </Words>
          ) : (
            <>
              <Hairline />
              <Words variant="voice">{shown}</Words>
              <Words variant="caption" tone="ink3">
                {answer?.transcript === true ? (
                  <Trans>
                    {recipient} answered at {time} · from her voice note
                  </Trans>
                ) : (
                  <Trans>
                    {recipient} answered at {time}
                  </Trans>
                )}
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
  const { t } = useLingui();
  const [originals, setOriginals] = useState(false);
  const { exchanges, live, loading, trouble, more, loadMore } = useExchanges();
  // Her originals come from translations the API does not carry yet, so the switch is offered
  // only on the example days, where it has something to show.
  const canShowOriginals = !live;

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
        <Words variant="title">
          <Trans context="tab">Exchanges</Trans>
        </Words>
        {canShowOriginals ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={hitSlop}
            onPress={() => setOriginals((shown) => !shown)}
          >
            <Words variant="button" tone="action">
              {originals ? <Trans>Show translations</Trans> : <Trans>Show originals</Trans>}
            </Words>
          </Pressable>
        ) : null}
      </View>
      {trouble ? (
        <Words variant="body" tone="ink2">
          <Trans>The exchanges could not be reached just now.</Trans>
        </Words>
      ) : loading ? (
        <Words variant="body" tone="ink2">
          <Trans>Looking for your family's days…</Trans>
        </Words>
      ) : live && exchanges.length === 0 ? (
        <Words variant="body" tone="ink2">
          <Trans>Nothing has happened yet. Her first morning will be here.</Trans>
        </Words>
      ) : null}
      {exchanges.map((exchange) => (
        <ExchangeRow key={exchange.id} exchange={exchange} originals={originals} />
      ))}
      {more ? <SecondaryButton label={t`Earlier this month`} onPress={loadMore} /> : null}
      {/* No infinite scroll: after thirty days the list ends in the family book (spec A8). */}
      <Words variant="body" tone="ink2">
        <Trans>Older than thirty days lives in the family book.</Trans>
      </Words>
    </ScrollView>
  );
}
