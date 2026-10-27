import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Image as SvgImage,
} from "react-native-svg";
import { useMotionPreference } from "../accessibility/use-reduced-motion.ts";
import type { TodayLight } from "../data/today.ts";
import { usePortrait } from "../data/usePortrait.ts";
import { type } from "../theme/tokens.ts";
import { Text } from "./scaled-text.tsx";

/**
 * The moment the reader sees her light come on: once for each of her days, the first time they open
 * Today after she answered. Night outside; her window catches like an old lamp, warms to amber, and
 * the warmth spills into the dark, onto the ground below it and into a few drifting motes. Her photo,
 * when this phone keeps one, is in the window. It only says what the light says: she answered.
 */

const native = Platform.OS !== "web";

/** The logo's window, in the Light's own drawing: an arch 100 wide and 132 tall, bars across. */
const PANE =
  "M34 0h32a34 34 0 0 1 34 34v84a14 14 0 0 1-14 14H14A14 14 0 0 1 0 118V34A34 34 0 0 1 34 0Z";
const VIEW = { x: -5.5, y: -5.5, width: 111, height: 143 };

const night = {
  top: "#0E0B09",
  mid: "#1C1510",
  ground: "#251B14",
  frame: "#FBEFDC",
  pane: "#2B2119",
  ink: "#FBF1E2",
  muted: "#DCCAB3",
  glow: "#F09A38",
  hot: "#FFC873",
  white: "#FFF3D6",
  mote: "#FFE2AA",
};

/** The whole moment, in milliseconds from when the night has faded in. */
const beat = {
  night: 520,
  catch: 620,
  warm: 1100,
  spill: 2000,
  words: 1500,
  stagger: 420,
  hold: 6400,
  leave: 760,
};

