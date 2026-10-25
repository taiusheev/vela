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
  useWindowDimensions,
  View,
  type ViewProps,
} from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useMotionPreference } from "../accessibility/use-reduced-motion.ts";
import type { TodayLight } from "../data/today.ts";
import { usePortrait } from "../data/usePortrait.ts";
import { usePalette, useTheme } from "../theme/theme.tsx";
import { hitSlop, linkHitSlop, motion, radius, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Portrait } from "./portrait-lamp.tsx";
import { Text } from "./scaled-text.tsx";
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
export function useBloom(on: boolean, bloom: boolean): Animated.Value {
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
  const { width, fontScale } = useWindowDimensions();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.title, { fontSize: 24, lineHeight: 28, color: p.ink }]}>Vela</Text>
        {/* On the smallest phones, or with very large text, the line gives its room to her answer
            and the Talk button. */}
        {width < 360 || fontScale > 1.3 ? null : (
          <Words variant="caption" tone="ink3" accessibilityRole="header">
            <Trans>A little light from home.</Trans>
          </Words>
        )}
      </View>
      <Pressable
        testID="today-bell"
        accessibilityRole="button"
        accessibilityLabel={unread ? t`Notifications, something new` : t`Notifications`}
        hitSlop={hitSlop}
        onPress={onBell}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <BrandIcon name="bell" color={p.ink} size={24} strokeWidth={1.9} />
        {unread ? (
          <View
            style={{
              position: "absolute",
              top: 9,
              right: 10,
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: p.light,
              borderWidth: 1.5,
              borderColor: p.bg,
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
        <Pressable accessibilityRole="link" hitSlop={linkHitSlop} onPress={onLink}>
          <Words variant="button" tone="action">
            {link}
          </Words>
        </Pressable>
      )}
    </View>
  );
}
