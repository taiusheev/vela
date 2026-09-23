import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Light } from "../../src/components/light.tsx";
import {
  Card,
  Eyebrow,
  Hairline,
  PrimaryButton,
  ReceiptChip,
  Words,
} from "../../src/components/ui.tsx";
import type { Today } from "../../src/data/today.ts";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

function LightsRow({ lights }: { lights: Today["lights"] }) {
  return (
    <View style={{ flexDirection: "row", gap: space.xl }}>
      {lights.map((light) => (
        <View key={light.memberId} style={{ alignItems: "center", gap: space.s }}>
          <Light state={light.state} height={40} />
          <Words variant="heading">{light.displayName}</Words>
          <Words variant="caption" tone="ink3">
            {light.stateText}
          </Words>
        </View>
      ))}
    </View>
  );
}

function ExchangeCard({ exchange }: { exchange: NonNullable<Today["exchange"]> }) {
  return (
    <Card>
      <Eyebrow>{`${exchange.asker.toUpperCase()} ASKED ${exchange.recipient.toUpperCase()}`}</Eyebrow>
      <Words variant="voice">{exchange.ask}</Words>
      {exchange.answer === undefined ? (
        <Words variant="body" tone="ink2">
          No word yet today.
        </Words>
      ) : (
        <>
          <Hairline />
          <Words variant="voice">{exchange.answer.text}</Words>
          <Words variant="caption" tone="ink3">
            {`${exchange.recipient} answered at ${exchange.answer.at}`}
          </Words>
        </>
      )}
      {exchange.replies.length > 0 ? (
        <>
          <Hairline />
          {exchange.replies.map((reply) => (
            <Words key={`${reply.from}:${reply.text}`} variant="body" tone="ink2">
              {`${reply.from} ${reply.text}`}
            </Words>
          ))}
        </>
      ) : null}
      {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
    </Card>
  );
}

function TomorrowCard({ tomorrow }: { tomorrow: NonNullable<Today["tomorrow"]> }) {
  const palette = usePalette();
  return (
    <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
      <Eyebrow>{`TOMORROW · ${tomorrow.name.toUpperCase()}'S TURN`}</Eyebrow>
      <Words variant="voice">{tomorrow.suggestion}</Words>
      <Words variant="button" tone="action">
        Use this
      </Words>
    </Card>
  );
}

export default function TodayScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { today, trouble } = useToday();
  const recipient = today.lights[0]?.displayName ?? "her";

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      <LightsRow lights={today.lights} />
      {trouble ? (
        <Words variant="body" tone="ink2">
          Today could not be reached just now.
        </Words>
      ) : null}
      {today.exchange === undefined ? null : <ExchangeCard exchange={today.exchange} />}
      {today.tomorrow === undefined ? null : <TomorrowCard tomorrow={today.tomorrow} />}
      <PrimaryButton label={`Ask ${recipient} something`} onPress={() => router.push("/ask")} />
    </ScrollView>
  );
}
