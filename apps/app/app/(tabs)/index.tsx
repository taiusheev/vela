import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Light } from "../../src/components/light.tsx";
import { QuietNoticeSheet } from "../../src/components/quiet-notice.tsx";
import {
  Card,
  Eyebrow,
  Hairline,
  PrimaryButton,
  ReceiptChip,
  Words,
} from "../../src/components/ui.tsx";
import { quietFixture } from "../../src/data/quiet.ts";
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
  const recipient = exchange.recipient.toUpperCase();
  return (
    <Card>
      <Eyebrow>
        {exchange.asker === undefined
          ? `A HELLO FOR ${recipient}`
          : `${exchange.asker.toUpperCase()} ASKED ${recipient}`}
      </Eyebrow>
      {exchange.ask === undefined ? null : <Words variant="voice">{exchange.ask}</Words>}
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
      <Eyebrow>
        {tomorrow.asked !== undefined
          ? `TOMORROW · ${tomorrow.asked.by.toUpperCase()} ASKED`
          : tomorrow.mine
            ? "TOMORROW · YOUR TURN"
            : `TOMORROW · ${tomorrow.name.toUpperCase()}'S TURN`}
      </Eyebrow>
      {/* A claimed morning shows the ask that claimed it; only a free one offers a suggestion. */}
      {tomorrow.asked !== undefined ? (
        <>
          <Words variant="voice">{tomorrow.asked.text}</Words>
          <Words variant="caption" tone="ink3">
            Into her morning.
          </Words>
        </>
      ) : tomorrow.suggestion === undefined ? null : (
        <>
          <Words variant="voice">{tomorrow.suggestion}</Words>
          <Words variant="button" tone="action">
            Use this
          </Words>
        </>
      )}
    </Card>
  );
}

export default function TodayScreen() {
  const palette = usePalette();
  const [quietOpen, setQuietOpen] = useState(false);
  const [resolution, setResolution] = useState<string | undefined>();
  const insets = useSafeAreaInsets();
  const { today, trouble, noAccount, noFamily } = useToday();
  // A first run, or an account that belongs to no family yet: onboarding is where that starts (A1).
  useEffect(() => {
    if (noAccount || noFamily) router.replace("/onboarding");
  }, [noAccount, noFamily]);
  const quiet = today.lights.find((light) => light.state === "quiet");
  // The sheet opens itself on a quiet day and closes itself the moment she answers (spec A11).
  useEffect(() => {
    if (quiet !== undefined) setQuietOpen(true);
    else setResolution(undefined);
  }, [quiet]);
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
      {noAccount || noFamily ? (
        <Words variant="body" tone="ink2">
          Setting up your family…
        </Words>
      ) : trouble ? (
        <Words variant="body" tone="ink2">
          Today could not be reached just now.
        </Words>
      ) : null}
      {today.exchange === undefined ? null : <ExchangeCard exchange={today.exchange} />}
      {today.tomorrow === undefined ? null : <TomorrowCard tomorrow={today.tomorrow} />}
      <PrimaryButton label={`Ask ${recipient} something`} onPress={() => router.push("/ask")} />
      <QuietNoticeSheet
        notice={{
          ...quietFixture,
          memberName: quiet?.displayName ?? quietFixture.memberName,
          resolution,
        }}
        visible={quietOpen && quiet !== undefined}
        onFine={() => {
          setResolution("You said she is fine. Nothing else was sent.");
        }}
        onWait={() => {
          setResolution("Waiting two hours. You will hear again at 13:00 if it is still quiet.");
        }}
        onClose={() => setQuietOpen(false)}
      />
    </ScrollView>
  );
}
