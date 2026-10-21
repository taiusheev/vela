import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../accessibility/use-reduced-motion.ts";
import { VoicePlayback } from "../audio/VoicePlayback.tsx";
import { portraitInitials } from "../data/portrait-lamp.ts";
import type { Today, TodayExchange, TodayReply } from "../data/today.ts";
import type { PushView } from "../push/provider.tsx";
import { readSetting, writeSetting } from "../storage/flags.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, sheetShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { ReplyThumbnails } from "./family-photo.tsx";
import { SoftCard } from "./today-hero.tsx";
import { Words } from "./ui.tsx";

/** A family member's initial in a warm circle, as the family's own chat shows who wrote. */
function Initial({ name, size = 34 }: { name: string; size?: number }) {
  const p = usePalette();
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.lightSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={[
          type.bodyMedium,
          { fontFamily: type.title.fontFamily, fontSize: size * 0.46, color: p.lightDeep },
        ]}
      >
        {portraitInitials(name).slice(0, 1)}
      </Text>
    </View>
  );
}

/**
 * The words of a reply without the name in front, which the card already shows above them. A reply
 * line is "Anna: Those are…" in English and "Anna：…" in Chinese; one without a name is left whole.
 */
export function wordsOf(reply: TodayReply): string | undefined {
  for (const colon of [": ", "："]) {
    const prefix = `${reply.from}${colon}`;
    if (reply.text.startsWith(prefix)) return reply.text.slice(prefix.length);
  }
  return undefined;
}

/**
 * What the family said about her morning today, as a feed: each reply its own card with who wrote
 * it and to whom, a heart or a reaction as one line, and her "saw it" at the end, as a chat would.
 */
export function TodayFeed({
  exchange,
  familyId,
}: {
  exchange: TodayExchange;
  familyId: string | undefined;
}) {
  const { t } = useLingui();
  const p = usePalette();
  const recipient = exchange.recipient;
  const talk = () =>
    router.push({ pathname: "/conversation", params: { recipient: exchange.recipientId } });
  if (exchange.replies.length === 0) {
    return (
      <SoftCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
          <BrandIcon name="chat" color={p.ink2} size={20} />
          <View style={{ flex: 1, gap: 2 }}>
            <Words variant="bodyMedium">
              <Trans>Nobody has written back yet</Trans>
            </Words>
            <Words variant="caption" tone="ink2">
              <Trans>Be the first to answer {recipient}.</Trans>
            </Words>
          </View>
        </View>
        <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={talk}>
          <Words variant="button" tone="action">
            {t`Talk with ${recipient}`}
          </Words>
        </Pressable>
      </SoftCard>
    );
  }
  return (
    <View style={{ gap: space.m }}>
      {exchange.replies.map((reply) => {
        const words = wordsOf(reply);
        const from = reply.from;
        const media = (
          <>
            {reply.photo === undefined ? null : <ReplyThumbnails photos={[reply.photo]} />}
            {reply.audio === undefined || familyId === undefined ? null : (
              <VoicePlayback
                familyId={familyId}
                mediaId={reply.audio.id}
                durationMs={reply.audio.duration_ms}
                expiresAt={reply.audio.expires_at}
                state={reply.audio.state}
                ready={reply.audio.state === "ready"}
                label={t`Listen to ${from}’s voice reply`}
              />
            )}
          </>
        );
        if (words === undefined) {
          // A heart or a reaction: the line says it all, so it stays one line.
          return (
            <SoftCard key={`${reply.from}:${reply.text}`} padding={space.m}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
                <Initial name={reply.from} size={30} />
                <View style={{ flex: 1 }}>
                  <Words variant="body" tone="ink2">
                    {reply.text}
                  </Words>
                </View>
                <BrandIcon name="heart" color={p.lightDeep} size={18} strokeWidth={2} />
              </View>
              {media}
            </SoftCard>
          );
        }
        return (
          <SoftCard key={`${reply.from}:${reply.text}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
              <Initial name={reply.from} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Words variant="bodyMedium">{reply.from}</Words>
                <Words variant="caption" tone="ink3">
                  {t`Wrote to ${recipient}`}
                </Words>
              </View>
            </View>
            <Words variant="body">{words}</Words>
            {media}
            <View
              style={{
                flexDirection: "row",
                gap: space.l,
                paddingTop: space.s,
                borderTopWidth: 1,
                borderTopColor: p.rule,
              }}
            >
              <Pressable
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={talk}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }}
              >
                <BrandIcon name="reply" color={p.ink2} size={16} strokeWidth={2} />
                <Words variant="caption" tone="ink2">
                  <Trans>Reply</Trans>
                </Words>
              </Pressable>
            </View>
          </SoftCard>
        );
      })}
      {exchange.receipt === undefined ? null : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-end",
            paddingHorizontal: space.s,
          }}
        >
          <BrandIcon name="check" color={p.ink3} size={14} strokeWidth={2.2} />
          <Words variant="caption" tone="ink3">
            {exchange.receipt}
          </Words>
        </View>
      )}
    </View>
  );
}

export interface InboxItem {
  id: string;
  icon: BrandIconName;
  title: string;
  detail?: string;
  /** Something that asks for the reader: drawn warm, and listed first. */
  urgent?: boolean;
  onPress?: () => void;
}

/**
 * Today's notifications, from what Today already knows: a quiet morning first, then a phone that
 * would not tell the reader, then each answer, reply and "saw it", and the reader's own turn. Each
 * says what happened; none is a count.
 */
export function useInbox({
  today,
  familyId,
  push,
  onQuiet,
}: {
  today: Today;
  familyId: string;
  push: PushView;
  onQuiet?: (memberId: string) => void;
}) {
  const { t } = useLingui();
  const items = useMemo(() => {
    const list: InboxItem[] = [];
    const chat = (recipient: string) => () =>
      router.push({ pathname: "/conversation", params: { recipient } });
    for (const light of today.lights) {
      const name = light.displayName;
      if (light.state === "quiet") {
        list.push({
          id: `quiet:${light.memberId}`,
          icon: "time",
          title: t`It has been quiet at ${name}'s today`,
          detail: t`See what you can do`,
          urgent: true,
          onPress: onQuiet === undefined ? undefined : () => onQuiet(light.memberId),
        });
      }
      const channel = light.unreachableOn;
      if (channel !== undefined) {
        list.push({
          id: `lost:${light.memberId}`,
          icon: "close",
          title: t`Vela cannot reach ${name} on ${channel}`,
          urgent: true,
        });
      }
    }
    const phone = push.phone;
    if (push.availability.available && phone !== null && phone.permission !== "granted") {
      list.push({
        id: "push-off",
        icon: "bell",
        title: t`Notifications are off.`,
        detail: t`Turn them on to hear when someone answers, and if a morning goes quiet.`,
        urgent: true,
        onPress: phone.canAskAgain ? () => void push.ask() : push.openSettings,
      });
    }
    for (const exchange of today.exchanges) {
      const recipient = exchange.recipient;
      if (exchange.answer !== undefined) {
        const time = exchange.answer.at;
        list.push({
          id: `answer:${exchange.id}`,
          icon: "check",
          title: t`${recipient} answered at ${time}`,
          detail: exchange.answer.text,
          onPress: chat(exchange.recipientId),
        });
      }
      exchange.replies.forEach((reply, index) => {
        list.push({
          id: `reply:${exchange.id}:${index}`,
          icon: wordsOf(reply) === undefined ? "heart" : "chat",
          title: reply.text,
          onPress: chat(exchange.recipientId),
        });
      });
      if (exchange.receipt !== undefined) {
        list.push({ id: `seen:${exchange.id}`, icon: "check", title: exchange.receipt });
      }
    }
    for (const turn of today.tomorrow) {
      const recipient = turn.recipient;
      if (turn.mine && turn.asked === undefined) {
        list.push({
          id: `turn:${turn.recipientId}`,
          icon: "calendar",
          title: t`Tomorrow is your turn to ask ${recipient}`,
          onPress: () => router.push({ pathname: "/ask", params: { recipient: turn.recipientId } }),
        });
      }
    }
    return list.sort((a, b) => Number(b.urgent === true) - Number(a.urgent === true));
  }, [today, push, onQuiet, t]);
  const key = `inbox-seen.${familyId}`;
  const [seen, setSeen] = useState<string[] | null>(null);
  useEffect(() => {
    let current = true;
    void readSetting(key).then((value) => {
      if (!current) return;
      try {
        setSeen(value === null ? [] : (JSON.parse(value) as string[]));
      } catch {
        setSeen([]);
      }
    });
    return () => {
      current = false;
    };
  }, [key]);
  const unread = seen !== null && items.some((item) => !seen.includes(item.id));
  const markSeen = useCallback(() => {
    const ids = items.map((item) => item.id);
    setSeen(ids);
    void writeSetting(key, JSON.stringify(ids));
  }, [items, key]);
  return { items, unread, markSeen };
}

