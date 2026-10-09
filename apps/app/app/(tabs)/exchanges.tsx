import { Trans, useLingui } from "@lingui/react/macro";
import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { FamilyScene } from "../../src/components/brand/scene.tsx";
import { ExchangePhotos } from "../../src/components/family-photo.tsx";
import { Card, ReceiptChip, SecondaryButton, Words } from "../../src/components/ui.tsx";
import type { Exchange } from "../../src/data/exchanges.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useExchanges } from "../../src/data/useExchanges.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, space } from "../../src/theme/tokens.ts";

function ExchangeRow({ exchange, originals }: { exchange: Exchange; originals: boolean }) {
  const palette = usePalette();
  const answer = exchange.answer;
  const shown = originals ? (answer?.original ?? answer?.text) : answer?.text;
  const recipient = exchange.recipient;
  const time = answer?.at ?? "";
  return (
    <Link href={{ pathname: "/exchange/[id]", params: { id: exchange.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        hitSlop={hitSlop}
        style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      >
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
            <View style={{ flex: 1, gap: space.xs }}>
              <Words variant="heading">{recipient}</Words>
              <Words variant="caption" tone="ink2">{`${exchange.day} · ${exchange.asker}`}</Words>
            </View>
            <BrandIcon name="chevron" color={palette.action} size={20} />
          </View>
          <Words variant="body" tone="ink2" numberOfLines={2}>
            {exchange.ask}
          </Words>
          {exchange.deliveryNotice === undefined ? null : (
            <Words variant="bodyMedium">{exchange.deliveryNotice}</Words>
          )}
          <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={56} />
          {shown === undefined ? (
            exchange.deliveryNotice === undefined ? (
              <Words variant="caption" tone="ink2">
                <Trans>No word yet.</Trans>
              </Words>
            ) : null
          ) : (
            <View style={{ gap: space.s }}>
              <Words variant="bodyMedium" numberOfLines={3}>
                {shown}
              </Words>
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
            </View>
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
