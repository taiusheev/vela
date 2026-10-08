import { Trans, useLingui } from "@lingui/react/macro";
import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AnswerPanel, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { FamilyScene } from "../../src/components/brand/scene.tsx";
import { ExchangePhotos, ReplyThumbnails } from "../../src/components/family-photo.tsx";
import { Card, Eyebrow, ReceiptChip, SecondaryButton, Words } from "../../src/components/ui.tsx";
import type { Exchange } from "../../src/data/exchanges.ts";
import { replyLine } from "../../src/data/lines.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
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
          <Words variant="body" tone="ink2">
            {exchange.ask}
          </Words>
          {shown === undefined ? (
            <Words variant="body" tone="ink2">
              <Trans>No word yet.</Trans>
            </Words>
          ) : (
            <AnswerPanel>
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
            </AnswerPanel>
          )}
          {replies === undefined ? null : (
            <Words variant="body" tone="ink2">
              {replies}
            </Words>
          )}
          <ReplyThumbnails photos={exchange.replies.flatMap((reply) => reply.photo ?? [])} />
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
  const { capabilities } = useCapabilities();
  const { exchanges, live, loading, refreshing, refresh, trouble, more, loadMore } = useExchanges();
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  // The switch is offered when something listed was translated for this reader (spec A8).
  const canShowOriginals = exchanges.some((exchange) => exchange.answer?.original !== undefined);

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.l,
      }}
    >
      <View style={{ gap: space.s }}>
        <ScreenHeading title={<Trans context="tab">Exchanges</Trans>} />
        {canShowOriginals ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={hitSlop}
            accessibilityState={{ selected: originals }}
            style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
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
        <View style={{ gap: space.xl, paddingVertical: space.xl }}>
          <FamilyScene kind="letter" width={184} />
          <Words variant="body" tone="ink2">
            <Trans>Nothing has happened yet. Her first morning will be here.</Trans>
          </Words>
        </View>
      ) : null}
      {trouble ? <SecondaryButton label={t`Try again`} onPress={refresh} /> : null}
      {exchanges.map((exchange) => (
        <ExchangeRow key={exchange.id} exchange={exchange} originals={originals} />
      ))}
      {more ? <SecondaryButton label={t`Earlier this month`} onPress={loadMore} /> : null}
      <Words variant="body" tone="ink2">
        <Trans>Exchanges stay here for thirty days.</Trans>
      </Words>
      {capabilities?.book === true ? (
        <SecondaryButton label={t`Family book`} onPress={() => router.push("/book")} />
      ) : null}
    </ScrollView>
  );
}
