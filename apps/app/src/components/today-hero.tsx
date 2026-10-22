import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewProps,
} from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useMotionPreference } from "../accessibility/use-reduced-motion.ts";
import { portraitLightOn } from "../data/portrait-lamp.ts";
import type { TodayLight } from "../data/today.ts";
import { usePortrait } from "../data/usePortrait.ts";
import { usePalette, useTheme } from "../theme/theme.tsx";
import { hitSlop, motion, radius, roomShadow, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { Light } from "./light.tsx";
import { Portrait } from "./portrait-lamp.tsx";
import { TodayHeart } from "./today-heart.tsx";
import { Words } from "./ui.tsx";

/**
 * The room her morning is shown in: the logo's warm ink as an evening room, lit by her window's
 * amber. A shade deeper at night, with an edge, as dark mode draws no shadows.
 */
export function useRoom() {
  const { scheme } = useTheme();
  return {
    bg: scheme === "dark" ? "#231B15" : "#2E231B",
    edge: scheme === "dark" ? "rgba(251, 236, 214, 0.10)" : "rgba(0, 0, 0, 0)",
    ink: "#FBF1E2",
    muted: "#DCCAB3",
    glass: "rgba(251, 236, 214, 0.08)",
    glassRule: "rgba(251, 236, 214, 0.15)",
    cream: "#FBEFDC",
    creamInk: "#2E231B",
    glow: "#F09A38",
    /** The hot middle of a lit window, a step paler than its glow. */
    hot: "#FFC873",
  };
}

/** Where a light sits in its room, in points from the room's top left. */
export interface LightSource {
  x: number;
  y: number;
}

interface RoomLightSlot {
  roomRef: RefObject<View | null>;
  /** Changes whenever the room is laid out again, so its window measures itself once more. */
  epoch: number;
  place(source: LightSource | undefined): void;
}

export const RoomLightContext = createContext<RoomLightSlot | undefined>(undefined);

/**
 * A room whose light comes from a window inside it: the room gives `roomRef` and `onRoomLayout`
 * to its own view and `slot` to a RoomLightContext provider, and any RoomWindow in it says where
 * the light starts.
 */
export function useRoomLight() {
  const roomRef = useRef<View>(null);
  const [source, setSource] = useState<LightSource>();
  const [epoch, setEpoch] = useState(0);
  const place = useCallback(
    (next: LightSource | undefined) =>
      setSource((now) => (now?.x === next?.x && now?.y === next?.y ? now : next)),
    [],
  );
  const slot = useMemo<RoomLightSlot>(() => ({ roomRef, epoch, place }), [epoch, place]);
  return { roomRef, source, slot, onRoomLayout: () => setEpoch((n) => n + 1) };
}

/**
 * Wraps her lit window inside a room, so the room's light comes from it: measured in the room's
 * own points whenever either moves, at any text size or language.
 */
export function RoomWindow({ children, ...props }: ViewProps & { children: ReactNode }) {
  const slot = useContext(RoomLightContext);
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    const room = slot?.roomRef.current;
    const self = ref.current;
    if (slot === undefined || room == null || self === null) return;
    self.measureLayout(room, (x, y, width, height) =>
      slot.place({ x: Math.round(x + width / 2), y: Math.round(y + height / 2) }),
    );
  }, [slot]);
  useEffect(() => {
    measure();
  }, [measure]);
  // Gone with her answer: the room falls back to its own light.
  const place = slot?.place;
  useEffect(() => () => place?.(undefined), [place]);
  return (
    <View ref={ref} onLayout={measure} {...props}>
      {children}
    </View>
  );
}

/**
 * Light falls off smoothly, near the inverse square of a lamp, rather than in a straight ramp:
 * a few close stops so the edge never shows as a ring on an 8-bit screen.
 */
const FALLOFF = [0, 0.08, 0.2, 0.35, 0.5, 0.68, 0.85, 1];

