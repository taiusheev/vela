import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, withdrawAsk } from "../../src/api/client.ts";
import { useIdempotencyKey } from "../../src/api/idempotency.ts";
import { VoicePlayback } from "../../src/audio/VoicePlayback.tsx";
import { accountsConfigured, useAccount } from "../../src/auth/clerk.tsx";
import { AnswerPanel, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { FamilyScene } from "../../src/components/brand/scene.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { ExchangePhotos, ReplyPhoto, ReplyThumbnails } from "../../src/components/family-photo.tsx";
import { Light } from "../../src/components/light.tsx";
import { QuietNoticeSheet } from "../../src/components/quiet-notice.tsx";
import { RemindersCard } from "../../src/components/reminders.tsx";
import {
  Card,
  Eyebrow,
  Hairline,
  PrimaryButton,
  ReceiptChip,
  SecondaryButton,
  Words,
} from "../../src/components/ui.tsx";
import { useAskOutcome } from "../../src/data/ask-outcome.tsx";
import { askRecipient, canAsk } from "../../src/data/ask-target.ts";
import { localDayMonth } from "../../src/data/format.ts";
import { demoDataAllowed } from "../../src/data/live-state.ts";
import { quietFixtureFor } from "../../src/data/quiet.ts";
import {
  quietExampleFixture,
  type Today,
  type TodayExchange,
  type TodayLight,
  type TomorrowTurn,
} from "../../src/data/today.ts";
import { useAway } from "../../src/data/useAway.ts";
import { useCallingNumber } from "../../src/data/useCallingNumber.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useQuiet } from "../../src/data/useQuiet.ts";
import { type TodayView, useToday } from "../../src/data/useToday.ts";
import { readFlag, writeFlag } from "../../src/storage/flags.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, space } from "../../src/theme/tokens.ts";

function LightsRow({
  lights,
  onQuiet,
}: {
  lights: Today["lights"];
  /** A quiet light opens its notice again, once the sheet that opened by itself was closed. */
  onQuiet: (light: TodayLight) => void;
}) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
      {lights.map((light) => (
        <Pressable
          key={light.memberId}
          accessibilityRole={light.state === "quiet" ? "button" : undefined}
          disabled={light.state !== "quiet"}
          onPress={() => onQuiet(light)}
          style={{
            flexGrow: 1,
            flexBasis: 140,
            flexDirection: "row",
            alignItems: "center",
            gap: space.m,
            backgroundColor: palette.surface2,
            padding: space.l,
            borderRadius: 16,
          }}
        >
          <Light state={light.state} height={36} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Words variant="heading">{light.displayName}</Words>
            <Words variant="caption" tone="ink2">
              {light.stateText}
            </Words>
            {light.localDate === undefined ? null : (
              <Words
                variant="caption"
                tone="ink2"
              >{`${light.localDate} · ${light.timeZone ?? ""}`}</Words>
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ExchangeCard({ exchange }: { exchange: TodayExchange }) {
  const { t } = useLingui();
  const palette = usePalette();
  const { familyId } = useToday();
  const asker = exchange.asker;
  const recipient = exchange.recipient;
  const time = exchange.answer?.at;
  return (
    <Card>
      <Eyebrow>
        {asker === undefined ? t`A hello for ${recipient}` : t`${asker} asked ${recipient}`}
      </Eyebrow>
      <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={72} />
      {exchange.ask === undefined ? null : (
        <Words variant="body" tone="ink2">
          {exchange.ask}
        </Words>
      )}
      {exchange.voiceHello === undefined || familyId === undefined ? null : (
        <VoicePlayback
          familyId={familyId}
          mediaId={exchange.voiceHello.id}
          durationMs={exchange.voiceHello.duration_ms}
          expiresAt={exchange.voiceHello.expires_at}
          state={exchange.voiceHello.state}
          ready={exchange.voiceHello.state === "ready"}
          label={t`Listen to the family’s voice ask`}
        />
      )}
      {exchange.answer === undefined ? (
        // Chosen with her light (`toToday`): her day can be answered by words to an earlier ask.
        exchange.unanswered === undefined ? null : (
          <Words variant="body" tone="ink2">
            {exchange.unanswered}
          </Words>
        )
      ) : (
        <AnswerPanel>
          <Words variant="voice">{exchange.answer.text}</Words>
          {exchange.answer.photo === undefined ? null : (
            <ReplyPhoto photo={exchange.answer.photo} size="full" />
          )}
          {exchange.answer.audio === undefined || familyId === undefined ? null : (
            <VoicePlayback
              familyId={familyId}
              mediaId={exchange.answer.audio.id}
              durationMs={exchange.answer.audio.duration_ms}
              expiresAt={exchange.answer.audio.expires_at}
              state={exchange.answer.audio.state}
              ready={exchange.answer.audio.state === "ready"}
            />
          )}
          <Words variant="caption" tone="ink3">
            <Trans>
              {recipient} answered at {time}
            </Trans>
          </Words>
        </AnswerPanel>
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
          <ReplyThumbnails photos={exchange.replies.flatMap((reply) => reply.photo ?? [])} />
          {familyId === undefined
            ? null
            : exchange.replies.flatMap((reply) => {
                const from = reply.from;
                return reply.audio === undefined
                  ? []
                  : [
                      <VoicePlayback
                        key={reply.audio.id}
                        familyId={familyId}
                        mediaId={reply.audio.id}
                        durationMs={reply.audio.duration_ms}
                        expiresAt={reply.audio.expires_at}
                        state={reply.audio.state}
                        ready={reply.audio.state === "ready"}
                        label={t`Listen to ${from}’s voice reply`}
                      />,
                    ];
              })}
        </>
      ) : null}
      {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
      <Pressable
        accessibilityRole="button"
        hitSlop={hitSlop}
        onPress={() => router.push({ pathname: "/exchange/[id]", params: { id: exchange.id } })}
        style={{
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: space.m,
          backgroundColor: palette.actionSoft,
          borderRadius: 12,
          paddingHorizontal: space.l,
        }}
      >
        <BrandIcon name="reply" color={palette.action} size={20} />
        <View style={{ flex: 1 }}>
          <Words variant="button" tone="action">
            {exchange.answer === undefined ? (
              <Trans>Open this exchange</Trans>
            ) : (
              <Trans>Reply to {recipient}</Trans>
            )}
          </Words>
        </View>
        <BrandIcon name="arrow" color={palette.action} size={20} />
      </Pressable>
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
          {tomorrow.asked.withdrawableId === undefined ? null : (
            <WithdrawLink exchangeId={tomorrow.asked.withdrawableId} />
          )}
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
  const day = useToday();
  return <FamilyToday key={day.familyId ?? ""} day={day} />;
}

function FamilyToday({ day }: { day: TodayView }) {
  const palette = usePalette();
  const { t, i18n } = useLingui();
  const [quietOpen, setQuietOpen] = useState(false);
  // How the example notice was settled; its sentence is chosen as it renders, in the language shown.
  const [resolution, setResolution] = useState<"fine" | "wait" | undefined>();
  // The demo's ask to look in: answered by Lena a moment later, as a neighbour would.
  const [demoAsked, setDemoAsked] = useState<string[]>([]);
  const [demoUseful, setDemoUseful] = useState<boolean | null>(null);
  const insets = useSafeAreaInsets();
  const { capabilities } = useCapabilities();
  useFocusEffect(
    useCallback(() => {
      if (apiConfigured()) day.refresh();
    }, [day.refresh]),
  );
  const { trouble, noAccount, noFamily, live, organiser, familyId } = day;
  const time = new Date(day.updatedAt).toLocaleString(i18n.locale, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  // `/?example=quiet` shows the example day gone quiet, only in the demo with no API: a real day,
  // or the fixtures standing in while it loads, is never replaced.
  const { example, quiet: tappedEventId } = useLocalSearchParams<{
    example?: string;
    quiet?: string;
  }>();
  const today =
    demoDataAllowed(apiConfigured(), accountsConfigured()) && example === "quiet"
      ? quietExampleFixture()
      : day.today;
  // A first run, or an account that belongs to no family yet: onboarding is where that starts (A1).
  useEffect(() => {
    if (noAccount || noFamily) router.replace("/onboarding");
  }, [noAccount, noFamily]);
  const quiet = today.lights.find((light) => light.state === "quiet");
  // The event the sheet opened on stays its own until it is closed: once it is settled, Today no
  // longer shows the light quiet, and the organiser should still read how it was settled.
  const [openEventId, setOpenEventId] = useState<string | undefined>();
  // push: a tapped quiet notice names its event (`?quiet=`), which may be of a family Today does not
  // show; the API gives it only to that family's organisers, so the read itself decides. An event
  // that is settled reads as settled, and one the reader may not see opens nothing.
  const [fromTap, setFromTap] = useState(false);
  useEffect(() => {
    if (tappedEventId === undefined || tappedEventId.length === 0) return;
    setOpenEventId(tappedEventId);
    setFromTap(true);
    setQuietOpen(true);
    // Taken once: a later return to Today must not open it again.
    router.setParams({ quiet: undefined });
  }, [tappedEventId]);
  const liveQuiet = useQuiet(openEventId, live && (organiser || fromTap));
  const calling = useCallingNumber(familyId, liveQuiet.memberId);
  // The sheet opens itself once for each quiet morning (spec A11), and only for the family's
  // organisers, whom the notice is for. Keyed on the event, not the light, which is a new object
  // every time Today is read, so a sheet the organiser closed does not keep coming back.
  const quietKey = quiet === undefined ? undefined : (quiet.quietEventId ?? quiet.memberId);
  const quietEvent = quiet?.quietEventId;
  const mayOpen = demoDataAllowed(apiConfigured(), accountsConfigured()) || (live && organiser);
  const openQuiet = (light: TodayLight) => {
    if (light.quietEventId !== undefined) setOpenEventId(light.quietEventId);
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
  const notice = !demoDataAllowed(apiConfigured(), accountsConfigured())
    ? liveQuiet.notice
    : {
        ...quietFixtureFor(name),
        useful: demoUseful,
        contacts: quietFixtureFor(name).contacts.map((contact) =>
          demoAsked.includes(contact.id)
            ? { ...contact, asked: { at: "11:20", reply: "yes" as const } }
            : contact,
        ),
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
    capabilities?.billing === true && live && organiser && plans.live
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
  const feedback = useAskOutcome();
  const outcome = feedback.outcome?.familyId === familyId ? feedback.outcome : null;
  const outcomeRecipient = outcome?.recipient ?? "";
  const date =
    outcome?.date === null || outcome?.date === undefined ? "" : localDayMonth(outcome.date);
  const target = askRecipient(today.lights);
  const recipient = target?.displayName ?? t({ comment: "stands in for her name", message: "her" });

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={day.loading} onRefresh={day.refresh} />}
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      <View style={{ gap: space.s }}>
        <ScreenHeading title={<Trans context="tab">Today</Trans>} />
        {day.updatedAt > 0 ? (
          <Words variant="caption" tone="ink3">{t`Updated ${time}`}</Words>
        ) : null}
      </View>
      <FamilyChooser day={day} />
      {day.loading ? (
        <Words variant="body" tone="ink2">
          <Trans>Loading your family’s morning…</Trans>
        </Words>
      ) : null}
      <LightsRow
        lights={today.lights}
        onQuiet={(light) => (mayOpen ? openQuiet(light) : undefined)}
      />
      {noAccount || noFamily ? (
        <Words variant="body" tone="ink2">
          <Trans>Setting up your family…</Trans>
        </Words>
      ) : trouble ? (
        <Words variant="body" tone="ink2">
          <Trans>Today could not be reached just now.</Trans>
        </Words>
      ) : null}
      {trouble ? <SecondaryButton label={t`Try again`} onPress={day.refresh} /> : null}
      {outcome === null ? null : (
        <Card>
          <Words variant="bodyMedium">
            {outcome.demo
              ? t`You tried an example ask. No message was sent.`
              : outcome.date === null
                ? t`Your ask for ${outcomeRecipient} is waiting for an available morning.`
                : t`Your ask for ${outcomeRecipient} is ready for ${date}.`}
          </Words>
          {outcome.demo ? null : (
            <Words variant="caption" tone="ink2">
              <Trans>It has been accepted. Delivery happens in the parent's morning.</Trans>
            </Words>
          )}
          <SecondaryButton label={t`Dismiss`} onPress={() => feedback.remember(null)} />
        </Card>
      )}
      {!day.loading && !trouble && !noAccount && !noFamily && today.exchanges.length === 0 ? (
        <Card>
          <FamilyScene kind="table" width={152} />
          {target?.invited === true ? (
            <Words variant="body">
              <Trans>
                {recipient} has been invited. Their mornings begin after they say yes in their own
                chat.
              </Trans>
            </Words>
          ) : target?.state === "paused" ? (
            <Words variant="body">
              <Trans>
                {recipient} has paused their mornings. They can start again in Vela's chat when they
                are ready.
              </Trans>
            </Words>
          ) : target === undefined ? (
            <>
              <Words variant="body">
                <Trans>Your family's first parent connection is still being set up.</Trans>
              </Words>
              <SecondaryButton label={t`Go to You`} onPress={() => router.push("/(tabs)/you")} />
            </>
          ) : (
            <Words variant="body">
              <Trans>
                The next morning will appear here once it arrives. You can get an ask ready now.
              </Trans>
            </Words>
          )}
        </Card>
      ) : null}
      {today.lights.flatMap((light) =>
        light.unreachableOn === undefined
          ? []
          : [<LostLine key={`lost:${light.memberId}`} light={light} />],
      )}
      {today.lights.flatMap((light) =>
        light.awayId === undefined ? [] : [<AwayLine key={light.memberId} light={light} />],
      )}
      {today.exchanges.map((exchange) => (
        <ExchangeCard key={exchange.id} exchange={exchange} />
      ))}
      {target === undefined || !canAsk(target) ? null : (
        <PrimaryButton
          label={t`Ask ${recipient} something`}
          disabled={apiConfigured() && !live}
          onPress={() => router.push({ pathname: "/ask", params: { recipient: target.memberId } })}
        />
      )}
      {today.tomorrow.map((turn) => (
        <TomorrowCard key={turn.recipientId} tomorrow={turn} />
      ))}
      {capabilities?.memory === true || demoDataAllowed(apiConfigured(), accountsConfigured()) ? (
        <RemindersCard familyId={familyId} />
      ) : null}
      {quietOpen && liveQuiet.trouble && notice === undefined ? (
        <Words variant="body" tone="ink2">
          <Trans>
            The quiet notice could not be reached just now. Contact your parent directly if you are
            concerned.
          </Trans>
        </Words>
      ) : null}
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
          onAskToLookIn={(contactId) => {
            if (live) liveQuiet.askToLookIn(contactId);
            else setDemoAsked((earlier) => [...earlier, contactId]);
          }}
          asking={live && liveQuiet.asking}
          settling={live && liveQuiet.settling}
          callingNumber={calling.number ?? undefined}
          trouble={live && liveQuiet.trouble}
          onUseful={(value) => {
            if (live) liveQuiet.markUseful(value);
            else setDemoUseful(value);
          }}
          onClose={() => {
            setQuietOpen(false);
            setOpenEventId(undefined);
            setFromTap(false);
          }}
        />
      )}
    </ScrollView>
  );
}

/** Her away on Today (spec §8): what it is, and "She's back", which any member may tap. */
function AwayLine({ light }: { light: TodayLight }) {
  const { t } = useLingui();
  const { familyId } = useToday();
  const { end } = useAway(familyId);
  const name = light.displayName;
  const day = light.awayUntil;
  return (
    <Card>
      <Words variant="body" tone="ink2">
        {day === undefined ? (
          <Trans>
            {name} is away until she's back. Her mornings still come; nobody is told they went
            quiet.
          </Trans>
        ) : (
          <Trans>
            {name} is away until {day}. Her mornings still come; nobody is told they went quiet.
          </Trans>
        )}
      </Words>
      <SecondaryButton
        label={end.isPending ? t`Saving…` : t`${name} is back`}
        disabled={end.isPending}
        onPress={() => {
          if (light.awayId !== undefined) end.mutate(light.awayId);
        }}
      />
      {end.isError ? (
        <Words variant="body" tone="ink2">
          <Trans>That change did not go through. Try again.</Trans>
        </Words>
      ) : null}
    </Card>
  );
}

/**
 * Vela can no longer reach her on her messenger (spec §19, "we lost Mom's Telegram"): she blocked
 * Vela's chat or left it. Her light waits without a quiet notice. What brings her back is hers to
 * do, so the card says what the family can ask of her, or offers her own phone instead.
 */
function LostLine({ light }: { light: TodayLight }) {
  const name = light.displayName;
  const channel = light.unreachableOn;
  return (
    <Card>
      <Words variant="bodyMedium">
        <Trans>
          Vela cannot reach {name} on {channel}
        </Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>
          She may have blocked Vela's chat or changed phones. Until then her mornings cannot reach
          her, and nobody is told they went quiet. Ask her to open Vela's chat on {channel} and tap
          Start or Unblock, and her mornings come back.
        </Trans>
      </Words>
    </Card>
  );
}

/** "Take it back" under the reader's own ask, until her morning is prepared (spec §19). */
function WithdrawLink({ exchangeId }: { exchangeId: string }) {
  const account = useAccount();
  const queries = useQueryClient();
  const keyFor = useIdempotencyKey("withdraw");
  const withdraw = useMutation({
    mutationFn: async () => withdrawAsk(exchangeId, keyFor({ exchangeId }), await account.token()),
    onSettled: async () => {
      await queries.invalidateQueries({ queryKey: ["today"] });
    },
  });
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
      disabled={withdraw.isPending}
      onPress={() => withdraw.mutate()}
    >
      <Words variant="button" tone="action">
        {withdraw.isError ? (
          <Trans>Her morning already holds it.</Trans>
        ) : (
          <Trans>Take it back</Trans>
        )}
      </Words>
    </Pressable>
  );
}
