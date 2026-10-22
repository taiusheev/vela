import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, withdrawAsk } from "../../src/api/client.ts";
import { useIdempotencyKey } from "../../src/api/idempotency.ts";
import { VoicePlayback } from "../../src/audio/VoicePlayback.tsx";
import { accountsConfigured, useAccount } from "../../src/auth/clerk.tsx";
import { AnswerPanel } from "../../src/components/brand/experience.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { ExchangePhotos, ReplyPhoto, ReplyThumbnails } from "../../src/components/family-photo.tsx";
import { QuietNoticeSheet } from "../../src/components/quiet-notice.tsx";
import { RemindersCard } from "../../src/components/reminders.tsx";
import { InboxSheet, TodayFeed, useInbox } from "../../src/components/today-feed.tsx";
import { TodayHeart } from "../../src/components/today-heart.tsx";
import {
  FamilyStatus,
  MorningLight,
  ParentSwitcher,
  SectionTitle,
  SoftCard,
  TodayHeader,
  TodayHero,
  WeekCard,
} from "../../src/components/today-hero.tsx";
import {
  Card,
  Eyebrow,
  IconTile,
  ReceiptChip,
  SecondaryButton,
  Words,
} from "../../src/components/ui.tsx";
import { useAskOutcome } from "../../src/data/ask-outcome.tsx";
import { askRecipient, canAsk } from "../../src/data/ask-target.ts";
import { localDayMonth } from "../../src/data/format.ts";
import { demoDataAllowed } from "../../src/data/live-state.ts";
import { portraitInitials } from "../../src/data/portrait-lamp.ts";
import { quietFixtureFor } from "../../src/data/quiet.ts";
import { selectedLight } from "../../src/data/selected-light.ts";
import {
  quietExampleFixture,
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
import { usePush } from "../../src/push/provider.tsx";
import { readFlag, writeFlag } from "../../src/storage/flags.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, space, type } from "../../src/theme/tokens.ts";

/** Who asked whom, as the exchange names it: on its own card, and in the portrait over her answer. */
function useAskedLine(): (exchange: TodayExchange) => string {
  const { t } = useLingui();
  return (exchange) => {
    const asker = exchange.asker;
    const recipient = exchange.recipient;
    return asker === undefined
      ? t`A hello for ${recipient}`
      : exchange.draftedByVela === true
        ? t`${asker} asked ${recipient} · written by Vela`
        : t`${asker} asked ${recipient}`;
  };
}

function ExchangeCard({
  exchange,
  answerInPortrait = false,
  askInPortrait = false,
}: {
  exchange: TodayExchange;
  answerInPortrait?: boolean;
  /** The portrait above already says who asked and what, while her answer is awaited. */
  askInPortrait?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const { t } = useLingui();
  const palette = usePalette();
  const { familyId } = useToday();
  const askedLine = useAskedLine();
  const recipient = exchange.recipient;
  const time = exchange.answer?.at;
  // Her answer, its ask and the way into the chat are in the portrait above: this card keeps only
  // what the family said back, as a feed; the heart for her answer sits on the answer itself.
  if (answerInPortrait) {
    return (
      <View style={{ gap: space.m }}>
        <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={72} />
        {exchange.answer?.photo === undefined ? null : (
          <ReplyPhoto photo={exchange.answer.photo} size="full" />
        )}
        {exchange.answer?.audio === undefined || familyId === undefined ? null : (
          <VoicePlayback
            familyId={familyId}
            mediaId={exchange.answer.audio.id}
            durationMs={exchange.answer.audio.duration_ms}
            expiresAt={exchange.answer.audio.expires_at}
            state={exchange.answer.audio.state}
            ready={exchange.answer.audio.state === "ready"}
          />
        )}
        <TodayFeed exchange={exchange} familyId={familyId} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.m, paddingBottom: space.xl }}>
      {askInPortrait ? null : <Eyebrow>{askedLine(exchange)}</Eyebrow>}
      {exchange.deliveryNotice === undefined ? null : (
        <Words variant="bodyMedium">{exchange.deliveryNotice}</Words>
      )}
      <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={72} />
      {exchange.ask === undefined || askInPortrait ? null : (
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
          {answerInPortrait ? null : <Words variant="voice">{exchange.answer.text}</Words>}
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
      {exchange.deliveryPending === true ? null : (
        <View
          style={{
            flexDirection: fontScale > 1.3 ? "column" : "row",
            alignItems: "flex-start",
            gap: space.m,
          }}
        >
          <Pressable
            accessibilityRole="button"
            hitSlop={hitSlop}
            onPress={() =>
              router.push(
                exchange.answer === undefined
                  ? { pathname: "/exchange/[id]", params: { id: exchange.id } }
                  : { pathname: "/conversation", params: { recipient: exchange.recipientId } },
              )
            }
            style={{
              flex: fontScale > 1.3 ? undefined : 1,
              alignSelf: "stretch",
              minHeight: 52,
              flexDirection: "row",
              alignItems: "center",
              gap: space.m,
              backgroundColor: exchange.answer === undefined ? palette.actionSoft : palette.action,
              borderRadius: 14,
              paddingHorizontal: space.l,
              paddingVertical: space.s,
            }}
          >
            <IconTile name="reply" tone={exchange.answer === undefined ? "quiet" : "onAction"} />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  type.button,
                  { color: exchange.answer === undefined ? palette.action : palette.onAction },
                ]}
              >
                {exchange.answer === undefined ? (
                  <Trans>Open this exchange</Trans>
                ) : (
                  <Trans>Reply to {recipient}</Trans>
                )}
              </Text>
            </View>
          </Pressable>
          {exchange.answer === undefined ? null : (
            <TodayHeart key={exchange.id} id={exchange.id} recipient={recipient} compact />
          )}
        </View>
      )}
      {exchange.replies.length > 0 ? (
        <SoftCard>
          <FamilyReplies exchange={exchange} familyId={familyId} />
        </SoftCard>
      ) : null}
      {exchange.receipt === undefined ? null : <ReceiptChip label={exchange.receipt} />}
    </View>
  );
}

/** What the family said back to her answer: each reply is its whole line already, with the name. */
function FamilyReplies({
  exchange,
  familyId,
}: {
  exchange: TodayExchange;
  familyId: string | undefined;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  if (exchange.replies.length === 0) return null;
  return (
    <>
      {exchange.replies.map((reply) => (
        <View
          key={`${reply.from}:${reply.text}`}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: space.m }}
        >
          {/* Whose words these are at a glance, as in the family's own chat. */}
          <View
            accessible={false}
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: palette.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={[type.bodyMedium, { fontFamily: type.title.fontFamily, color: palette.ink }]}
            >
              {portraitInitials(reply.from).slice(0, 1)}
            </Text>
          </View>
          <View style={{ flex: 1, paddingTop: 2 }}>
            <Words variant="body" tone="ink2">
              {reply.text}
            </Words>
          </View>
        </View>
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
  );
}

function TomorrowCard({ tomorrow }: { tomorrow: TomorrowTurn }) {
  const { t } = useLingui();
  const by = tomorrow.asked?.by;
  const name = tomorrow.name;
  // Each card names whose morning it is: a family where two keep a light sees two.
  const recipient = tomorrow.recipient;
  // A claimed morning shows the ask that claimed it; only a free one offers a suggestion.
  const suggestion = tomorrow.asked === undefined ? tomorrow.suggestion : undefined;
  const card = (
    <SoftCard>
      <Eyebrow>
        {tomorrow.asked !== undefined
          ? tomorrow.asked.draftedByVela === true
            ? t`Tomorrow · ${by} asks ${recipient} · written by Vela`
            : t`Tomorrow · ${by} asked ${recipient}`
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
          <Words variant="body" tone="ink2">
            {suggestion.text}
          </Words>
          <Words variant="button" tone="action">
            <Trans>Use this</Trans>
          </Words>
        </>
      )}
    </SoftCard>
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
  const { t } = useLingui();
  const askedLine = useAskedLine();
  const [quietOpen, setQuietOpen] = useState(false);
  const [selectedParent, setSelectedParent] = useState<string>();
  // How the example notice was settled; its sentence is chosen as it renders, in the language shown.
  const [resolution, setResolution] = useState<"fine" | "wait" | undefined>();
  // The demo's ask to look in: answered by Lena a moment later, as a neighbour would.
  const [demoAsked, setDemoAsked] = useState<string[]>([]);
  const [demoUseful, setDemoUseful] = useState<boolean | null>(null);
  const insets = useSafeAreaInsets();
  const { capabilities } = useCapabilities();
  const push = usePush();
  const [inboxOpen, setInboxOpen] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (apiConfigured()) day.refresh();
    }, [day.refresh]),
  );
  const { trouble, noAccount, noFamily, live, organiser, familyId } = day;
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
  const inbox = useInbox({
    today,
    familyId: familyId ?? "",
    push,
    onQuiet: mayOpen
      ? (memberId) => {
          const light = today.lights.find((one) => one.memberId === memberId);
          if (light !== undefined) openQuiet(light);
        }
      : undefined,
  });
  const feedback = useAskOutcome();
  const outcome = feedback.outcome?.familyId === familyId ? feedback.outcome : null;
  const outcomeRecipient = outcome?.recipient ?? "";
  const date =
    outcome?.date === null || outcome?.date === undefined ? "" : localDayMonth(outcome.date);
  const focused = selectedLight(today.lights, selectedParent) ?? selectedLight(today.lights);
  const focusedExchange = today.exchanges.find(
    (exchange) => exchange.recipientId === focused?.memberId && exchange.answer !== undefined,
  );
  // While her answer is awaited, the portrait shows what went out to her that morning.
  const waitingExchange =
    focusedExchange === undefined
      ? today.exchanges.find(
          (exchange) =>
            exchange.recipientId === focused?.memberId &&
            exchange.answer === undefined &&
            exchange.ask !== undefined,
        )
      : undefined;
  const portraitExchange = focusedExchange ?? waitingExchange;
  const target = focused ?? askRecipient(today.lights);
  const recipient = target?.displayName ?? t({ comment: "stands in for her name", message: "her" });

  const portraitFamily = familyId === undefined ? "example" : familyId;
  const familyDay = today.exchanges.filter(
    (exchange) => focused === undefined || exchange.recipientId === focused.memberId,
  );
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <MorningLight />
      <ScrollView
        refreshControl={<RefreshControl refreshing={day.loading} onRefresh={day.refresh} />}
        style={{ backgroundColor: "transparent" }}
        contentContainerStyle={{
          paddingTop: insets.top + space.xl,
          paddingBottom: space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <View style={{ gap: space.s }}>
          <TodayHeader
            lights={today.lights}
            familyId={portraitFamily}
            unread={inbox.unread}
            onBell={() => {
              inbox.markSeen();
              setInboxOpen(true);
            }}
          />
        </View>
        <FamilyStatus
          lights={today.lights}
          familyId={portraitFamily}
          onQuiet={mayOpen ? (light) => openQuiet(light) : undefined}
        />
        <FamilyChooser day={day} />
        {day.loading ? (
          <Words variant="body" tone="ink2">
            <Trans>Loading your family’s morning…</Trans>
          </Words>
        ) : null}
        {focused === undefined ? null : (
          <View style={{ gap: space.l }}>
            <ParentSwitcher
              lights={today.lights}
              selected={focused}
              familyId={portraitFamily}
              onSelect={setSelectedParent}
            />
            <TodayHero
              key={focused.memberId}
              selected={focused}
              familyId={portraitFamily}
              onChat={() =>
                router.push({ pathname: "/conversation", params: { recipient: focused.memberId } })
              }
              onAsk={
                canAsk(focused)
                  ? () => router.push({ pathname: "/ask", params: { recipient: focused.memberId } })
                  : undefined
              }
              askDisabled={apiConfigured() && !live}
              onQuiet={focused.state === "quiet" && mayOpen ? () => openQuiet(focused) : undefined}
              answer={focusedExchange?.answer?.text}
              asked={
                portraitExchange === undefined
                  ? undefined
                  : { by: askedLine(portraitExchange), text: portraitExchange.ask }
              }
              heartFor={
                focusedExchange === undefined || focusedExchange.deliveryPending === true
                  ? undefined
                  : focusedExchange.id
              }
              stale={trouble}
            />
          </View>
        )}
        {focused === undefined ? null : <WeekCard />}
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
                  {recipient} has paused their mornings. They can start again in Vela's chat when
                  they are ready.
                </Trans>
              </Words>
            ) : target === undefined ? (
              <>
                <Words variant="body">
                  <Trans>Your family's first parent connection is still being set up.</Trans>
                </Words>
                <SecondaryButton
                  label={t`Go to Settings`}
                  onPress={() => router.push("/settings")}
                />
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
        {familyDay.length === 0 ? null : (
          <SectionTitle
            title={t`Today with the family`}
            link={t`All memories`}
            onLink={() => router.push("/exchanges")}
          />
        )}
        {familyDay.map((exchange) => (
          <ExchangeCard
            key={exchange.id}
            exchange={exchange}
            answerInPortrait={exchange.id === focusedExchange?.id}
            askInPortrait={exchange.id === waitingExchange?.id}
          />
        ))}
        {/* The chat is where the day's words carry on (consumer flow rows 38–52). Her morning
          settings live on You and in the chat's menu, never on the first screen. */}
        {target !== undefined &&
        (target.invited === true || target.connectionDays?.every((day) => !day.hasMessage)) ? (
          <Card>
            <Words variant="heading">
              <Trans>Your first days</Trans>
            </Words>
            <Words tone="ink2">
              <Trans>
                Start with one question in your own words. Choose a morning that suits them.
              </Trans>
            </Words>
            <Words tone="ink2">
              <Trans>
                When they answer, write back while it is on your mind. A quiet day does not erase
                the moments you have shared.
              </Trans>
            </Words>
          </Card>
        ) : null}
        {today.tomorrow
          .filter((turn) => focused === undefined || turn.recipientId === focused.memberId)
          .map((turn) => (
            <TomorrowCard key={turn.recipientId} tomorrow={turn} />
          ))}
        {focused !== undefined || target === undefined || !canAsk(target) ? null : (
          <SecondaryButton
            label={t`Ask ${recipient} something`}
            disabled={apiConfigured() && !live}
            onPress={() =>
              router.push({ pathname: "/ask", params: { recipient: target.memberId } })
            }
          />
        )}
        {capabilities?.memory === true || demoDataAllowed(apiConfigured(), accountsConfigured()) ? (
          <RemindersCard familyId={familyId} />
        ) : null}
        {quietOpen && liveQuiet.trouble && notice === undefined ? (
          <Words variant="body" tone="ink2">
            <Trans>
              The quiet notice could not be reached just now. Contact your parent directly if you
              are concerned.
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
        <InboxSheet items={inbox.items} visible={inboxOpen} onClose={() => setInboxOpen(false)} />
      </ScrollView>
    </View>
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