/** A small seeded random, so the motes and stars sit in the same places on every drawing. */
function seeded(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function useValue(start: number) {
  return useRef(new Animated.Value(start)).current;
}

export function LightOnMoment({
  lights,
  familyId,
  onDone,
}: {
  lights: TodayLight[];
  familyId: string;
  onDone(): void;
}) {
  const { t } = useLingui();
  const reduced = useMotionPreference();
  const { width, height } = useWindowDimensions();
  const scene = useValue(0);
  const words = useValue(0);
  const detail = useValue(0);
  const leave = useValue(0);
  const breath = useValue(0);
  const ambers = useRef(lights.map(() => new Animated.Value(0))).current;
  const spills = useRef(lights.map(() => new Animated.Value(0))).current;
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  const many = lights.length > 1;
  const names = lights.map((light) => light.displayName);
  const joined = names.length <= 1 ? (names[0] ?? "") : names.join(" & ");
  const title = many ? t`${joined}’s lights are on` : t`${joined}’s light is on`;
  const sub = many ? "" : (lights[0]?.stateText ?? "");

  // Sizes from the screen, so the window is the hero on any phone and still fits a short one.
  const windowHeight = Math.min(
    many ? 220 : 300,
    Math.max(150, height * (many ? 0.24 : 0.32)),
    (width - 48) / (many ? lights.length * 0.95 : 1) / (VIEW.width / VIEW.height),
  );
  const windowWidth = (windowHeight * VIEW.width) / VIEW.height;
  const windowTop = Math.max(72, height * 0.21);
  const gap = many ? Math.min(40, width * 0.06) : 0;
  const rowWidth = lights.length * windowWidth + (lights.length - 1) * gap;
  const castTop = windowTop + windowHeight + 18;

  const leaveNow = () => {
    if (leaving) return;
    setLeaving(true);
  };

  useEffect(() => {
    if (reduced === undefined) return;
    AccessibilityInfo.announceForAccessibility?.(sub === "" ? title : `${title}. ${sub}`);
    if (reduced) {
      for (const value of [...ambers, ...spills]) value.setValue(1);
      breath.setValue(1);
      const still = Animated.sequence([
        Animated.timing(scene, { toValue: 1, duration: 300, useNativeDriver: native }),
        Animated.parallel([
          Animated.timing(words, { toValue: 1, duration: 300, useNativeDriver: native }),
          Animated.timing(detail, { toValue: 1, duration: 300, useNativeDriver: native }),
        ]),
      ]);
      still.start();
      const timer = setTimeout(() => setLeaving(true), 3600);
      return () => {
        still.stop();
        clearTimeout(timer);
      };
    }
    const warm = (amber: Animated.Value) =>
      // An old lamp catching: a soft stutter, then the filament warms to full and settles.
      Animated.sequence([
        Animated.timing(amber, { toValue: 0.3, duration: 90, useNativeDriver: native }),
        Animated.timing(amber, { toValue: 0.08, duration: 120, useNativeDriver: native }),
        Animated.timing(amber, { toValue: 0.5, duration: 130, useNativeDriver: native }),
        Animated.timing(amber, { toValue: 0.34, duration: 110, useNativeDriver: native }),
        Animated.timing(amber, {
          toValue: 1,
          duration: beat.warm,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: native,
        }),
      ]);
    const play = Animated.sequence([
      Animated.timing(scene, {
        toValue: 1,
        duration: beat.night,
        easing: Easing.out(Easing.quad),
        useNativeDriver: native,
      }),
      Animated.delay(beat.catch),
      Animated.parallel([
        Animated.stagger(
          beat.stagger,
          ambers.map((amber, index) =>
            Animated.parallel([
              warm(amber),
              Animated.sequence([
                Animated.delay(260),
                Animated.timing(spills[index] as Animated.Value, {
                  toValue: 1,
                  duration: beat.spill,
                  easing: Easing.out(Easing.quad),
                  useNativeDriver: native,
                }),
              ]),
            ]),
          ),
        ),
        Animated.sequence([
          Animated.delay(beat.words + (lights.length - 1) * beat.stagger),
          Animated.timing(words, {
            toValue: 1,
            duration: 900,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: native,
          }),
        ]),
        Animated.sequence([
          Animated.delay(beat.words + 420 + (lights.length - 1) * beat.stagger),
          Animated.timing(detail, {
            toValue: 1,
            duration: 900,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: native,
          }),
        ]),
      ]),
    ]);
    // Once lit, the light breathes like a flame behind glass, slow enough not to be noticed at once.
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
      ]),
    );
    play.start();
    breathe.start();
    const timer = setTimeout(() => setLeaving(true), beat.hold + (lights.length - 1) * 400);
    return () => {
      play.stop();
      breathe.stop();
      clearTimeout(timer);
    };
  }, [reduced, ambers, spills, scene, words, detail, breath, lights.length, title, sub]);

  useEffect(() => {
    if (!leaving) return;
    const out = Animated.timing(leave, {
      toValue: 1,
      duration: reduced === true ? 240 : beat.leave,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: native,
    });
    out.start(({ finished }) => {
      if (finished) done.current();
    });
    return () => out.stop();
  }, [leaving, leave, reduced]);

  const sceneOpacity = Animated.multiply(
    scene,
    leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  );
  // Leaving, the window rises a little and steps back, as if settling into its place on Today.
  const settle = {
    transform: [
      { translateY: leave.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.07] }) },
      { scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) },
    ],
  };
  const glow = Animated.multiply(
    spills[0] as Animated.Value,
    breath.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
  );

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={leaveNow}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: sceneOpacity }]}>
        <Pressable
          testID="light-on-moment"
          accessibilityViewIsModal
          accessibilityRole="button"
          accessibilityLabel={sub === "" ? title : `${title}. ${sub}`}
          accessibilityHint={t`Shows Today`}
          onPress={leaveNow}
          style={StyleSheet.absoluteFill}
        >
          <NightSky width={width} height={height} glow={glow} still={reduced === true} />
          <Animated.View style={[StyleSheet.absoluteFill, settle]} pointerEvents="none">
            {lights.map((light, index) => {
              const x = (width - rowWidth) / 2 + index * (windowWidth + gap);
              return (
                <LitWindow
                  key={light.memberId}
                  light={light}
                  familyId={familyId}
                  left={x}
                  top={windowTop}
                  width={windowWidth}
                  height={windowHeight}
                  castTop={castTop}
                  amber={ambers[index] as Animated.Value}
                  spill={spills[index] as Animated.Value}
                  breath={breath}
                  still={reduced === true}
                  seed={index + 1}
                  label={many ? light.displayName : undefined}
                  detail={detail}
                />
              );
            })}
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 24,
              right: 24,
              top: castTop + windowHeight * 0.36 + (many ? 64 : 40),
              alignItems: "center",
              gap: 10,
              opacity: Animated.multiply(
                words,
                leave.interpolate({
                  inputRange: [0, 0.5],
                  outputRange: [1, 0],
                  extrapolate: "clamp",
                }),
              ),
              transform: [
                { translateY: words.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
              ],
            }}
          >
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={1.4}
              style={[
                type.display,
                {
                  color: night.ink,
                  textAlign: "center",
                  textShadowColor: "rgba(240, 154, 56, 0.45)",
                  textShadowRadius: 18,
                },
              ]}
            >
              {title}
            </Text>
            {sub === "" ? null : (
              <Animated.View style={{ opacity: detail }}>
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={[
                    type.label,
                    { color: night.hot, textAlign: "center", textTransform: "uppercase" },
                  ]}
                >
                  {sub}
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

/** The dark it all happens in: night above, a ground below, and stars that dim as she lights. */
function NightSky({
  width,
  height,
  glow,
  still,
}: {
  width: number;
  height: number;
  glow: Animated.AnimatedInterpolation<number> | Animated.Value;
  still: boolean;
}) {
  const stars = useMemo(() => {
    const random = seeded(7);
    return Array.from({ length: 18 }, () => ({
      x: random() * width,
      y: random() * height * 0.42,
      r: 0.6 + random() * 1.1,
      delay: random() * 3000,
      duration: 2200 + random() * 2600,
    }));
  }, [width, height]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="light-on-night" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={night.top} />
            <Stop offset={0.62} stopColor={night.mid} />
            <Stop offset={1} stopColor={night.ground} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#light-on-night)" />
      </Svg>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) },
        ]}
      >
        {stars.map((star, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: The stars are a fixed, seeded sky.
          <Star key={index} {...star} still={still} />
        ))}
      </Animated.View>
    </View>
  );
}

