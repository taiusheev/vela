import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { FamilyMemoryKind } from "@vela/contracts";
import { Link } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useMotionPreference } from "../accessibility/use-reduced-motion.ts";
import { VoicePlayback } from "../audio/VoicePlayback.tsx";
import { dayLabel, localDateIn } from "../data/chat.ts";
import { dayMonth } from "../data/format.ts";
import { hasMoreWords, type Memory, type MemoryStory, memoryText } from "../data/memories.ts";
import { usePalette, useTheme } from "../theme/theme.tsx";
import { hitSlop, motion, radius, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { FamilyPhoto, ReplyPhoto } from "./family-photo.tsx";
import { Text } from "./scaled-text.tsx";
import { useRoom } from "./today-hero.tsx";

const native = Platform.OS !== "web";

/** Where a memory stands for the reader: theirs to keep, being kept now, or kept. */
export type KeepState = "open" | "keeping" | "kept";

/** The serif of her words, a step smaller than Today's, so a feed of them stays compact. */
const memoryWords = { ...type.preview, fontSize: 19, lineHeight: 28 };

/** Light falls off near the inverse square, in close stops so no ring shows (as RoomGlow). */
const FALLOFF = [0, 0.1, 0.25, 0.42, 0.6, 0.8, 1];

/** The warm wash of a kept memory: amber from the top right corner, on paper, barely there. */
function WarmWash({ id }: { id: string }) {
  const palette = usePalette();
  const { scheme } = useTheme();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size?.width || height !== size?.height) setSize({ width, height });
  };
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const peak = scheme === "dark" ? 0.2 : 0.28;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size === undefined ? null : (
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient
              id={`kept-${id}`}
              cx={width - 28}
              cy={20}
              r={Math.max(width * 0.95, 260)}
              gradientUnits="userSpaceOnUse"
            >
              {FALLOFF.map((t) => (
                <Stop
                  key={t}
                  offset={t}
                  stopColor={palette.light}
                  stopOpacity={peak * (1 - t) ** 2.2}
                />
              ))}
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill={`url(#kept-${id})`} />
        </Svg>
      )}
    </View>
  );
}

/**
 * A card that is lit once its memory is kept: the warm light of her window around it and in its
 * corner, as Today lights her morning. It comes on over the bloom's 700 ms when something is kept
 * here, at once where motion is reduced, and is simply on for what was kept before.
 */
export function KeptGlow({ id, lit, children }: { id: string; lit: boolean; children: ReactNode }) {
  const palette = usePalette();
  const room = useRoom();
  const { scheme } = useTheme();
  const reduced = useMotionPreference();
  const glow = useRef(new Animated.Value(lit ? 1 : 0)).current;
  const was = useRef(lit);
  useEffect(() => {
    if (was.current === lit) return;
    was.current = lit;
    if (reduced !== false) {
      glow.setValue(lit ? 1 : 0);
      return;
    }
    const play = Animated.timing(glow, {
      toValue: lit ? 1 : 0,
      duration: lit ? motion.lightBloom : motion.card,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    });
    play.start();
    return () => play.stop();
  }, [lit, reduced, glow]);
  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius.panel,
            opacity: glow,
            backgroundColor: palette.surface,
            shadowColor: room.glow,
            shadowOpacity: scheme === "dark" ? 0.45 : 0.5,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
          },
        ]}
      />
      <View
        style={[
          {
            borderRadius: radius.panel,
            borderWidth: 1,
            borderColor: lit ? palette.light : palette.rule,
            backgroundColor: palette.surface,
            overflow: "hidden",
          },
          lit ? null : softShadow,
        ]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: glow }]}>
          <WarmWash id={id} />
        </Animated.View>
        {children}
      </View>
    </View>
  );
}

/**
 * The heart that keeps a memory: an outline while it is the reader's to keep, filled with the
 * light's amber once kept (and while it is being kept, so the tap answers at once). It beats once
 * when it fills, unless motion is reduced. A reader who cannot keep sees only a kept one.
 */
