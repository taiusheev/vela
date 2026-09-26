import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExchangePhotos } from "../../src/components/family-photo.tsx";
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
import type { Today, TomorrowTurn } from "../../src/data/today.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useQuiet } from "../../src/data/useQuiet.ts";
import { useToday } from "../../src/data/useToday.ts";
import { readFlag, writeFlag } from "../../src/storage/flags.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, space } from "../../src/theme/tokens.ts";

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
  const { t } = useLingui();
  const asker = exchange.asker;
  const recipient = exchange.recipient;
  const time = exchange.answer?.at;
  return (
    <Card>
      <Eyebrow>
        {asker === undefined ? t`A hello for ${recipient}` : t`${asker} asked ${recipient}`}
      </Eyebrow>
      <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={72} />
      {exchange.ask === undefined ? null : <Words variant="voice">{exchange.ask}</Words>}
      {exchange.answer === undefined ? (
        <Words variant="body" tone="ink2">
          <Trans>No word yet today.</Trans>
        </Words>
      ) : (
        <>
          <Hairline />
          <Words variant="voice">{exchange.answer.text}</Words>
          <Words variant="caption" tone="ink3">
            <Trans>
              {recipient} answered at {time}
            </Trans>
          </Words>
        </>
      )}
      {exchange.replies.length > 0 ? (
        <>
          <Hairline />
          {/* Each reply is its whole line already, with the name inside it. */}
          {exchange.replies.map((reply) => (
            <Words key={`${reply.from}:${reply.text}`} variant="body" tone="ink2">
              {reply.text}
            </Words>
          ))}
        </>
      ) : null}
      {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
    </Card>
  );
}

function TomorrowCard({ tomorrow }: { tomorrow: TomorrowTurn }) {
  const palette = usePalette();
  const { t } = useLingui();
  const by = tomorrow.asked?.by;
  const name = tomorrow.name;
  // Each card names whose morning it is: a family where two keep a light sees two.
  const recipient = tomorrow.recipient;
  // A claimed morning shows the ask that claimed it; only a free one offers a suggestion.
  const suggestion = tomorrow.asked === undefined ? tomorrow.suggestion : undefined;
  const card = (
    <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
      <Eyebrow>
        {tomorrow.asked !== undefined
          ? t`Tomorrow · ${by} asked ${recipient}`
          : tomorrow.pending
            ? t`Tomorrow · ${recipient}`
            : tomorrow.mine
              ? t`Tomorrow · your turn to ask ${recipient}`
              : t`Tomorrow · ${name}'s turn to ask ${recipient}`}
      </Eyebrow>
      {tomorrow.asked !== undefined ? (
        <>
          <Words variant="voice">{tomorrow.asked.text}</Words>
          <Words variant="caption" tone="ink3">
            <Trans>Into her morning.</Trans>
          </Words>
        </>
      ) : suggestion === undefined ? null : (
        <>
          {/* Vela's, as on Ask: without it a suggestion reads like an ask already on its way. */}
          <Words variant="caption" tone="ink2">
            {suggestion.fromHerWords ? (
              <Trans>Vela suggests · from her own words</Trans>
            ) : (
              <Trans>Vela suggests</Trans>
            )}
          </Words>
          <Words variant="voice">{suggestion.text}</Words>
          <Words variant="button" tone="action">
            <Trans>Use this</Trans>
          </Words>
        </>
      )}
    </Card>
  );
  if (suggestion === undefined) return card;
  // The whole card is the way in, as in the prototype. Only ids travel in the route, never her
  // words: Ask reads the suggestion from the same Today, and asks the person it is for.
  return (
    <Pressable
      accessibilityRole="button"
      // A hint, not a label, so a screen reader still reads the suggestion itself.
      accessibilityHint={t`Use this suggestion`}
      hitSlop={hitSlop}
      onPress={() =>
        router.push({
          pathname: "/ask",
          params: { recipient: tomorrow.recipientId, suggestion: suggestion.id },
        })
      }
    >
      {card}
    </Pressable>
  );
}

export default function TodayScreen() {
  const palette = usePalette();
  const { t } = useLingui();
  const [quietOpen, setQuietOpen] = useState(false);
  // How the example notice was settled; its sentence is chosen as it renders, in the language shown.
  const [resolution, setResolution] = useState<"fine" | "wait" | undefined>();
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
  const name = quiet?.displayName ?? t`Mom`;
  const notice = live
    ? liveQuiet.notice
    : {
        ...quietFixtureFor(name),
        resolution:
          resolution === "fine"
            ? t`You said ${name} is fine. Nothing else was sent.`
            : resolution === "wait"
              ? t`Waiting two hours. You will hear again at 13:00 if it is still quiet.`
              : undefined,
      };
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
  const recipient =
    today.lights[0]?.displayName ?? t({ comment: "stands in for her name", message: "her" });

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
          <Trans>Setting up your family…</Trans>
        </Words>
      ) : trouble ? (
        <Words variant="body" tone="ink2">
          <Trans>Today could not be reached just now.</Trans>
        </Words>
      ) : null}
      {today.exchange === undefined ? null : <ExchangeCard exchange={today.exchange} />}
      {today.tomorrow.map((turn) => (
        <TomorrowCard key={turn.recipientId} tomorrow={turn} />
      ))}
      <PrimaryButton label={t`Ask ${recipient} something`} onPress={() => router.push("/ask")} />
      {notice === undefined ? null : (
        <QuietNoticeSheet
          notice={notice}
          visible={quietOpen && (live ? openEventId !== undefined : quiet !== undefined)}
          onFine={() => {
            if (live) liveQuiet.settle("fine");
            else setResolution("fine");
          }}
          onWait={() => {
            if (live) liveQuiet.settle("wait");
            else setResolution("wait");
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