/** The stops themselves, not a component: react-native-svg reads a gradient's own Stop children. */
function falloff(color: string, peak: number) {
  return FALLOFF.map((t) => (
    <Stop key={t} offset={t} stopColor={color} stopOpacity={peak * (1 - t) ** 2.4} />
  ));
}

const native = Platform.OS !== "web";

/**
 * Plays the light coming on: 0 to 1 when `on` turns true (once on arrival, again if her answer
 * lands while the room is open), straight to 0 when it goes off. Still where motion is reduced,
 * and nothing is shown until the platform has said which.
 */
function useBloom(on: boolean, bloom: boolean): Animated.Value {
  const reduced = useMotionPreference();
  const value = useRef(new Animated.Value(on && !bloom ? 1 : 0)).current;
  useEffect(() => {
    if (!on) {
      value.setValue(0);
      return;
    }
    if (reduced === undefined) return;
    if (!bloom || reduced) {
      value.setValue(1);
      return;
    }
    const play = Animated.timing(value, {
      toValue: 1,
      duration: motion.lightBloom,
      // A lamp warming, not a switch: most of the light by halfway, settling softly.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    });
    play.start();
    return () => play.stop();
  }, [on, bloom, reduced, value]);
  return value;
}

/**
 * Light in a dark room, from one place: her window when it is lit, as amber; otherwise only the
 * faint cream of a room nobody has lit, as amber means an answer and nothing else. Drawn in the
 * room's own points, so the pool stays round on any card, and costs nothing on any phone. Without a
 * window to start from, it falls from the top right and has no bright middle. With `bloom`, the
 * amber comes on once as the room appears (Today keeps this for her morning).
 */
export function RoomGlow({
  id,
  strong,
  source,
  bloom = false,
}: {
  id: string;
  strong: boolean;
  source?: LightSource;
  bloom?: boolean;
}) {
  const room = useRoom();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const amber = useBloom(strong, bloom);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size?.width || height !== size?.height) setSize({ width, height });
  };
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const at = source ?? { x: width - 56, y: 56 };
  const reach = Math.max(width * 1.05, 320);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size === undefined ? null : (
        <>
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient
                id={`${id}-dim`}
                cx={at.x}
                cy={at.y}
                r={reach}
                gradientUnits="userSpaceOnUse"
              >
                {falloff(room.cream, 0.07)}
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={height} fill={`url(#${id}-dim)`} />
          </Svg>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: amber }]}>
            <Svg width={width} height={height}>
              <Defs>
                <RadialGradient
                  id={`${id}-pool`}
                  cx={at.x}
                  cy={at.y}
                  r={reach}
                  gradientUnits="userSpaceOnUse"
                >
                  {falloff(room.glow, 0.36)}
                </RadialGradient>
                <RadialGradient
                  id={`${id}-core`}
                  cx={at.x}
                  cy={at.y}
                  r={72}
                  gradientUnits="userSpaceOnUse"
                >
                  {falloff(room.hot, 0.3)}
                </RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={width} height={height} fill={`url(#${id}-pool)`} />
              {source === undefined ? null : (
                <Rect x={0} y={0} width={width} height={height} fill={`url(#${id}-core)`} />
              )}
            </Svg>
          </Animated.View>
        </>
      )}
    </View>
  );
}

/**
 * The soft morning light at the top of a tab, behind the header: warm, and barely there. Round in
 * the page's own points, from just above the top right, where the brand's window would be.
 */
export function MorningLight() {
  const p = usePalette();
  const { scheme } = useTheme();
  const { width } = useWindowDimensions();
  const height = 460;
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, height }} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient
            id="morning"
            cx={width * 0.82}
            cy={-24}
            r={Math.max(width * 1.15, 360)}
            gradientUnits="userSpaceOnUse"
          >
            {falloff(p.light, scheme === "dark" ? 0.13 : 0.26)}
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#morning)" />
      </Svg>
    </View>
  );
}