export function KeepHeart({
  state,
  onKeep,
  label,
  hint,
}: {
  state: KeepState;
  onKeep?: () => void;
  label: string;
  hint?: string;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const reduced = useMotionPreference();
  const scale = useRef(new Animated.Value(1)).current;
  const was = useRef(state);
  const filled = state !== "open";
  useEffect(() => {
    const before = was.current;
    was.current = state;
    if (before !== "open" || state === "open" || reduced !== false) return;
    const beat = Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.28,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: native,
      }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: native }),
    ]);
    beat.start();
    return () => beat.stop();
  }, [state, reduced, scale]);
  const heart = (
    <Animated.View style={{ transform: [{ scale }] }}>
      <BrandIcon
        name="heart"
        size={24}
        color={filled ? palette.lightDeep : palette.ink2}
        {...(filled ? { fill: palette.light } : {})}
      />
    </Animated.View>
  );
  if (state === "kept" || onKeep === undefined) {
    return state === "open" ? null : (
      <View
        accessible
        accessibilityLabel={t`Kept in the family book`}
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        {heart}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      accessibilityState={{ busy: state === "keeping", disabled: state === "keeping" }}
      disabled={state === "keeping"}
      hitSlop={hitSlop}
      onPress={onKeep}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? palette.actionSoft : "transparent",
      })}
    >
      {heart}
    </Pressable>
  );
}

/** What the memory model saw in a phrase, as a short label above it, when that adds something. */
export function useKindLabel(): (kind: FamilyMemoryKind | null, memory?: Memory) => string | null {
  const { t } = useLingui();
  return (kind, memory) => {
    switch (kind) {
      case "preference":
        return t`A favourite`;
      case "story":
        return t`A story`;
      case "humour":
        return t`A funny one`;
      case "person":
        return t`About someone`;
      case "moment":
        // Every memory is a moment, so the label would say nothing: the card shows only whose it is.
        return null;
      case "follow_up":
        return t`Looking forward`;
      default:
        if (memory?.photo != null) return t`A photo`;
        if (memory?.voice != null) return t`A voice note`;
        return null;
    }
  };
}

/** A story's title as a heading: her phrase as she said it, its first letter set as a capital. */
export function titleCase(title: string): string {
  return title.length === 0 ? title : title[0]?.toLocaleUpperCase() + title.slice(1);
}

/** Her words in the reader's quotation marks: “…” in English, 「…」 in Chinese. */
export function useQuoted(): (text: string) => string {
  const { t } = useLingui();
  return (text) => t`“${text}”`;
}

/**
 * One memory as a keepsake, compact: what kind it is and when, her words in the serif, her photo
 * beside them, and one line for what she was asked, with the heart at its end. A tap opens the rest
 * of her answer, her voice, and the way into the chat, in place.
 */
