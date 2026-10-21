import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { portraitLightOn } from "../data/portrait-lamp.ts";
import type { TodayLight } from "../data/today.ts";
import { usePortrait } from "../data/usePortrait.ts";
import { usePalette, useTheme } from "../theme/theme.tsx";
import { hitSlop, radius, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { Light } from "./light.tsx";
import { Portrait } from "./portrait-lamp.tsx";
import { Words } from "./ui.tsx";

/** The room her morning is shown in: the brand's deep teal, a shade deeper at night. */
function useRoom() {
  const { scheme } = useTheme();
  return {
    bg: scheme === "dark" ? "#193A3D" : "#234D50",
    ink: "#FBF4E7",
    muted: "#D1DFD7",
    glass: "rgba(251, 244, 231, 0.09)",
    glassRule: "rgba(251, 244, 231, 0.16)",
    cream: "#FBF2E3",
    creamInk: "#23484B",
  };
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

function Face({ light, familyId, size }: { light: TodayLight; familyId: string; size: number }) {
  const photo = usePortrait(familyId, light.memberId);
  return <Portrait uri={photo.uri} name={light.displayName} width={size} height={size} round />;
}

/** One row: the mark and the line it stands for, and the family's faces, which open their settings. */
export function TodayHeader({ lights, familyId }: { lights: TodayLight[]; familyId: string }) {
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
      {lights.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Family settings`}
          hitSlop={hitSlop}
          onPress={() => router.push("/settings")}
          style={({ pressed }) => ({
            flexDirection: "row",
            padding: space.xs,
            borderRadius: 999,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {lights.slice(0, 3).map((light, index) => (
            <View
              key={light.memberId}
              style={{
                marginLeft: index === 0 ? 0 : -10,
                borderRadius: 999,
                borderWidth: 2,
                borderColor: p.bg,
              }}
            >
              <Face light={light} familyId={familyId} size={32} />
            </View>
          ))}
        </Pressable>
      )}
    </View>
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
                minHeight: 64,
                minWidth: 0,
                flexDirection: "row",
                alignItems: "center",
                gap: space.m,
                padding: space.m,
                borderRadius: radius.panel,
                borderWidth: 1,
                borderColor: chosen ? p.action : p.rule,
                backgroundColor: chosen ? p.action : p.surface,
                opacity: pressed ? 0.85 : 1,
              },
              chosen ? null : softShadow,
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
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[type.button, { color: chosen ? p.onAction : p.ink }]}>
                {light.displayName}
              </Text>
              <Text style={[type.caption, { fontSize: 13, color: chosen ? p.onAction : p.ink2 }]}>
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
  filled,
  stacked,
  disabled = false,
  onPress,
}: {
  icon: BrandIconName;
  label: string;
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
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: stacked ? 0 : 1,
        flexBasis: stacked ? "auto" : 140,
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.s,
        paddingHorizontal: space.m,
        paddingVertical: space.s,
        borderRadius: 14,
        backgroundColor: filled ? room.cream : room.glass,
        borderWidth: filled ? 0 : 1,
        borderColor: room.glassRule,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <BrandIcon name={icon} color={ink} size={18} strokeWidth={2} />
      <Text style={[type.button, { color: ink, flexShrink: 1, textAlign: "center" }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Today's card: what went out to her that morning, large, then her answer in her own panel with her
 * window, then the two things to do next: talk with her, or get her next morning's ask ready.
 */
export function TodayHero({
  selected,
  familyId,
  asked,
  answer,
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
  // Side by side only where both labels fit on one line; a phone's width stacks them, full width.
  const stacked = fontScale > 1.3 || width < 430;
  const photo = usePortrait(familyId, selected.memberId);
  const lit = portraitLightOn(selected);
  const name = selected.displayName;
  return (
    <View
      testID="portrait-lamp"
      style={[
        { backgroundColor: room.bg, borderRadius: 28, padding: space.xl, gap: space.l },
        softShadow,
      ]}
    >
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
            >
              <Light state={lit ? "lit" : "resting"} height={28} />
            </View>
          </View>
          <Text style={[type.preview, { color: room.ink }]}>{answer}</Text>
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
            label={t`Ask ${name} something`}
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

/** A white card that sits on the page with a soft shadow, as the family's side of the day. */
export function SoftCard({
  children,
  tone = "surface",
}: {
  children: ReactNode;
  tone?: "surface" | "paper";
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
          padding: space.l,
          gap: space.m,
        },
        tone === "paper" ? null : softShadow,
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

/** Sunday, waited for: the week's words, read together, a tap away from the day. */
export function SundayCard() {
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
            <BrandIcon name="sunday" color={p.lightDeep} size={20} strokeWidth={2} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Words variant="bodyMedium">
              <Trans>This week, on Sunday</Trans>
            </Words>
            <Words variant="caption" tone="ink2">
              <Trans>The week's words, read together.</Trans>
            </Words>
          </View>
          <BrandIcon name="chevron" color={p.ink2} size={18} strokeWidth={2} />
        </View>
      </SoftCard>
    </Pressable>
  );
}