export function Face({
  light,
  familyId,
  size,
}: {
  light: TodayLight;
  familyId: string;
  size: number;
}) {
  const photo = usePortrait(familyId, light.memberId);
  return <Portrait uri={photo.uri} name={light.displayName} width={size} height={size} round />;
}

/**
 * One row: the mark and the line it stands for, then the bell, with a dot while something is new,
 * and the family's faces, which open their settings.
 */
export function TodayHeader({
  lights,
  familyId,
  unread,
  onBell,
}: {
  lights: TodayLight[];
  familyId: string;
  unread: boolean;
  onBell(): void;
}) {
  const { t } = useLingui();
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.title, { fontSize: 24, lineHeight: 28, color: p.ink }]}>Vela</Text>
        <Words variant="caption" tone="ink3" accessibilityRole="header">
          <Trans>A little light from home.</Trans>
        </Words>
      </View>
      <Pressable
        testID="today-bell"
        accessibilityRole="button"
        accessibilityLabel={unread ? t`Notifications, something new` : t`Notifications`}
        hitSlop={hitSlop}
        onPress={onBell}
        style={({ pressed }) => [
          {
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: p.surface,
            borderWidth: 1,
            borderColor: p.rule,
            opacity: pressed ? 0.8 : 1,
          },
          softShadow,
        ]}
      >
        <BrandIcon name="bell" color={p.ink} size={20} strokeWidth={1.9} />
        {unread ? (
          <View
            style={{
              position: "absolute",
              top: 10,
              right: 11,
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: p.light,
              borderWidth: 1.5,
              borderColor: p.surface,
            }}
          />
        ) : null}
      </Pressable>
      {lights.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Family settings`}
          hitSlop={hitSlop}
          onPress={() => router.push("/settings")}
          style={({ pressed }) => ({
            flexDirection: "row",
            padding: 2,
            borderRadius: 999,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {lights.slice(0, 3).map((light, index) => (
            <View
              key={light.memberId}
              style={{
                marginLeft: index === 0 ? 0 : -12,
                borderRadius: 999,
                borderWidth: 2,
                borderColor: p.bg,
              }}
            >
              <Face light={light} familyId={familyId} size={34} />
            </View>
          ))}
        </Pressable>
      )}
    </View>
  );
}

function listNames(names: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

/**
 * The family at a glance, before anything else: whose light is on, whom the family is still
 * waiting for, or that a morning has gone quiet. Only what the lights say; never a promise of more.
 */
export function FamilyStatus({
  lights,
  familyId,
  onQuiet,
}: {
  lights: TodayLight[];
  familyId: string;
  onQuiet?: (light: TodayLight) => void;
}) {
  const { t, i18n } = useLingui();
  const p = usePalette();
  const kept = lights.filter((light) => light.invited !== true && light.state !== "paused");
  if (kept.length === 0) return null;
  const quiet = kept.find((light) => light.state === "quiet");
  const lit = kept.filter((light) => portraitLightOn(light));
  const waiting = kept.filter((light) => !portraitLightOn(light) && light.state !== "quiet");
  const allLit = lit.length === kept.length;
  const quietName = quiet?.displayName ?? "";
  const waitingNames = listNames(
    waiting.map((light) => light.displayName),
    i18n.locale,
  );
  const onlyName = kept[0]?.displayName ?? "";
  const title =
    quiet !== undefined
      ? t`It has been quiet at ${quietName}'s today`
      : allLit
        ? kept.length === 1
          ? t`${onlyName}'s light is on today`
          : t`Everyone's light is on today`
        : lit.length === 0
          ? t`Waiting for today's first light`
          : t`Waiting for ${waitingNames}`;
  const detail =
    quiet !== undefined
      ? t`See what you can do`
      : allLit
        ? t`Each light came on with an answer this morning.`
        : lit.length === 0
          ? t`A light comes on when they answer their morning.`
          : t`The others have answered this morning.`;
  const tone = quiet !== undefined ? "quiet" : allLit ? "lit" : "waiting";
  // The faces of whom the line is about: the quiet one, those still awaited, or everyone lit. The
  // window stays her answer's own mark, so the brand is not repeated down the page.
  const about = (quiet !== undefined ? [quiet] : allLit ? lit : waiting).slice(0, 2);
  const body = (
    <View
      testID="family-status"
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: space.m,
          padding: space.m,
          paddingRight: space.l,
          borderRadius: radius.panel,
          borderWidth: 1,
          borderColor: tone === "lit" ? "rgba(233, 162, 59, 0.35)" : p.rule,
          backgroundColor: tone === "lit" ? p.lightSoft : p.surface,
        },
        softShadow,
      ]}
    >
      <View style={{ flexDirection: "row", width: about.length > 1 ? 62 : 44 }}>
        {about.map((light, index) => (
          <View
            key={light.memberId}
            style={{
              marginLeft: index === 0 ? 0 : -26,
              borderRadius: 22,
              borderWidth: 2,
              borderColor: tone === "lit" ? p.lightSoft : p.surface,
            }}
          >
            <Face light={light} familyId={familyId} size={40} />
          </View>
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Words variant="heading">{title}</Words>
        <Words variant="caption" tone={tone === "quiet" ? "action" : "ink2"}>
          {detail}
        </Words>
      </View>
      {tone === "quiet" && onQuiet !== undefined ? (
        <BrandIcon name="chevron" color={p.ink2} size={18} strokeWidth={2} />
      ) : null}
    </View>
  );
  if (quiet === undefined || onQuiet === undefined) return body;
  return (
    <Pressable accessibilityRole="button" onPress={() => onQuiet(quiet)}>
      {body}
    </Pressable>
  );
}

/** Each parent as a pill: the chosen one filled, each with her state as a mark on her face. */
export function ParentSwitcher({
  lights,
  selected,
  familyId,
  onSelect,
}: {
  lights: TodayLight[];
  selected: TodayLight;
  familyId: string;
  onSelect(id: string): void;
}) {
  const p = usePalette();
  if (lights.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {lights.map((light) => {
        const chosen = light.memberId === selected.memberId;
        const lit = portraitLightOn(light);
        return (
          <Pressable
            key={light.memberId}
            testID={`parent-choice-${light.memberId}`}
            accessibilityRole="button"
            accessibilityLabel={light.displayName}
            accessibilityHint={light.stateText}
            accessibilityState={{ selected: chosen }}
            onPress={() => onSelect(light.memberId)}
            style={({ pressed }) => [
              {
                flexGrow: 1,
                flexBasis: 130,
                minHeight: 60,
                minWidth: 0,
                flexDirection: "row",
                alignItems: "center",
                gap: space.m,
                paddingVertical: space.s,
                paddingHorizontal: space.m,
                borderRadius: radius.panel,
                borderWidth: 1,
                borderColor: chosen ? p.action : p.rule,
                backgroundColor: chosen ? p.action : p.surface,
                opacity: pressed ? 0.85 : 1,
              },
              softShadow,
            ]}
          >
            <View>
              <Face light={light} familyId={familyId} size={40} />
              <View
                style={{
                  position: "absolute",
                  right: -3,
                  bottom: -3,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: 2,
                  borderColor: chosen ? p.action : p.surface,
                  backgroundColor: lit ? p.light : p.control,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <BrandIcon
                  name={lit ? "check" : "time"}
                  size={10}
                  color={lit ? "#1E1A16" : "#FFFFFF"}
                  strokeWidth={2.5}
                />
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text style={[type.button, { color: chosen ? p.onAction : p.ink }]}>
                {light.displayName}
              </Text>
              <Text
                style={[
                  type.caption,
                  { fontSize: 13, lineHeight: 17, color: chosen ? p.onAction : p.ink2 },
                ]}
              >
                {light.stateText}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function RoomButton({
  icon,
  label,
  accessibilityLabel,
  filled,
  stacked,
  disabled = false,
  onPress,
}: {
  icon: BrandIconName;
  label: string;
  accessibilityLabel?: string;
  filled: boolean;
  stacked: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const room = useRoom();
  const ink = filled ? room.creamInk : room.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: stacked ? 0 : 1,
        flexBasis: "auto",
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: space.m,
        paddingVertical: space.s,
        borderRadius: 12,
        backgroundColor: filled ? room.cream : room.glass,
        borderWidth: filled ? 0 : 1,
        borderColor: room.glassRule,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <BrandIcon name={icon} color={ink} size={16} strokeWidth={2.1} />
      <Text
        style={[
          type.button,
          { fontSize: 14, lineHeight: 18, color: ink, flexShrink: 1, textAlign: "center" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Today's card: what went out to her that morning, large, then her answer in her own panel with her
 * window and a heart for it, then the two things to do next: talk with her, or ask her something.
 */
export function TodayHero({
  selected,
  familyId,
  asked,
  answer,
  heartFor,
  onChat,
  onAsk,
  askDisabled = false,
  onQuiet,
  stale = false,
}: {
  selected: TodayLight;
  familyId: string;
  /** Who asked, and the ask in their words, when one reached her this morning. */
  asked?: { by: string; text?: string };
  answer?: string;
  /** The answered exchange a heart goes to. */
  heartFor?: string;
  onChat(): void;
  /** Absent when nobody may ask her anything just now. */
  onAsk?: () => void;
  askDisabled?: boolean;
  onQuiet?: () => void;
  stale?: boolean;
}) {
  const { t } = useLingui();
  const room = useRoom();
  const { width, fontScale } = useWindowDimensions();
  // Side by side, as the prototype; stacked only where large text or a narrow phone needs it.
  const stacked = fontScale > 1.3 || width < 340;
  const photo = usePortrait(familyId, selected.memberId);
  const lit = portraitLightOn(selected);
  const name = selected.displayName;
  const { roomRef, source, slot, onRoomLayout } = useRoomLight();
  return (
    <RoomLightContext.Provider value={slot}>
      <View
        testID="portrait-lamp"
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
            padding: space.xl,
            gap: space.l,
          }}
        >
          <RoomGlow
            id={`room-${selected.memberId}`}
            strong={lit}
            bloom
            {...(source === undefined ? {} : { source })}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.s,
            }}
          >
            <Pill>
              <Text style={[type.label, { letterSpacing: 0, color: room.ink }]}>
                {t({ context: "tab", message: "Today" })}
              </Text>
            </Pill>
            <Pill>
              <BrandIcon
                name={lit ? "check" : "time"}
                color={room.muted}
                size={14}
                strokeWidth={2}
              />
              <Text style={[type.label, { letterSpacing: 0, color: room.muted, flexShrink: 1 }]}>
                {selected.stateText}
              </Text>
            </Pill>
          </View>
          {asked === undefined ? (
            <Text style={[type.title, { color: room.ink }]}>{name}</Text>
          ) : (
            <View style={{ gap: space.xs }}>
              {asked.text === undefined ? null : (
                <Text style={[type.preview, { fontSize: 22, lineHeight: 31, color: room.ink }]}>
                  {asked.text}
                </Text>
              )}
              <Text style={[type.caption, { color: room.muted }]}>{asked.by}</Text>
            </View>
          )}
          {selected.localDate === undefined ? null : (
            <Text style={[type.label, { color: room.muted }]}>{selected.localDate}</Text>
          )}
          {stale ? (
            <Text style={[type.caption, { color: room.muted }]}>
              <Trans>Last confirmed update</Trans>
            </Text>
          ) : null}
          {answer === undefined ? null : (
            <View
              style={{
                backgroundColor: room.glass,
                borderColor: room.glassRule,
                borderWidth: 1,
                borderRadius: radius.panel,
                padding: space.l,
                gap: space.m,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
                <Portrait uri={photo.uri} name={name} width={30} height={38} />
                <Text style={[type.button, { color: room.ink, flex: 1 }]}>{name}</Text>
                <RoomWindow
                  testID={lit ? "portrait-window-lit" : "portrait-window-unlit"}
                  accessibilityLabel={lit ? t`Answered today` : t`No answer recorded today`}
                >
                  <Light state={lit ? "lit" : "resting"} height={28} />
                </RoomWindow>
              </View>
              <Text style={[type.preview, { color: room.ink }]}>{answer}</Text>
              {heartFor === undefined ? null : (
                <View style={{ alignItems: "flex-start" }}>
                  <TodayHeart
                    key={heartFor}
                    id={heartFor}
                    recipient={name}
                    compact
                    onRoom={{ ink: room.ink, rule: room.glassRule }}
                  />
                </View>
              )}
            </View>
          )}
          <View
            style={{
              flexDirection: stacked ? "column" : "row",
              flexWrap: stacked ? "nowrap" : "wrap",
              alignItems: "stretch",
              gap: space.s,
            }}
          >
            <RoomButton
              icon="chat"
              label={t`Talk with ${name}`}
              filled
              stacked={stacked}
              onPress={onChat}
            />
            {onAsk === undefined ? null : (
              <RoomButton
                icon="plus"
                label={t`Ask ${name}`}
                accessibilityLabel={t`Ask ${name} something`}
                filled={false}
                stacked={stacked}
                disabled={askDisabled}
                onPress={onAsk}
              />
            )}
          </View>
          {onQuiet === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={onQuiet}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={[type.button, { color: room.ink }]}>
                <Trans>View quiet notice</Trans>
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </RoomLightContext.Provider>
  );
}

function Pill({ children }: { children: ReactNode }) {
  const room = useRoom();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 1,
        paddingHorizontal: space.m,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: room.glass,
        borderWidth: 1,
        borderColor: room.glassRule,
      }}
    >
      {children}
    </View>
  );
}

/** A warm white card that rests on the page with a soft shadow, as the family's side of the day. */
export function SoftCard({
  children,
  tone = "surface",
  padding = space.l,
}: {
  children: ReactNode;
  tone?: "surface" | "paper";
  padding?: number;
}) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: tone === "paper" ? p.surface2 : p.surface,
          borderColor: p.rule,
          borderWidth: 1,
          borderRadius: radius.panel,
          padding,
          gap: space.m,
        },
        softShadow,
      ]}
    >
      {children}
    </View>
  );
}

/** A section's title with the way to everything it is a part of. */
export function SectionTitle({
  title,
  link,
  onLink,
}: {
  title: string;
  link?: string;
  onLink?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: space.m,
      }}
    >
      <Words variant="heading" accessibilityRole="header">
        {title}
      </Words>
      {link === undefined || onLink === undefined ? null : (
        <Pressable accessibilityRole="link" hitSlop={hitSlop} onPress={onLink}>
          <Words variant="button" tone="action">
            {link}
          </Words>
        </Pressable>
      )}
    </View>
  );
}

/** The week, waited for: its words, read together on Sunday, a tap away from the day. */
export function WeekCard() {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/sunday")}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <SoftCard tone="paper">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              backgroundColor: p.lightSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BrandIcon name="calendar" color={p.lightDeep} size={20} strokeWidth={2} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Words variant="bodyMedium">
              <Trans>This week</Trans>
            </Words>
            <Words variant="caption" tone="ink2">
              <Trans>The week's words, read together on Sunday.</Trans>
            </Words>
          </View>
          <BrandIcon name="chevron" color={p.ink2} size={18} strokeWidth={2} />
        </View>
      </SoftCard>
    </Pressable>
  );
}