function Star({
  x,
  y,
  r,
  delay,
  duration,
  still,
}: {
  x: number;
  y: number;
  r: number;
  delay: number;
  duration: number;
  still: boolean;
}) {
  const twinkle = useValue(0.5);
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(twinkle, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
        Animated.timing(twinkle, {
          toValue: 0.3,
          duration: duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [still, delay, duration, twinkle]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: night.white,
        opacity: Animated.multiply(twinkle, 0.7),
      }}
    />
  );
}

/** One parent's window: dark, then catching, then warm, with all the light it sends out. */
function LitWindow({
  light,
  familyId,
  left,
  top,
  width,
  height,
  castTop,
  amber,
  spill,
  breath,
  still,
  seed,
  label,
  detail,
}: {
  light: TodayLight;
  familyId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  castTop: number;
  amber: Animated.Value;
  spill: Animated.Value;
  breath: Animated.Value;
  still: boolean;
  seed: number;
  label: string | undefined;
  detail: Animated.Value;
}) {
  const portrait = usePortrait(familyId, light.memberId);
  const [failed, setFailed] = useState<string | null>(null);
  const photo = portrait.uri !== null && failed !== portrait.uri ? portrait.uri : null;
  const id = `light-on-${seed}`;
  const cx = left + width / 2;
  const cy = top + height / 2;
  const halo = height * 4.4;
  const breathing = breath.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] });
  const castHeight = height * 0.36;
  const castWidth = width * 1.5;
  return (
    <>
      {/* The room's light, a wide warm pool around the window that breathes once lit. */}
      <Animated.View
        style={{
          position: "absolute",
          left: cx - halo / 2,
          top: cy - halo / 2,
          width: halo,
          height: halo,
          opacity: Animated.multiply(spill, breathing),
          transform: [
            { scale: spill.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
            { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) },
          ],
        }}
      >
        <Svg width={halo} height={halo}>
          <Defs>
            <RadialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
              {[0, 0.06, 0.14, 0.25, 0.38, 0.52, 0.68, 0.84, 1].map((t) => (
                <Stop
                  key={t}
                  offset={t}
                  stopColor={t < 0.1 ? night.hot : night.glow}
                  stopOpacity={0.9 * (1 - t) ** 2.2}
                />
              ))}
            </RadialGradient>
          </Defs>
          <Circle cx={halo / 2} cy={halo / 2} r={halo / 2} fill={`url(#${id}-halo)`} />
        </Svg>
      </Animated.View>

      {/* Its shape thrown on the ground below, bars and all, fading away from the wall. */}
      <Animated.View
        style={{
          position: "absolute",
          left: cx - castWidth / 2,
          top: castTop,
          width: castWidth,
          height: castHeight,
          opacity: Animated.multiply(spill, breathing),
        }}
      >
        <Svg width={castWidth} height={castHeight} viewBox="0 0 150 50">
          <Defs>
            <LinearGradient id={`${id}-cast`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset={0} stopColor={night.hot} stopOpacity={0.5} />
              <Stop offset={0.5} stopColor={night.glow} stopOpacity={0.2} />
              <Stop offset={1} stopColor={night.glow} stopOpacity={0} />
            </LinearGradient>
            <RadialGradient id={`${id}-pool`} cx="50%" cy="30%" r="60%">
              <Stop offset={0} stopColor={night.glow} stopOpacity={0.22} />
              <Stop offset={1} stopColor={night.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={75} cy={25} rx={74} ry={24} fill={`url(#${id}-pool)`} />
          {/* The four panes in perspective, near edge wide: the bars are the gaps between them. */}
          <Path d="M48 1 L73 1 L71 22 L36 22 Z" fill={`url(#${id}-cast)`} />
          <Path d="M77 1 L102 1 L114 22 L79 22 Z" fill={`url(#${id}-cast)`} />
          <Path d="M35 25 L71 25 L69 49 L20 49 Z" fill={`url(#${id}-cast)`} opacity={0.7} />
          <Path d="M79 25 L115 25 L130 49 L81 49 Z" fill={`url(#${id}-cast)`} opacity={0.7} />
        </Svg>
      </Animated.View>

      {/* Warm motes drifting up through the light, as dust does near a lamp. */}
      {still ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: spill }]} pointerEvents="none">
          <Motes cx={cx} cy={cy} width={width} height={height} seed={seed} />
        </Animated.View>
      )}

      {/* The window itself. */}
      <View style={{ position: "absolute", left, top, width, height }}>
        <Svg
          width={width}
          height={height}
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
          style={StyleSheet.absoluteFill}
        >
          <Path d={PANE} fill={night.pane} />
        </Svg>
        {photo === null ? null : (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { opacity: amber.interpolate({ inputRange: [0, 1], outputRange: [0.16, 1] }) },
            ]}
          >
            <Svg
              width={width}
              height={height}
              viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
            >
              <Defs>
                <ClipPath id={`${id}-clip`}>
                  <Path d={PANE} />
                </ClipPath>
              </Defs>
              <SvgImage
                href={{ uri: photo }}
                x={0}
                y={0}
                width={100}
                height={132}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${id}-clip)`}
              />
            </Svg>
            {/* The drawing cannot say a photo failed to open; a hidden copy can, and then the plain
                lit pane is shown instead of a half-lit one. */}
            <Image
              source={{ uri: photo }}
              onError={() => setFailed(photo)}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
              accessible={false}
            />
          </Animated.View>
        )}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity:
                photo === null
                  ? Animated.multiply(amber, breathing)
                  : amber.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
            },
          ]}
        >
          <Svg
            width={width}
            height={height}
            viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
          >
            <Defs>
              <RadialGradient id={`${id}-pane`} cx="50%" cy="46%" r="62%">
                <Stop offset={0} stopColor={night.white} />
                <Stop offset={0.32} stopColor={night.hot} />
                <Stop offset={0.78} stopColor="#F6A84A" />
                <Stop offset={1} stopColor="#E58A30" />
              </RadialGradient>
            </Defs>
            <Path d={PANE} fill={`url(#${id}-pane)`} />
          </Svg>
        </Animated.View>
        <Svg
          width={width}
          height={height}
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
          style={StyleSheet.absoluteFill}
        >
          <Path d={PANE} fill="none" stroke={night.frame} strokeWidth={8} />
          <G fill={night.frame}>
            <Rect x={47.5} y={4} width={5} height={124} />
            <Rect x={4} y={50.3} width={92} height={5} />
          </G>
        </Svg>
      </View>

      {label === undefined ? null : (
        <Animated.View
          style={{
            position: "absolute",
            left: left - 30,
            width: width + 60,
            top: castTop + castHeight + 4,
            alignItems: "center",
            gap: 2,
            opacity: detail,
          }}
        >
          <Text maxFontSizeMultiplier={1.3} style={[type.heading, { color: night.ink }]}>
            {light.displayName}
          </Text>
          <Text
            maxFontSizeMultiplier={1.3}
            style={[type.caption, { color: night.muted, textAlign: "center" }]}
          >
            {light.stateText}
          </Text>
        </Animated.View>
      )}
    </>
  );
}