export function MemoryCard({
  memory,
  familyId,
  showName,
  keepState,
  onKeep,
  refusal,
}: {
  memory: Memory;
  familyId: string | undefined;
  /** Several parents in the family: say whose memory it is. */
  showName: boolean;
  keepState: KeepState;
  /** The reader may keep it (an organiser, where the book is on). */
  onKeep?: () => void;
  refusal?: string;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const kindOf = useKindLabel();
  const quoted = useQuoted();
  const [open, setOpen] = useState(false);
  const today = localDateIn(Date.now());
  const when = dayLabel(localDateIn(Date.parse(memory.at)), today);
  const kind = kindOf(memory.kind, memory);
  const name = memory.memberName;
  const label = [showName ? name : null, kind].filter((part) => part !== null).join(" · ");
  const asker = memory.askedBy;
  const question = memory.question;
  const askLine =
    question === null ? null : asker === null ? question : t`${asker} asked: ${question}`;
  const text = memoryText(memory);
  const keeper = memory.keptBy;
  const date = memory.fadesAt === null ? "" : dayMonth(memory.fadesAt);
  const lit = keepState !== "open";
  return (
    <KeptGlow id={memory.id} lit={lit}>
      <Pressable
        testID={`memory-${memory.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? t`Shows less` : t`Shows all of it`}
        onPress={() => setOpen((now) => !now)}
        style={{ paddingHorizontal: space.l, paddingTop: space.l, gap: space.s }}
      >
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.s }}>
          <Text
            numberOfLines={1}
            style={[type.label, { flex: 1, color: palette.lightInk, textTransform: "uppercase" }]}
          >
            {label}
          </Text>
          <Text style={[type.caption, { fontSize: 13, color: palette.ink3 }]}>{when}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: space.m, alignItems: "flex-start" }}>
          {memory.photo === null || open ? null : (
            <View style={{ borderRadius: 12, overflow: "hidden" }}>
              <FamilyPhoto familyId={familyId} photo={memory.photo} size={64} />
            </View>
          )}
          {text.length === 0 ? null : (
            <Text
              selectable={open}
              numberOfLines={open ? undefined : 4}
              style={[memoryWords, { flex: 1, color: palette.ink }]}
            >
              {quoted(text)}
            </Text>
          )}
        </View>
        {open ? (
          <View style={{ gap: space.m, paddingTop: space.xs }}>
            {memory.photo === null ? null : <ReplyPhoto photo={memory.photo} size="full" />}
            {hasMoreWords(memory) ? (
              <Text selectable style={[type.body, { color: palette.ink2 }]}>
                {memory.words}
              </Text>
            ) : null}
            {memory.voice === null || familyId === undefined ? null : (
              <VoicePlayback
                familyId={familyId}
                mediaId={memory.voice.mediaId}
                {...(memory.voice.durationMs === null
                  ? {}
                  : { durationMs: memory.voice.durationMs })}
                {...(memory.voice.audio === undefined
                  ? {}
                  : {
                      expiresAt: memory.voice.audio.expires_at,
                      state: memory.voice.audio.state,
                      ready: memory.voice.audio.state === "ready",
                    })}
              />
            )}
            {askLine === null ? null : (
              <Text style={[type.caption, { color: palette.ink2 }]}>{askLine}</Text>
            )}
            <Text style={[type.caption, { color: palette.ink3 }]}>
              {memory.kept
                ? keeper === null
                  ? t`Kept in the family book`
                  : t`Kept by ${keeper}`
                : date.length === 0
                  ? t`Not kept yet`
                  : t`Fades on ${date} unless someone keeps it`}
            </Text>
            {memory.opens ? (
              <Link href={{ pathname: "/exchange/[id]", params: { id: memory.id } }} asChild>
                <Pressable
                  accessibilityRole="link"
                  hitSlop={hitSlop}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.xs,
                    alignSelf: "flex-start",
                    minHeight: 32,
                  }}
                >
                  <Text
                    style={[type.button, { color: palette.action }]}
                  >{t`Open in the chat`}</Text>
                  <BrandIcon name="chevron" color={palette.action} size={16} />
                </Pressable>
              </Link>
            ) : null}
          </View>
        ) : null}
      </Pressable>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.s,
          paddingLeft: space.l,
          paddingRight: space.xs,
          paddingBottom: space.xs,
          minHeight: 48,
        }}
      >
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {memory.voice === null ? null : <BrandIcon name="mic" color={palette.ink3} size={14} />}
          <Text numberOfLines={1} style={[type.caption, { flex: 1, color: palette.ink3 }]}>
            {open ? "" : (askLine ?? "")}
          </Text>
        </View>
        <KeepHeart
          state={keepState}
          {...(onKeep === undefined ? {} : { onKeep })}
          label={t`Keep this memory`}
          hint={t`Keeps it in the family book instead of letting it fade after 30 days`}
        />
      </View>
      {refusal === undefined ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            type.caption,
            { color: palette.ink2, paddingHorizontal: space.l, paddingBottom: space.m },
          ]}
        >
          {refusal}
        </Text>
      )}
    </KeptGlow>
  );
}

/** The days a story spans: "3 Oct – 24 Oct", or one day. */
function span(from: string, to: string): string {
  const first = dayMonth(from);
  const last = dayMonth(to);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * A story gathered from her memories: its title in her words, how many mornings it was told across,
 * its first lines, and a light for each memory in it, lit once kept. The heart keeps them all.
 */
export function StoryCard({
  story,
  keepState,
  onKeep,
}: {
  story: MemoryStory;
  keepState: KeepState;
  onKeep?: () => void;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const quoted = useQuoted();
  const name = story.memberName;
  const count = story.memories.length;
  const when = span(story.from, story.to);
  const first = story.memories[0];
  const keptCount = story.memories.filter((memory) => memory.kept).length;
  return (
    <KeptGlow id={`story-${story.id}`} lit={keepState !== "open"}>
      <Link href={{ pathname: "/story/[id]", params: { id: story.id } }} asChild>
        <Pressable
          testID={`story-${story.id}`}
          accessibilityRole="link"
          style={{ paddingHorizontal: space.l, paddingTop: space.l, gap: space.s }}
        >
          <Text
            numberOfLines={1}
            style={[type.label, { color: palette.lightInk, textTransform: "uppercase" }]}
          >
            {t`A story in ${name}'s words`}
          </Text>
          <Text style={[type.title, { fontSize: 24, lineHeight: 32, color: palette.ink }]}>
            {quoted(titleCase(story.title))}
          </Text>
          <Text style={[type.caption, { color: palette.ink3 }]}>
            {plural(count, { one: "# morning", other: "# mornings" })}
            {` · ${when}`}
          </Text>
          {first === undefined ? null : (
            <Text numberOfLines={2} style={[type.body, { color: palette.ink2 }]}>
              {memoryText(first)}
            </Text>
          )}
        </Pressable>
      </Link>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.s,
          paddingLeft: space.l,
          paddingRight: space.xs,
          paddingBottom: space.xs,
          minHeight: 48,
        }}
      >
        <View
          accessible
          accessibilityLabel={plural(keptCount, {
            one: "# of its memories is kept",
            other: "# of its memories are kept",
          })}
          style={{ flex: 1, flexDirection: "row", gap: 6 }}
        >
          {story.memories.map((memory) => (
            <View
              key={memory.id}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: memory.kept || keepState !== "open" ? palette.light : palette.rule,
              }}
            />
          ))}
        </View>
        <KeepHeart
          state={keepState}
          {...(onKeep === undefined ? {} : { onKeep })}
          label={t`Keep this story`}
          hint={t`Keeps every memory in it in the family book`}
        />
      </View>
    </KeptGlow>
  );
}

