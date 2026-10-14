import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Pressable, useWindowDimensions, View } from "react-native";
import { VoicePlayback } from "../audio/VoicePlayback.tsx";
import { localDayMonth } from "../data/format.ts";
import type { Today, TodayExchange, TodayLight } from "../data/today.ts";
import {
  openableExchange,
  parentAnsweredToday,
  todayParentRows,
} from "../data/today-presentation.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Light } from "./light.tsx";
import { TodayHeart } from "./today-heart.tsx";
import { ReceiptChip, Words } from "./ui.tsx";

/** A name, a factual local-day state and that person's words occupy one place on Today. */
export function TodayInbox({
  today,
  familyId,
  onQuiet,
}: {
  today: Today;
  familyId?: string;
  onQuiet?: (light: TodayLight) => void;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  return (
    <View>
      {todayParentRows(today).map((row) => {
        const first = openableExchange(row);
        const light = row.light;
        const name = row.recipient;
        const heading = (
          <>
            <View style={{ flex: 1, gap: space.xs }}>
              <Words variant="heading">{name}</Words>
              {light === undefined ? null : (
                <Words variant="caption" tone="ink2">
                  {light.stateText}
                </Words>
              )}
              {light?.localDate === undefined ? null : (
                <Words variant="caption" tone="ink3">
                  {localDayMonth(light.localDate)}
                </Words>
              )}
            </View>
            {first === undefined ? null : (
              <BrandIcon name="chevron" color={palette.ink2} size={18} />
            )}
          </>
        );
        return (
          <View
            key={row.recipientId}
            testID={`today-parent-${row.recipientId}`}
            style={{
              borderBottomWidth: 1,
              borderColor: palette.rule,
              paddingVertical: space.l,
              flexDirection: "row",
              gap: space.l,
            }}
          >
            {light === undefined ? null : (
              <View style={{ paddingTop: space.xs }}>
                <Light
                  state={light.invited === true ? "resting" : light.state}
                  answered={parentAnsweredToday(light)}
                  height={44}
                />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0, gap: space.s }}>
              {first === undefined ? (
                <View style={{ flexDirection: "row", gap: space.s, minHeight: 48 }}>{heading}</View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t`Open ${name}’s exchange`}
                  onPress={() =>
                    router.push({ pathname: "/exchange/[id]", params: { id: first.id } })
                  }
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.s,
                    minHeight: 48,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  {heading}
                </Pressable>
              )}
              {row.exchanges.map((exchange) => (
                <InboxExchange key={exchange.id} exchange={exchange} familyId={familyId} />
              ))}
              {light?.state === "quiet" && onQuiet !== undefined ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onQuiet(light)}
                  style={{ minHeight: 48, justifyContent: "center" }}
                >
                  <Words variant="button" tone="action">
                    <Trans>Open quiet notice for {name}</Trans>
                  </Words>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function InboxExchange({ exchange, familyId }: { exchange: TodayExchange; familyId?: string }) {
  const palette = usePalette();
  const { fontScale, width } = useWindowDimensions();
  const { t } = useLingui();
  const recipient = exchange.recipient;
  const stacked = fontScale > 1.3 || width < 390;
  const open = () => router.push({ pathname: "/exchange/[id]", params: { id: exchange.id } });
  const preview = (
    <View style={{ gap: space.s }}>
      {exchange.deliveryNotice === undefined ? null : (
        <Words variant="bodyMedium">{exchange.deliveryNotice}</Words>
      )}
      {exchange.answer === undefined ? (
        exchange.unanswered === undefined ? null : (
          <Words variant="body" tone="ink2">
            {exchange.unanswered}
          </Words>
        )
      ) : (
        <Words variant="preview" numberOfLines={fontScale > 1.3 ? undefined : 3}>
          {exchange.answer.text}
        </Words>
      )}
    </View>
  );
  return (
    <View style={{ gap: space.m }}>
      {exchange.deliveryPending === true ? (
        preview
      ) : (
        <Pressable
          testID={`today-open-${exchange.id}`}
          accessibilityRole="button"
          accessibilityLabel={t`Read ${recipient}’s exchange`}
          onPress={open}
          style={({ pressed }) => ({ minHeight: 48, opacity: pressed ? 0.75 : 1 })}
        >
          {preview}
        </Pressable>
      )}
      {exchange.answer?.photo === undefined ? null : (
        <Words variant="caption" tone="ink2">
          <Trans>Photo in this answer</Trans>
        </Words>
      )}
      {exchange.answer?.audio === undefined || familyId === undefined ? null : (
        <VoicePlayback
          familyId={familyId}
          mediaId={exchange.answer.audio.id}
          durationMs={exchange.answer.audio.duration_ms}
          expiresAt={exchange.answer.audio.expires_at}
          state={exchange.answer.audio.state}
          ready={exchange.answer.audio.state === "ready"}
          label={t`Listen to ${recipient}’s answer`}
        />
      )}
      {exchange.answer === undefined || exchange.deliveryPending === true ? null : (
        <View
          style={{
            flexDirection: stacked ? "column" : "row",
            alignItems: "stretch",
            gap: space.s,
          }}
        >
          <Pressable
            testID={`today-reply-${exchange.id}`}
            accessibilityRole="button"
            accessibilityLabel={t`Reply to ${recipient}`}
            onPress={open}
            style={({ pressed }) => ({
              flex: stacked ? undefined : 1,
              minHeight: 48,
              paddingHorizontal: space.m,
              paddingVertical: space.s,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.s,
              borderRadius: radius.button,
              backgroundColor: palette.action,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <BrandIcon name="reply" color={palette.onAction} size={18} />
            <View style={{ flexShrink: 1 }}>
              <Words variant="button" tone="onAction">
                <Trans>Reply</Trans>
              </Words>
            </View>
          </Pressable>
          <TodayHeart id={exchange.id} recipient={recipient} compact />
        </View>
      )}
      {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
    </View>
  );
}