/** Today's notifications as a sheet over the day, each one a way to what it is about. */
export function InboxSheet({
  items,
  visible,
  onClose,
}: {
  items: InboxItem[];
  visible: boolean;
  onClose(): void;
}) {
  const { t } = useLingui();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(30,26,22,0.32)" }}>
        <Pressable
          accessible={false}
          focusable={false}
          tabIndex={-1}
          style={{ flex: 1 }}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          style={[
            {
              backgroundColor: p.bg,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              paddingTop: space.l,
              paddingHorizontal: space.margin,
              paddingBottom: insets.bottom + space.xl,
              gap: space.l,
              maxHeight: "86%",
            },
            sheetShadow,
          ]}
        >
          <View
            style={{
              alignSelf: "center",
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: p.rule,
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
            <View style={{ flex: 1 }}>
              <Words variant="title" accessibilityRole="header">
                <Trans>Notifications</Trans>
              </Words>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t`Close notifications`}
              hitSlop={hitSlop}
              onPress={onClose}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <BrandIcon name="close" color={p.ink2} size={22} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: space.s }}>
            {items.length === 0 ? (
              <Words variant="body" tone="ink2">
                <Trans>Nothing new yet today.</Trans>
              </Words>
            ) : (
              items.map((item) => {
                const row = (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: space.m,
                      padding: space.m,
                      borderRadius: 16,
                      backgroundColor: item.urgent === true ? p.lightSoft : p.surface,
                      borderWidth: 1,
                      borderColor: p.rule,
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        backgroundColor: item.urgent === true ? p.surface : p.surface2,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <BrandIcon
                        name={item.icon}
                        color={item.urgent === true ? p.lightDeep : p.ink2}
                        size={18}
                        strokeWidth={2}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Words variant="bodyMedium">{item.title}</Words>
                      {item.detail === undefined ? null : (
                        <Words variant="caption" tone="ink2" numberOfLines={2}>
                          {item.detail}
                        </Words>
                      )}
                    </View>
                    {item.onPress === undefined ? null : (
                      <BrandIcon name="chevron" color={p.ink3} size={16} strokeWidth={2} />
                    )}
                  </View>
                );
                if (item.onPress === undefined) return <View key={item.id}>{row}</View>;
                const go = item.onPress;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => {
                      onClose();
                      go();
                    }}
                  >
                    {row}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