/**
 * The family book on Memories, as a book on a shelf: its cover, what it holds, and the way in.
 */
export function BookCover({ kept, stories }: { kept: number; stories: number }) {
  const palette = usePalette();
  const room = useRoom();
  const { t } = useLingui();
  const held =
    kept === 0
      ? t`Nothing kept yet. Tap a heart to start it.`
      : stories === 0
        ? plural(kept, { one: "# memory kept", other: "# memories kept" })
        : `${plural(kept, { one: "# memory kept", other: "# memories kept" })} · ${plural(stories, {
            one: "# story",
            other: "# stories",
          })}`;
  return (
    <Link href="/book" asChild>
      <Pressable
        testID="book-cover"
        accessibilityRole="link"
        accessibilityLabel={t`The family book`}
        accessibilityHint={held}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.l,
          padding: space.m,
          paddingRight: space.l,
          borderRadius: radius.panel,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.rule,
          ...softShadow,
        }}
      >
        {/* A small book: the logo's ink as its cover, her window lit on it, a spine down the side. */}
        <View
          style={{
            width: 46,
            height: 60,
            borderRadius: 6,
            borderTopLeftRadius: 3,
            borderBottomLeftRadius: 3,
            backgroundColor: room.bg,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <View
            style={{
              position: "absolute",
              left: 5,
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: room.glassRule,
            }}
          />
          <View
            style={{
              width: 14,
              height: 18,
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              backgroundColor: kept === 0 ? room.glassRule : room.hot,
              shadowColor: room.glow,
              shadowOpacity: kept === 0 ? 0 : 0.9,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.preview, { fontSize: 19, lineHeight: 26, color: palette.ink }]}>
            {t`The family book`}
          </Text>
          <Text style={[type.caption, { color: palette.ink2 }]}>{held}</Text>
        </View>
        <BrandIcon name="chevron" color={palette.action} size={18} />
      </Pressable>
    </Link>
  );
}
