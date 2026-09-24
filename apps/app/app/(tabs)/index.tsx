import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
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
import { quietFixtureFor } from "../../src/data/quiet.ts";
import type { Today } from "../../src/data/today.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useQuiet } from "../../src/data/useQuiet.ts";
import { useToday } from "../../src/data/useToday.ts";
import { readFlag, writeFlag } from "../../src/storage/flags.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

function LightsRow({
  lights,
  onQuiet,
}: {
  lights: Today["lights"];
  /** A quiet light opens its notice again, once the sheet that opened by itself was closed. */
  onQuiet: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: space.xl }}>
      {lights.map((light) => (
        <Pressable
          key={light.memberId}
          accessibilityRole={light.state === "quiet" ? "button" : undefined}
          disabled={light.state !== "quiet"}
          onPress={onQuiet}
          style={{ alignItems: "center", gap: space.s }}
        >
          <Light state={light.state} height={40} />
          <Words variant="heading">{light.displayName}</Words>
          <Words variant="caption" tone="ink3">
            {light.stateText}
          </Words>
        </Pressable>
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
  const { today, trouble, noAccount, noFamily, live, organiser, familyId } = useToday();
  // A first run, or an account that belongs to no family yet: onboarding is where that starts (A1).
  useEffect(() => {
    if (noAccount || noFamily) router.replace("/onboarding");
  }, [noAccount, noFamily]);
  const quiet = today.lights.find((light) => light.state === "quiet");
  // The event the sheet opened on stays its own until it is closed: once it is settled, Today no
  // longer shows the light quiet, and the organiser should still read how it was settled.
  const [openEventId, setOpenEventId] = useState<string | undefined>();
  const liveQuiet = useQuiet(openEventId, live && organiser);
  // The sheet opens itself once for each quiet morning (spec A11), and only for the family's
  // organisers, whom the notice is for. Keyed on the event, not the light, which is a new object
  // every time Today is read, so a sheet the organiser closed does not keep coming back.
  const quietKey = quiet === undefined ? undefined : (quiet.quietEventId ?? quiet.memberId);
  const quietEvent = quiet?.quietEventId;
  const mayOpen = !live || organiser;
  const openQuiet = () => {
    if (quietEvent !== undefined) setOpenEventId(quietEvent);
    setQuietOpen(true);
  };
  useEffect(() => {
    if (quietKey !== undefined && mayOpen) {
      if (quietEvent !== undefined) setOpenEventId(quietEvent);
      setQuietOpen(true);
    } else if (quietKey === undefined && !live) {
      setResolution(undefined);
    }
  }, [quietKey, quietEvent, mayOpen, live]);
  const notice = live
    ? liveQuiet.notice
    : { ...quietFixtureFor(quiet?.displayName ?? "Mom"), resolution };
  // A13: the first time an organiser sees her lit with no Vela Light yet, the offer opens, once on
  // this device; You opens it again whenever they want it.
  const lit = today.lights.find((light) => light.state === "lit");
  const plans = useFamily(familyId, live && organiser && lit !== undefined);
  const offerFor =
    live && organiser && plans.live
      ? plans.family.keptLight.find((row) => row.memberId === lit?.memberId && row.plan === "none")
          ?.memberId
      : undefined;
  useEffect(() => {
    if (offerFor === undefined) return;
    let current = true;
    const flag = `light-offered.${offerFor}`;
    void readFlag(flag).then(async (shown) => {
      if (!current || shown) return;
      await writeFlag(flag);
      router.push({ pathname: "/vela-light", params: { member: offerFor } });
    });
    return () => {
      current = false;
    };
  }, [offerFor]);
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
      <LightsRow lights={today.lights} onQuiet={() => (mayOpen ? openQuiet() : undefined)} />
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
      {notice === undefined ? null : (
        <QuietNoticeSheet
          notice={notice}
          visible={quietOpen && (live ? openEventId !== undefined : quiet !== undefined)}
          onFine={() => {
            if (live) liveQuiet.settle("fine");
            else
              setResolution(
                `You said ${quiet?.displayName ?? "Mom"} is fine. Nothing else was sent.`,
              );
          }}
          onWait={() => {
            if (live) liveQuiet.settle("wait");
            else
              setResolution(
                "Waiting two hours. You will hear again at 13:00 if it is still quiet.",
              );
          }}
          onClose={() => {
            setQuietOpen(false);
            setOpenEventId(undefined);
          }}
        />
      )}
    </ScrollView>
  );
}