function Motes({
  cx,
  cy,
  width,
  height,
  seed,
}: {
  cx: number;
  cy: number;
  width: number;
  height: number;
  seed: number;
}) {
  const motes = useMemo(() => {
    const random = seeded(seed * 97 + 13);
    return Array.from({ length: 16 }, () => {
      const size = 2 + random() * 3.4;
      return {
        x: cx + (random() - 0.5) * width * 2.1,
        y: cy + (random() - 0.2) * height * 0.9,
        size,
        rise: height * (0.45 + random() * 0.55),
        drift: 6 + random() * 16,
        duration: 5200 + random() * 4200,
        delay: random() * 3600,
        peak: 0.45 + random() * 0.5,
      };
    });
  }, [cx, cy, width, height, seed]);
  return (
    <>
      {motes.map((mote, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: The motes are a fixed, seeded set.
        <Mote key={index} {...mote} />
      ))}
    </>
  );
}

function Mote({
  x,
  y,
  size,
  rise,
  drift,
  duration,
  delay,
  peak,
}: {
  x: number;
  y: number;
  size: number;
  rise: number;
  drift: number;
  duration: number;
  delay: number;
  peak: number;
}) {
  const progress = useValue(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: native,
      }),
    );
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [progress, duration, delay]);
  const glow = size * 3.2;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: x - glow / 2,
        top: y - glow / 2,
        width: glow,
        height: glow,
        opacity: progress.interpolate({
          inputRange: [0, 0.18, 0.7, 1],
          outputRange: [0, peak, peak * 0.55, 0],
        }),
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) },
          {
            translateX: progress.interpolate({
              inputRange: [0, 0.25, 0.5, 0.75, 1],
              outputRange: [0, drift, 0, -drift, 0],
            }),
          },
        ],
      }}
    >
      <Svg width={glow} height={glow}>
        <Defs>
          <RadialGradient id={`mote-${Math.round(x)}-${Math.round(y)}`} cx="50%" cy="50%" r="50%">
            <Stop offset={0} stopColor={night.white} stopOpacity={1} />
            <Stop offset={0.28} stopColor={night.mote} stopOpacity={0.9} />
            <Stop offset={0.55} stopColor={night.glow} stopOpacity={0.25} />
            <Stop offset={1} stopColor={night.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle
          cx={glow / 2}
          cy={glow / 2}
          r={glow / 2}
          fill={`url(#mote-${Math.round(x)}-${Math.round(y)})`}
        />
      </Svg>
    </Animated.View>
  );
}
