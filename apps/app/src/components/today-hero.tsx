import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { portraitLightOn } from "../data/portrait-lamp.ts";
import type { TodayLight } from "../data/today.ts";
import { usePortrait } from "../data/usePortrait.ts";
import { usePalette, useTheme } from "../theme/theme.tsx";
import { hitSlop, radius, roomShadow, softShadow, space, type } from "../theme/tokens.ts";
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
    glow: "#F2A93B",
  };
}

/**
 * Warm light falling into a dark room: a wide glow from where her window sits, and a faint one
 * across the floor. Drawn, so it costs nothing and looks the same on every phone.
 */
function RoomGlow({ id, strong }: { id: string; strong: boolean }) {
  const room = useRoom();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={`${id}-window`} cx="88" cy="20" r="70" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={room.glow} stopOpacity={strong ? 0.42 : 0.16} />
            <Stop offset="0.45" stopColor={room.glow} stopOpacity={strong ? 0.12 : 0.05} />
            <Stop offset="1" stopColor={room.glow} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}-floor`} cx="10" cy="105" r="60" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#E9763B" stopOpacity={0.14} />
            <Stop offset="1" stopColor="#E9763B" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}-window)`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}-floor)`} />
      </Svg>
    </View>
  );
}

/** The soft morning light at the top of Today, behind the header: warm, and barely there. */
export function MorningLight() {
  const p = usePalette();
  const { scheme } = useTheme();
  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: 420 }}
      pointerEvents="none"
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="morning" cx="80" cy="0" r="90" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={p.light} stopOpacity={scheme === "dark" ? 0.12 : 0.22} />
            <Stop offset="1" stopColor={p.light} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#morning)" />
      </Svg>
    </View>
  );
}

/** The window from the lockup, alone: the brand mark, at the size of an app header. */
function BrandMark() {
  const p = usePalette();
  return (
    <Svg viewBox="-17.5 -17.5 141 167" width={24} height={28}>
      <Path
        d="M34 5.5H66A28.5 28.5 0 0 1 94.5 34V118A8.5 8.5 0 0 1 86 126.5H14A8.5 8.5 0 0 1 5.5 118V34A28.5 28.5 0 0 1 34 5.5Z"
        fill={p.light}
      />
      <Path
        fillRule="evenodd"
        d="M34 -5.5H66A39.5 39.5 0 0 1 105.5 34V118A19.5 19.5 0 0 1 86 137.5H14A19.5 19.5 0 0 1 -5.5 118V34A39.5 39.5 0 0 1 34 -5.5ZM34 5.5H66A28.5 28.5 0 0 1 94.5 34V118A8.5 8.5 0 0 1 86 126.5H14A8.5 8.5 0 0 1 5.5 118V34A28.5 28.5 0 0 1 34 5.5Z"
        fill={p.ink}
      />
      <Rect x="47" y="5.5" width="6" height="121" fill={p.ink} />
      <Rect x="5.5" y="49.8" width="89" height="6" fill={p.ink} />
    </Svg>
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
      <View accessible accessibilityLabel="Vela" style={{ flexShrink: 0 }}>
        <BrandMark />
      </View>
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
  onQuiet,
}: {
  lights: TodayLight[];
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
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tone === "lit" ? p.surface : p.surface2,
          shadowColor: p.light,
          shadowOpacity: tone === "lit" ? 0.55 : 0,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <Light state={tone === "lit" ? "lit" : "resting"} height={28} />
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
  return (
    <View
      testID="portrait-lamp"
      style={[{ borderRadius: 28, backgroundColor: room.bg }, roomShadow]}
    >
      <View
        style={{
          borderRadius: 28,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: room.edge,
          padding: space.xl,
          gap: space.l,
        }}
      >
        <RoomGlow id={`room-${selected.memberId}`} strong={lit} />
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
            <BrandIcon name="today" color={room.ink} size={14} strokeWidth={2} />
            <Text style={[type.label, { letterSpacing: 0, color: room.ink }]}>
              {t({ context: "tab", message: "Today" })}
            </Text>
          </Pill>
          <Pill>
            <BrandIcon name={lit ? "check" : "time"} color={room.muted} size={14} strokeWidth={2} />
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
              <View
                testID={lit ? "portrait-window-lit" : "portrait-window-unlit"}
                accessibilityLabel={lit ? t`Answered today` : t`No answer recorded today`}
                style={{
                  shadowColor: room.glow,
                  shadowOpacity: lit ? 0.9 : 0,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 0 },
                }}
              >
                <Light state={lit ? "lit" : "resting"} height={28} />
              </View>
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
