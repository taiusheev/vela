import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Animated, Pressable, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { VoicePlayback } from "../audio/VoicePlayback.tsx";
import { shortDayName } from "../data/format.ts";
import { portraitInitials, portraitLightOn } from "../data/portrait-lamp.ts";
import type { TodayExchange, TodayLight } from "../data/today.ts";
import { useFirstWeek } from "../data/useFirstWeek.ts";
import { weekWindows } from "../data/week-windows.ts";
import { usePalette } from "../theme/theme.tsx";
import {
  hitSlop,
  linkHitSlop,
  radius,
  roomShadow,
  softShadow,
  space,
  type,
} from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { ExchangePhotos, ReplyPhoto, ReplyThumbnails } from "./family-photo.tsx";
import { Light } from "./light.tsx";
import { Text } from "./scaled-text.tsx";
import { wordsOf } from "./today-feed.tsx";
import { TodayHeart } from "./today-heart.tsx";
import {
  Face,
  RoomGlow,
  RoomLightContext,
  RoomWindow,
  SoftCard,
  useBloom,
  useRoom,
  useRoomLight,
} from "./today-hero.tsx";
import { Words } from "./ui.tsx";

function listNames(names: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

/** How a window is drawn in the dark room: lit amber with the logo's dark bars, or a dim pane. */
function useRoomWindow(lit: boolean) {
  const room = useRoom();
  return lit ? { frame: room.bg, pane: room.bg } : { frame: "#8A7A68", pane: "#3A2E25" };
}

/** A lit window's own small halo, so a second lit window glows too, not only the room's source. */
function Halo({ id, size, on }: { id: string; size: number; on: boolean }) {
  const room = useRoom();
  const amber = useBloom(on, true);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        left: "50%",
        top: "50%",
        marginLeft: -size / 2,
        marginTop: -size / 2,
        opacity: amber,
      }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset={0} stopColor={room.hot} stopOpacity={0.7} />
            <Stop offset={0.35} stopColor={room.glow} stopOpacity={0.4} />
            <Stop offset={0.7} stopColor={room.glow} stopOpacity={0.12} />
            <Stop offset={1} stopColor={room.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** One parent's window in the room: lit amber once she has answered today, dark until then. */
function ParentWindow({
  light,
  height,
  source,
}: {
  light: TodayLight;
  height: number;
  source: boolean;
}) {
  const lit = portraitLightOn(light);
  const onRoom = useRoomWindow(lit);
  const window = (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      {lit ? <Halo id={`halo-${light.memberId}`} size={height * 2.4} on /> : null}
      <Light state={lit ? "lit" : "resting"} height={height} onRoom={onRoom} />
    </View>
  );
  return source ? (
    <RoomWindow testID={lit ? "portrait-window-lit" : "portrait-window-unlit"}>{window}</RoomWindow>
  ) : (
    <View testID={lit ? "portrait-window-lit" : "portrait-window-unlit"}>{window}</View>
  );
}

/**
 * The first thing on Today, for peace of mind at a glance: each parent's window in a dark room,
 * lit when she has answered this morning, dark while the family waits. Only what the lights say;
 * never a promise of more. With more than one parent, a window is also how one is chosen.
 */
export function FamilyWindows({
  lights,
  selected,
  onSelect,
  onQuiet,
}: {
  lights: TodayLight[];
  selected: TodayLight | undefined;
  onSelect(id: string): void;
  onQuiet?: (light: TodayLight) => void;
}) {
  const { t, i18n } = useLingui();
  const room = useRoom();
  const { fontScale } = useWindowDimensions();
  const { roomRef, source, slot, onRoomLayout } = useRoomLight();
  const firstWeek = useFirstWeek();
  if (lights.length === 0) return null;
  const kept = lights.filter((light) => light.invited !== true && light.state !== "paused");
  const quiet = kept.find((light) => light.state === "quiet");
  const lit = kept.filter((light) => portraitLightOn(light));
  const waiting = kept.filter((light) => !portraitLightOn(light) && light.state !== "quiet");
  const allLit = kept.length > 0 && lit.length === kept.length;
  const quietName = quiet?.displayName ?? "";
  const waitingNames = listNames(
    waiting.map((light) => light.displayName),
    i18n.locale,
  );
  const onlyName = kept[0]?.displayName ?? "";
  const title =
    kept.length === 0
      ? undefined
      : quiet !== undefined
        ? t`It has been quiet at ${quietName}'s today`
        : allLit
          ? kept.length === 1
            ? t`${onlyName}'s light is on today`
            : t`Everyone's light is on today`
          : lit.length === 0
            ? t`Waiting for today's first light`
            : t`Waiting for ${waitingNames}`;
  // The room's light starts at the chosen window when it is lit, else at the first lit one.
  const glowFrom =
    selected !== undefined && portraitLightOn(selected) ? selected.memberId : lit[0]?.memberId;
  const single = lights.length === 1;
  const stacked = fontScale > 1.3 && !single;
  return (
    <RoomLightContext.Provider value={slot}>
      <View
        testID="family-status"
        style={[{ borderRadius: 28, backgroundColor: room.bg }, roomShadow]}
      >
        <View
          ref={roomRef}
          onLayout={onRoomLayout}
          style={{
            borderRadius: 28,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: room.edge,
            paddingHorizontal: space.l,
            paddingTop: space.l,
            paddingBottom: space.l,
            gap: space.m,
          }}
        >
          <RoomGlow
            id="family-windows"
            strong={glowFrom !== undefined}
            bloom
            {...(source === undefined ? {} : { source })}
          />
          {title === undefined ? null : quiet !== undefined && onQuiet !== undefined ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={hitSlop}
              onPress={() => onQuiet(quiet)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.s,
                paddingHorizontal: space.xs,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text accessibilityRole="header" style={[type.heading, { color: room.ink }]}>
                  {title}
                </Text>
                <Text style={[type.caption, { color: room.hot }]}>{t`See what you can do`}</Text>
              </View>
              <BrandIcon name="chevron" color={room.ink} size={18} strokeWidth={2} />
            </Pressable>
          ) : (
            <Text
              accessibilityRole="header"
              style={[type.heading, { color: room.ink, paddingHorizontal: space.xs }]}
            >
              {title}
            </Text>
          )}
          {single ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.l,
                paddingVertical: space.s,
                paddingHorizontal: space.s,
              }}
            >
              {lights[0] === undefined ? null : (
                <>
                  <ParentWindow
                    light={lights[0]}
                    height={64}
                    source={glowFrom === lights[0].memberId}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[type.title, { fontSize: 24, lineHeight: 30, color: room.ink }]}>
                      {lights[0].displayName}
                    </Text>
                    <Text style={[type.caption, { color: room.muted }]}>{lights[0].stateText}</Text>
                  </View>
                </>
              )}
            </View>
          ) : (
            <View style={{ flexDirection: stacked ? "column" : "row", gap: space.s }}>
              {lights.map((light) => {
                const chosen = light.memberId === selected?.memberId;
                return (
                  <Pressable
                    key={light.memberId}
                    testID={`parent-choice-${light.memberId}`}
                    accessibilityRole="button"
                    accessibilityLabel={light.displayName}
                    accessibilityHint={light.stateText}
                    accessibilityState={{ selected: chosen }}
                    onPress={() => onSelect(light.memberId)}
                    style={({ pressed }) => ({
                      flex: stacked ? undefined : 1,
                      minWidth: 0,
                      flexDirection: stacked ? "row" : "column",
                      alignItems: "center",
                      gap: stacked ? space.m : space.s,
                      paddingVertical: space.m,
                      paddingHorizontal: space.s,
                      borderRadius: radius.panel,
                      borderWidth: 1,
                      borderColor: chosen ? room.glassRule : "transparent",
                      backgroundColor: chosen ? room.glass : "transparent",
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <ParentWindow light={light} height={52} source={glowFrom === light.memberId} />
                    <View
                      style={{
                        alignItems: stacked ? "flex-start" : "center",
                        gap: 1,
                        flexShrink: 1,
                      }}
                    >
                      <Text style={[type.button, { fontSize: 16, color: room.ink }]}>
                        {light.displayName}
                      </Text>
                      <Text
                        style={[
                          type.caption,
                          {
                            fontSize: 13,
                            lineHeight: 17,
                            color: room.muted,
                            textAlign: stacked ? "left" : "center",
                          },
                        ]}
                      >
                        {light.stateText}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          {!firstWeek || allLit || quiet !== undefined || kept.length === 0 ? null : (
            <Text style={[type.caption, { color: room.muted, paddingHorizontal: space.xs }]}>
              {t`A light comes on when they answer their morning.`}
            </Text>
          )}
        </View>
      </View>
    </RoomLightContext.Provider>
  );
}

function ActionButton({
  icon,
  label,
  accessibilityLabel,
  filled,
  disabled = false,
  onPress,
}: {
  icon: BrandIconName;
  label: string;
  accessibilityLabel?: string;
  filled: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const p = usePalette();
  const ink = filled ? p.onAction : p.action;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: "auto",
        minHeight: 46,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: space.l,
        paddingVertical: space.s,
        borderRadius: 12,
        backgroundColor: filled ? p.action : p.actionSoft,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <BrandIcon name={icon} color={ink} size={16} strokeWidth={2.1} />
      <Text style={[type.button, { color: ink, flexShrink: 1, textAlign: "center" }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * What she said this morning, read as a letter: whose question it was, her answer in her own
 * panel with a heart for it, anything she sent with it, and the two ways to carry on.
 */
export function TodayAnswer({
  selected,
  familyId,
  exchange,
  askedLine,
  onChat,
  onAsk,
  askDisabled = false,
  onQuiet,
  stale = false,
  portraitFamily,
}: {
  selected: TodayLight;
  familyId: string | undefined;
  /** Whose saved portraits the faces read: the family, or the example's. */
  portraitFamily: string;
  /** Her answered exchange today, or the one still waiting for her. */
  exchange: TodayExchange | undefined;
  askedLine?: string;
  onChat(): void;
  onAsk?: () => void;
  askDisabled?: boolean;
  onQuiet?: () => void;
  stale?: boolean;
}) {
  const { t } = useLingui();
  const p = usePalette();
  const name = selected.displayName;
  const answer = exchange?.answer;
  const [heartTrouble, setHeartTrouble] = useState<string | null>(null);
  return (
    <View
      testID="portrait-lamp"
      style={[
        {
          backgroundColor: p.surface,
          borderColor: p.rule,
          borderWidth: 1,
          borderRadius: radius.panel + 4,
          padding: space.l,
          gap: space.m,
        },
        softShadow,
      ]}
    >
      {askedLine === undefined ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
          <Face light={selected} familyId={portraitFamily} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Words variant="bodyMedium">{name}</Words>
            <Words variant="caption" tone="ink3">
              {selected.stateText}
            </Words>
          </View>
        </View>
      ) : (
        <View style={{ gap: space.xs }}>
          <Words variant="caption" tone="ink3">
            {askedLine}
          </Words>
          {exchange?.ask === undefined ? null : (
            <Text style={[type.bodyMedium, { color: p.ink2 }]}>{exchange.ask}</Text>
          )}
        </View>
      )}
      {exchange === undefined ? null : (
        <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={64} />
      )}
      {exchange?.voiceHello === undefined || familyId === undefined ? null : (
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
      {exchange?.deliveryNotice === undefined ? null : (
        <Words variant="body">{exchange.deliveryNotice}</Words>
      )}
      {answer === undefined ? (
        exchange?.unanswered === undefined ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
            <BrandIcon name="time" color={p.ink3} size={16} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Words variant="caption" tone="ink3">
                {exchange.unanswered}
              </Words>
            </View>
          </View>
        )
      ) : (
        <View
          style={{
            backgroundColor: p.lightSoft,
            borderRadius: radius.panel,
            padding: space.l,
            gap: space.m,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
            <Face light={selected} familyId={portraitFamily} size={30} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Words variant="button">{name}</Words>
            </View>
            {exchange === undefined || exchange.deliveryPending === true ? null : (
              <TodayHeart
                key={exchange.id}
                id={exchange.id}
                recipient={name}
                given={exchange.heartedByMe === true}
                onTrouble={setHeartTrouble}
              />
            )}
          </View>
          <Text style={[type.preview, { color: p.ink }]}>{answer.text}</Text>
          {heartTrouble === null ? null : (
            <Words variant="caption" tone="ink2">
              {heartTrouble}
            </Words>
          )}
          {answer.photo === undefined ? null : <ReplyPhoto photo={answer.photo} size="full" />}
          {answer.audio === undefined || familyId === undefined ? null : (
            <VoicePlayback
              familyId={familyId}
              mediaId={answer.audio.id}
              durationMs={answer.audio.duration_ms}
              expiresAt={answer.audio.expires_at}
              state={answer.audio.state}
              ready={answer.audio.state === "ready"}
            />
          )}
        </View>
      )}
      {stale ? (
        <Words variant="caption" tone="ink3">
          <Trans>Last confirmed update</Trans>
        </Words>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        <ActionButton icon="chat" label={t`Talk with ${name}`} filled onPress={onChat} />
        {onAsk === undefined ? null : (
          <ActionButton
            icon="plus"
            label={t`Ask ${name}`}
            accessibilityLabel={t`Ask ${name} something`}
            filled={false}
            disabled={askDisabled}
            onPress={onAsk}
          />
        )}
      </View>
      {exchange === undefined ||
      answer !== undefined ||
      exchange.deliveryPending === true ? null : (
        <Pressable
          accessibilityRole="button"
          hitSlop={hitSlop}
          onPress={() => router.push({ pathname: "/exchange/[id]", params: { id: exchange.id } })}
          style={{ minHeight: 32, justifyContent: "center" }}
        >
          <Words variant="button" tone="action">
            <Trans>Open this exchange</Trans>
          </Words>
        </Pressable>
      )}
      {onQuiet === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={onQuiet}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Words variant="button" tone="action">
            <Trans>View quiet notice</Trans>
          </Words>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Her week at a glance: a window for each day from Monday, lit on each day she and the family
 * shared a message. A record, never a score or a streak; the Week tab holds the rest.
 */
export function WeekWindowsCard({ light }: { light: TodayLight }) {
  const { t } = useLingui();
  const p = usePalette();
  const firstWeek = useFirstWeek();
  const days = light.connectionDays;
  if (days === undefined || days.length === 0) return null;
  const week = weekWindows(days);
  const name = light.displayName;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/sunday")}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <SoftCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
          <View style={{ flex: 1 }}>
            <Words variant="heading">
              <Trans>This week</Trans>
            </Words>
          </View>
          <BrandIcon name="chevron" color={p.ink2} size={18} strokeWidth={2} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {week.map((day) => {
            const label = shortDayName(day.date);
            return (
              <View
                key={day.date}
                accessible
                accessibilityLabel={
                  day.ahead
                    ? t`${label}: still to come`
                    : day.hasMessage
                      ? t`${label}: a family message`
                      : t`${label}: no message recorded`
                }
                style={{ flex: 1, alignItems: "center", gap: space.xs }}
              >
                <View style={{ opacity: day.ahead ? 0.35 : 1 }}>
                  <Light state={day.hasMessage ? "lit" : "resting"} height={30} />
                </View>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={[
                    type.caption,
                    {
                      fontSize: 12,
                      lineHeight: 16,
                      color: day.today ? p.ink : p.ink3,
                      fontFamily: day.today ? type.button.fontFamily : type.caption.fontFamily,
                    },
                  ]}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
        {firstWeek ? (
          <Words variant="caption" tone="ink2">
            {t`Lit on each day you and ${name} shared a message.`}
          </Words>
        ) : null}
      </SoftCard>
    </Pressable>
  );
}

/** A family member's initial in a warm circle, as the family's own chat shows who wrote. */
function Initial({ name, size = 32 }: { name: string; size?: number }) {
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
          { fontFamily: type.title.fontFamily, fontSize: size * 0.46, color: p.lightInk },
        ]}
      >
        {portraitInitials(name).slice(0, 1)}
      </Text>
    </View>
  );
}

function MarkCircle({ icon, size = 32 }: { icon: BrandIconName; size?: number }) {
  const p = usePalette();
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <BrandIcon name={icon} color={p.ink3} size={20} strokeWidth={2} />
    </View>
  );
}

interface FeedEntry {
  key: string;
  mark: ReactNode;
  /** The line of what happened, with the name in it. */
  line: ReactNode;
  words?: string;
  media?: ReactNode;
  icon?: BrandIconName;
  onReply?: () => void;
}

/** Words someone wrote, as a soft bubble under their line. */
function Bubble({ children }: { children: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        backgroundColor: p.surface2,
        borderRadius: 16,
        borderTopLeftRadius: 4,
        paddingHorizontal: space.m,
        paddingVertical: space.s,
      }}
    >
      <Words variant="body">{children}</Words>
    </View>
  );
}

/**
 * What happened in the family today, as one feed down a thread: the other parents' mornings, each
 * reply, heart and reaction, and when she saw them. Her own answer is in the letter above, so the
 * feed starts where the family took it up.
 */
export function FamilyFeed({
  exchanges,
  lights,
  familyId,
  heroId,
  askedLine,
  focusedName,
  onTalk,
  portraitFamily,
}: {
  portraitFamily: string;
  exchanges: TodayExchange[];
  lights: TodayLight[];
  familyId: string | undefined;
  /** The exchange the letter above already shows. */
  heroId: string | undefined;
  askedLine(exchange: TodayExchange): string;
  focusedName: string;
  onTalk(recipientId: string): void;
}) {
  const { t } = useLingui();
  const p = usePalette();
  const entries: FeedEntry[] = [];
  for (const exchange of exchanges) {
    const recipient = exchange.recipient;
    const parent = lights.find((light) => light.memberId === exchange.recipientId);
    const parentMark =
      parent === undefined ? (
        <Initial name={recipient} />
      ) : (
        <Face light={parent} familyId={portraitFamily} size={32} />
      );
    const talk = () => onTalk(exchange.recipientId);
    if (exchange.id !== heroId) {
      const answer = exchange.answer;
      if (answer !== undefined) {
        const time = answer.at;
        entries.push({
          key: `answer:${exchange.id}`,
          mark: parentMark,
          line: <Words variant="bodyMedium">{t`${recipient} answered at ${time}`}</Words>,
          words: answer.text,
          media: (
            <>
              {answer.photo === undefined ? null : <ReplyThumbnails photos={[answer.photo]} />}
              {answer.audio === undefined || familyId === undefined ? null : (
                <VoicePlayback
                  familyId={familyId}
                  mediaId={answer.audio.id}
                  durationMs={answer.audio.duration_ms}
                  expiresAt={answer.audio.expires_at}
                  state={answer.audio.state}
                  ready={answer.audio.state === "ready"}
                />
              )}
            </>
          ),
          onReply: talk,
        });
      } else if (exchange.ask !== undefined) {
        entries.push({
          key: `ask:${exchange.id}`,
          mark: exchange.asker === undefined ? parentMark : <Initial name={exchange.asker} />,
          line: <Words variant="bodyMedium">{askedLine(exchange)}</Words>,
          words: exchange.ask,
          media:
            exchange.unanswered === undefined ? null : (
              <Words variant="caption" tone="ink3">
                {exchange.unanswered}
              </Words>
            ),
        });
      }
    }
    exchange.replies.forEach((reply, index) => {
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
      entries.push(
        words === undefined
          ? {
              key: `reply:${exchange.id}:${index}`,
              mark: <Initial name={from} />,
              line: (
                <Words variant="body" tone="ink2">
                  {reply.text}
                </Words>
              ),
              icon: "heart",
              media,
            }
          : {
              key: `reply:${exchange.id}:${index}`,
              mark: <Initial name={from} />,
              line: (
                <Text style={[type.body, { color: p.ink3 }]}>
                  <Text style={[type.bodyMedium, { color: p.ink }]}>{from}</Text>
                  {"  "}
                  {t`Wrote to ${recipient}`}
                </Text>
              ),
              words,
              media,
              onReply: talk,
            },
      );
    });
    if (exchange.receipt !== undefined) {
      entries.push({
        key: `seen:${exchange.id}`,
        mark: <MarkCircle icon="check" />,
        line: (
          <Words variant="body" tone="ink2">
            {exchange.receipt}
          </Words>
        ),
      });
    }
  }
  const recipient = focusedName;
  const heroExchange = exchanges.find((exchange) => exchange.id === heroId);
  const nobodyYet = heroExchange !== undefined && heroExchange.replies.length === 0;
  if (entries.length === 0 && !nobodyYet) return null;
  return (
    <SoftCard padding={space.l}>
      {nobodyYet ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
          <MarkCircle icon="chat" />
          <View style={{ flex: 1, gap: 2 }}>
            <Words variant="bodyMedium">
              <Trans>Nobody has written back yet</Trans>
            </Words>
            <Words variant="caption" tone="ink2">
              <Trans>Be the first to answer {recipient}.</Trans>
            </Words>
          </View>
        </View>
      ) : null}
      <View>
        {entries.map((entry, index) => {
          const last = index === entries.length - 1;
          return (
            <View key={entry.key} style={{ flexDirection: "row", gap: space.m }}>
              <View style={{ width: 32, alignItems: "center" }}>
                {entry.mark}
                {last ? null : (
                  <View
                    style={{
                      flex: 1,
                      width: 2,
                      minHeight: space.m,
                      marginVertical: 4,
                      borderRadius: 1,
                      backgroundColor: p.rule,
                    }}
                  />
                )}
              </View>
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  gap: space.s,
                  paddingTop: 4,
                  paddingBottom: last ? 0 : space.l,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.s }}>
                  <View style={{ flex: 1, minWidth: 0 }}>{entry.line}</View>
                  {entry.icon === undefined ? null : (
                    <View style={{ paddingTop: 3 }}>
                      <BrandIcon
                        name={entry.icon}
                        color={p.lightDeep}
                        size={18}
                        strokeWidth={2}
                        {...(entry.icon === "heart" ? { fill: p.light } : {})}
                      />
                    </View>
                  )}
                </View>
                {entry.words === undefined ? null : <Bubble>{entry.words}</Bubble>}
                {entry.media}
                {entry.onReply === undefined ? null : (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={linkHitSlop}
                    onPress={entry.onReply}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      alignSelf: "flex-start",
                    }}
                  >
                    <BrandIcon name="reply" color={p.ink2} size={15} strokeWidth={2} />
                    <Words variant="caption" tone="ink2">
                      <Trans>Reply</Trans>
                    </Words>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </SoftCard>
  );
}
