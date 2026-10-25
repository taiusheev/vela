import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ComposeAsk } from "@vela/contracts";
import { ASK_BANK, type AskBankLang } from "@vela/copy";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, composeAsk, replyTo } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { BrandIcon } from "../src/components/brand/icon.tsx";
import { ActionSheet, type SheetAction } from "../src/components/chat/action-sheet.tsx";
import { ChatBubble, DayChip } from "../src/components/chat/chat-bubble.tsx";
import { ChatComposer } from "../src/components/chat/chat-composer.tsx";
import { Light } from "../src/components/light.tsx";
import { SecondaryButton, Words } from "../src/components/ui.tsx";
import { canAsk } from "../src/data/ask-target.ts";
import {
  type ChatMessage,
  type ChatReactionKind,
  chatFixture,
  dayLabel,
  localDateIn,
  newestMine,
  type PendingChatMessage,
  pendingHasArrived,
  showsStatus,
  showsTime,
  startsGroup,
  toChat,
} from "../src/data/chat.ts";
import { clockTime } from "../src/data/format.ts";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { selectedLight } from "../src/data/selected-light.ts";
import { useCallingNumber } from "../src/data/useCallingNumber.ts";
import { useExchanges } from "../src/data/useExchanges.ts";
import { usePullRefresh } from "../src/data/usePullRefresh.ts";
import { useToday } from "../src/data/useToday.ts";
import { clearShownAbout } from "../src/push/notifications.ts";
import { useDraft } from "../src/storage/useDraft.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { hitSlop, radius, space, type } from "../src/theme/tokens.ts";

const UNLINKED = "pending";

/**
 * The chat with one parent (consumer flow, rows 39–52): her messages, the family's, and the reader's
 * own, in order, with words that go to her messenger now. Her daily morning keeps its own rhythm;
 * "+" leaves something for it instead. Built from the family's exchanges, so a reply she sends to a
 * message from here lands under it (flows §3.9).
 */
export default function ConversationScreen() {
  const { recipient } = useLocalSearchParams<{ recipient?: string }>();
  const day = useToday();
  return <Conversation key={`${day.familyId ?? UNLINKED}:${recipient ?? UNLINKED}`} />;
}

/** Three of the bank's questions in the family's voice, changing by the day, to start with. */
function starters(lang: AskBankLang): string[] {
  const questions = ASK_BANK.filter((item) => item.type === "question");
  const offset = Math.floor(Date.now() / 86_400_000) % questions.length;
  return [0, 7, 14].flatMap((step) => {
    const item = questions[(offset + step) % questions.length];
    return item === undefined ? [] : [item.child[lang]];
  });
}

function Conversation() {
  const { recipient } = useLocalSearchParams<{ recipient?: string }>();
  const { suggestion } = useLocalSearchParams<{ suggestion?: string }>();
  const day = useToday();
  const light = selectedLight(day.today.lights, recipient);
  const account = useAccount();
  const queries = useQueryClient();
  const [watching, setWatching] = useState(false);
  const history = useExchanges(watching);
  const pull = usePullRefresh(history.refresh);
  useFocusEffect(
    useCallback(() => {
      setWatching(true);
      return () => setWatching(false);
    }, []),
  );
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const inlineComposer = fontScale > 1.3;
  const scroll = useRef<ScrollView>(null);
  const following = useRef(true);
  const { t, i18n } = useLingui();
  const lang: AskBankLang = i18n.locale === "zh-TW" ? "zh-TW" : "en";
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const draft = useDraft(`conversation.${day.familyId ?? UNLINKED}.${light?.memberId ?? UNLINKED}`);
  const offered = useRef(false);
  useEffect(() => {
    if (!draft.ready || offered.current || suggestion === undefined) return;
    offered.current = true;
    // An existing unfinished message always takes priority over an offered starting point.
    if (!draft.text) draft.setText(suggestion);
  }, [draft.ready, draft.text, draft.setText, suggestion]);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"more" | "menu" | null>(null);
  // What the reader sent in the demo, and the words of a send still on its way.
  const [demoSent, setDemoSent] = useState<ChatMessage[]>([]);
  const [demoReactions, setDemoReactions] = useState<Record<string, ChatReactionKind[]>>({});
  // The words of a send on its way: "sending" until Vela has them, then "sent" until the
  // conversation, read again, holds them itself (so they never blink out in between).
  const [pending, setPending] = useState<PendingChatMessage[]>([]);
  const sending = useRef(false);
  const calling = useCallingNumber(day.familyId, light?.memberId);
  const reactKey = useIdempotencyKey("chat-reaction");
  const herId = light?.memberId;
  useFocusEffect(
    useCallback(() => {
      history.refresh();
      day.refresh();
      if (herId !== undefined) void clearShownAbout(herId);
    }, [history.refresh, day.refresh, herId]),
  );
  const name = light?.displayName ?? t`Your parent`;
  const invited = light?.invited === true;

  const send = useMutation({
    mutationFn: async ({ text }: { text: string; localId: string }) => {
      if (demo) return { when: "now", id: undefined };
      if (day.familyId === undefined || light === undefined) throw new Error("No recipient");
      const body = {
        recipient_id: light.memberId,
        type: "question" as const,
        when: invited ? ("whenever" as const) : ("now" as const),
        text,
      };
      const saved = draft.savedBody<ComposeAsk>();
      const request = ComposeAsk.parse(
        saved?.text === body.text && saved?.recipient_id === body.recipient_id ? saved : body,
      );
      const [key, token] = await Promise.all([draft.keyFor(request), account.token()]);
      const accepted = await composeAsk(day.familyId, key, request, token);
      return { when: request.when, id: accepted.id };
    },
    onMutate: ({ text, localId }) => {
      setNote(null);
      setPending((earlier) => [
        ...earlier,
        {
          localId,
          text,
          status: "sending",
          since: Date.now(),
          existingIds: history.summaries.map((summary) => summary.id),
        },
      ]);
      following.current = true;
    },
    onSuccess: async (accepted, { text: words, localId }) => {
      // Vela has it now: say so at once, and read the conversation again without waiting on it.
      setPending((current) =>
        current.map((message) =>
          message.localId === localId
            ? {
                ...message,
                status: "sent",
                ...(accepted.id === undefined ? {} : { exchangeId: accepted.id }),
              }
            : message,
        ),
      );
      await draft.clear().catch(() => {});
      if (demo) {
        const now = new Date();
        setDemoSent((earlier) => [
          ...earlier,
          {
            key: `demo:${earlier.length}`,
            exchangeId: `demo:${earlier.length}`,
            side: "me",
            from: "Mia",
            at: now.getTime(),
            day: localDateIn(now.getTime()),
            time: clockTime(now.getHours(), now.getMinutes()),
            text: words,
            status: "delivered",
            reactions: [],
          },
        ]);
        setNote(t`Example only. Nothing was sent.`);
      } else if (accepted.when === "whenever") {
        setNote(
          t`Saved. The first message waiting reaches ${name} the moment they say yes; the rest come with their mornings.`,
        );
      }
      if (demo) setPending((current) => current.filter((message) => message.localId !== localId));
      void queries.invalidateQueries({ queryKey: ["exchanges"] });
      void queries.invalidateQueries({ queryKey: ["today"] });
    },
    onError: (_error, { localId }) =>
      setPending((current) => current.filter((message) => message.localId !== localId)),
    onSettled: () => {
      sending.current = false;
    },
  });

  const react = useMutation({
    mutationFn: async ({ exchangeId, kind }: { exchangeId: string; kind: ChatReactionKind }) => {
      if (demo) return;
      await replyTo(
        exchangeId,
        reactKey({ exchangeId, kind }),
        { reaction: kind },
        await account.token(),
      );
    },
    onSuccess: async (_done, { exchangeId, kind }) => {
      if (demo) {
        setDemoReactions((earlier) => ({
          ...earlier,
          [exchangeId]: [...(earlier[exchangeId] ?? []), kind],
        }));
        return;
      }
      await queries.invalidateQueries({ queryKey: ["exchanges"] });
    },
    onError: () => setNote(t`That could not be sent just now. Try again in a moment.`),
  });

  const canSend =
    light !== undefined &&
    (demo || day.live) &&
    light.state !== "paused" &&
    light.unreachableOn === undefined;

  const built: ChatMessage[] =
    light === undefined
      ? []
      : demo
        ? [...chatFixture(name), ...demoSent]
        : toChat(
            history.summaries,
            light.memberId,
            {
              ...(day.memberId === undefined ? {} : { id: day.memberId }),
            },
            light.timeZone,
          );
  // A demo heart shows as given, on her last message of that exchange.
  const messages = built.map((message) => {
    const given = demoReactions[message.exchangeId];
    if (given === undefined || message.side !== "her") return message;
    const lastOfExchange = built
      .filter((m) => m.exchangeId === message.exchangeId && m.side === "her")
      .at(-1);
    return lastOfExchange?.key !== message.key
      ? message
      : {
          ...message,
          reactions: [
            ...message.reactions,
            ...given.map((kind) => ({ kind, from: "Mia", mine: true })),
          ],
        };
  });
  const outstanding = pending.filter((message) => !pendingHasArrived(message, built));
  useEffect(() => {
    if (outstanding.length !== pending.length) {
      const arrived = pending.filter((message) => !outstanding.includes(message));
      setPending((current) =>
        current.filter((message) => !arrived.some((sent) => sent.localId === message.localId)),
      );
    }
  }, [outstanding, pending]);
  for (const message of outstanding) {
    const date = new Date(message.since);
    messages.push({
      key: message.localId,
      exchangeId: message.exchangeId ?? message.localId,
      side: "me",
      from: "",
      at: message.since,
      day: localDateIn(message.since, light?.timeZone),
      time: clockTime(date.getHours(), date.getMinutes()),
      text: message.text,
      status: message.status,
      reactions: [],
    });
  }
  const today = localDateIn(Date.now(), demo ? undefined : light?.timeZone);

  const moreActions: SheetAction[] =
    light === undefined || !canAsk(light)
      ? []
      : [
          {
            icon: "ask",
            label: t`A question for her morning`,
            detail: t`Choose the morning; Vela delivers it then.`,
            onPress: () => router.push({ pathname: "/ask", params: { recipient: light.memberId } }),
          },
          ...(day.photos
            ? [
                {
                  icon: "photo" as const,
                  label: t`Photos for her morning`,
                  detail: t`Two photos to choose between, or one to talk about.`,
                  onPress: () =>
                    router.push({
                      pathname: "/ask",
                      params: { recipient: light.memberId, kind: "two_photos" },
                    }),
                },
              ]
            : []),
          {
            icon: "mic",
            label: t`A voice hello for her morning`,
            detail: t`About ten seconds, played before the question.`,
            onPress: () =>
              router.push({
                pathname: "/ask",
                params: { recipient: light.memberId, kind: "voice_note" },
              }),
          },
        ];
  const menuActions: SheetAction[] =
    light === undefined
      ? []
      : [
          ...(calling.number === null
            ? []
            : [
                {
                  icon: "call" as const,
                  label: t`Call ${name}`,
                  onPress: () => void Linking.openURL(`tel:${calling.number ?? ""}`),
                },
              ]),
          ...(day.organiser || demo
            ? [
                {
                  icon: "time" as const,
                  label: t`Change ${name}'s morning`,
                  onPress: () =>
                    router.push({
                      pathname: "/morning-settings",
                      params: { member: light.memberId },
                    }),
                },
              ]
            : []),
          ...(light.state === "paused"
            ? []
            : [
                {
                  icon: "calendar" as const,
                  label: t`Is ${name} away?`,
                  onPress: () =>
                    router.push({ pathname: "/away", params: { member: light.memberId } }),
                },
              ]),
        ];

  const blockedNote =
    light === undefined || canSend ? null : (
      <Words variant="caption" tone="ink2">
        <Trans>
          Messaging is unavailable while their connection is paused or cannot be reached. Your draft
          stays here.
        </Trans>
      </Words>
    );
  const composer = (
    <View
      style={{
        gap: space.s,
        paddingHorizontal: inlineComposer ? 0 : space.l,
        paddingTop: space.s,
        paddingBottom: (inlineComposer ? 0 : insets.bottom) + space.s,
        borderTopWidth: inlineComposer ? 0 : 1,
        borderTopColor: palette.rule,
        backgroundColor: palette.bg,
      }}
    >
      {blockedNote}
      {draft.saveFailed ? (
        <Words variant="caption" tone="ink2">
          <Trans>
            This draft could not be saved on this phone. Keep this screen open and try again.
          </Trans>
        </Words>
      ) : null}
      {send.isError ? (
        <Words variant="caption" tone="ink2">
          <Trans>
            That could not be confirmed. Your words are still here. Retry to confirm the same
            message.
          </Trans>
        </Words>
      ) : null}
      {note === null ? null : (
        <View accessibilityLiveRegion="polite">
          <Words variant="caption" tone="ink2">
            {note}
          </Words>
        </View>
      )}
      {light === undefined ? (
        <SecondaryButton label={t`Go to Settings`} onPress={() => router.push("/settings")} />
      ) : (
        <ChatComposer
          value={send.isPending ? "" : draft.text}
          onChangeText={(text) => {
            draft.setText(text);
            setNote(null);
          }}
          placeholder={t`Write to ${name}`}
          sendLabel={invited ? t`Save for when they say yes` : t`Send now`}
          onSend={() => {
            if (sending.current || !draft.text.trim()) return;
            sending.current = true;
            send.mutate({ text: draft.text.trim(), localId: `pending:${Date.now()}` });
          }}
          {...(moreActions.length === 0 ? {} : { onMore: () => setSheet("more") })}
          disabled={send.isPending || !draft.ready}
          canSend={canSend}
        />
      )}
    </View>
  );

  const newest = newestMine(messages);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: name,
          headerLeft: () => <BackButton />,
          headerTitle: () =>
            light === undefined ? (
              <Text style={[type.heading, { color: palette.ink }]}>{name}</Text>
            ) : (
              <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={`${name}, ${light.stateText}`}
                style={{ flexDirection: "row", alignItems: "center", gap: space.s }}
              >
                <Light state={light.answerReceived === true ? "lit" : light.state} height={26} />
                <View>
                  <Text style={[type.heading, { color: palette.ink }]}>{name}</Text>
                  <Text style={[type.caption, { color: palette.ink3 }]}>{light.stateText}</Text>
                </View>
              </View>
            ),
          headerRight: () =>
            menuActions.length === 0 ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`More for ${name}`}
                testID="chat-menu"
                hitSlop={hitSlop}
                onPress={() => setSheet("menu")}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: space.s,
                }}
              >
                <BrandIcon name="more" color={palette.action} size={26} strokeWidth={3.2} />
              </Pressable>
            ),
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
        style={{ flex: 1, backgroundColor: palette.bg }}
      >
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          onContentSizeChange={() => {
            if (following.current)
              requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
          }}
          onScroll={({ nativeEvent }) => {
            following.current =
              nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >=
              nativeEvent.contentSize.height - 80;
          }}
          scrollEventThrottle={100}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.refresh} />}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: space.l,
            paddingTop: space.l,
            paddingBottom: space.l,
          }}
        >
          <View style={{ alignItems: "center", paddingHorizontal: space.l, gap: space.xs }}>
            <Words variant="caption" tone="ink3">
              {invited
                ? t`${name} has not said yes yet. Write a first hello now: it reaches ${name} the moment they say yes, so the chat is waiting for them.`
                : t`Your words reach ${name}'s chat now, signed with your name. Tomorrow's morning question still comes as planned.`}
            </Words>
          </View>
          {history.more ? (
            <View style={{ alignItems: "center", paddingTop: space.m }}>
              <Pressable
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => {
                  following.current = false;
                  history.loadMore();
                }}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Words variant="button" tone="action">
                  <Trans>Earlier messages</Trans>
                </Words>
              </Pressable>
            </View>
          ) : null}
          {history.loading && !demo ? (
            <View style={{ paddingTop: space.xl, alignItems: "center" }}>
              <Words variant="body" tone="ink2">
                <Trans>Loading your conversation…</Trans>
              </Words>
            </View>
          ) : null}
          {history.trouble ? (
            <View style={{ paddingTop: space.xl }}>
              <SecondaryButton label={t`Try again`} onPress={history.refresh} />
            </View>
          ) : null}
          {messages.length === 0 && !history.loading && light !== undefined ? (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                gap: space.l,
                paddingVertical: space.xxl,
              }}
            >
              <View style={{ alignItems: "center", gap: space.m }}>
                <Light state="resting" height={56} />
                <Words variant="title">
                  <Trans>Say hello to {name}</Trans>
                </Words>
              </View>
              <Words variant="caption" tone="ink2">
                <Trans>Not sure where to start? Tap one to put it in the box.</Trans>
              </Words>
              <View style={{ gap: space.s }}>
                {starters(lang).map((starter) => (
                  <Pressable
                    key={starter}
                    accessibilityRole="button"
                    onPress={() => draft.setText(starter)}
                    style={({ pressed }) => ({
                      borderRadius: radius.card + 6,
                      borderWidth: 1,
                      borderColor: palette.rule,
                      backgroundColor: pressed ? palette.surface2 : palette.surface,
                      paddingHorizontal: space.l,
                      paddingVertical: space.m,
                    })}
                  >
                    <Text style={[type.body, { color: palette.ink }]}>{starter}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const first = startsGroup(previous, message);
            const last = next === undefined || startsGroup(message, next);
            return (
              <View key={message.key}>
                {previous?.day === message.day ? null : (
                  <DayChip label={dayLabel(message.day, today)} />
                )}
                <ChatBubble
                  message={message}
                  first={first}
                  last={last}
                  showTime={showsTime(message, next)}
                  showStatus={showsStatus(message, newest)}
                  familyId={day.familyId}
                  {...(message.side === "her" && (demo || day.live)
                    ? {
                        onReact: (kind: ChatReactionKind) =>
                          react.mutate({ exchangeId: message.exchangeId, kind }),
                        reacting: react.isPending,
                      }
                    : {})}
                />
              </View>
            );
          })}
          {inlineComposer ? <View style={{ paddingTop: space.xl }}>{composer}</View> : null}
        </ScrollView>
        {inlineComposer ? null : composer}
      </KeyboardAvoidingView>
      {sheet === "more" ? (
        <ActionSheet
          title={t`Something for ${name}'s morning`}
          actions={moreActions}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === "menu" ? (
        <ActionSheet title={name} actions={menuActions} onClose={() => setSheet(null)} />
      ) : null}
    </>
  );
}
