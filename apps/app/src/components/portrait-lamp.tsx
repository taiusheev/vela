import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Image, Pressable, Text, useWindowDimensions, View } from "react-native";
import { portraitInitials, portraitLightOn } from "../data/portrait-lamp.ts";
import type { TodayLight } from "../data/today.ts";
import { usePortrait } from "../data/usePortrait.ts";
import { usePalette, useTheme } from "../theme/theme.tsx";
import { space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Light } from "./light.tsx";
import { Words } from "./ui.tsx";

export function Portrait({
  uri,
  name,
  width,
  height,
}: {
  uri: string | null;
  name: string;
  width: number;
  height: number;
}) {
  const p = usePalette();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return (
    <View
      style={{
        width,
        height,
        borderTopLeftRadius: width / 2,
        borderTopRightRadius: width / 2,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        backgroundColor: p.surface2,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={[type.display, { color: p.ink2 }]}>{portraitInitials(name)}</Text>
      {uri === null || failedUri === uri ? null : (
        <Image
          source={{ uri }}
          accessibilityIgnoresInvertColors
          accessible={false}
          onError={() => setFailedUri(uri)}
          resizeMode="cover"
          style={{ position: "absolute", width: "100%", height: "100%" }}
        />
      )}
    </View>
  );
}
function ParentChoice({
  light,
  familyId,
  selected,
  onPress,
}: {
  light: TodayLight;
  familyId: string;
  selected: boolean;
  onPress(): void;
}) {
  const p = usePalette();
  const photo = usePortrait(familyId, light.memberId);
  return (
    <Pressable
      testID={`parent-choice-${light.memberId}`}
      accessibilityRole="button"
      accessibilityLabel={light.displayName}
      accessibilityHint={light.stateText}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 130,
        minHeight: 68,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderWidth: 1,
        borderColor: selected ? p.action : p.rule,
        backgroundColor: selected ? p.actionSoft : p.surface,
        borderRadius: 16,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Portrait uri={photo.uri} name={light.displayName} width={35} height={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Words variant="bodyMedium">{light.displayName}</Words>
        <Words variant="caption" tone="ink2">
          {light.stateText}
        </Words>
      </View>
    </Pressable>
  );
}
export function PortraitLamp({
  lights,
  selected,
  familyId,
  onSelect,
  onChat,
  onQuiet,
  quote,
  stale = false,
}: {
  lights: TodayLight[];
  selected: TodayLight;
  familyId: string;
  onSelect(id: string): void;
  onChat(): void;
  onQuiet?: () => void;
  quote?: string;
  stale?: boolean;
}) {
  const { t } = useLingui();
  const p = usePalette();
  const { scheme } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const portraitWidth = Math.max(104, Math.min(142, (width - 120) * 0.46));
  const photo = usePortrait(familyId, selected.memberId);
  const lit = portraitLightOn(selected);
  const name = selected.displayName;
  const room = scheme === "dark" ? "#193A3D" : "#234D50";
  const roomInk = "#FBF4E7";
  const roomMuted = "#D1DFD7";
  return (
    <View style={{ gap: space.xl }}>
      {lights.length < 2 ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
          {lights.map((light) => (
            <ParentChoice
              key={light.memberId}
              light={light}
              familyId={familyId}
              selected={selected.memberId === light.memberId}
              onPress={() => onSelect(light.memberId)}
            />
          ))}
        </View>
      )}
      <View
        testID="portrait-lamp"
        style={{ backgroundColor: room, borderRadius: 28, padding: space.xl, gap: space.xl }}
      >
        <View
          style={{
            flexDirection: fontScale > 1.3 ? "column" : "row",
            alignItems: fontScale > 1.3 ? "flex-start" : "center",
            gap: space.xl,
          }}
        >
          <View style={{ paddingRight: 14, paddingBottom: 10 }}>
            <Portrait
              uri={photo.uri}
              name={name}
              width={portraitWidth}
              height={portraitWidth * 1.35}
            />
            <View
              testID={lit ? "portrait-window-lit" : "portrait-window-unlit"}
              accessibilityLabel={lit ? t`Answered today` : t`No answer recorded today`}
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                padding: 8,
                backgroundColor: p.bg,
                borderRadius: 15,
                shadowColor: p.light,
                shadowOpacity: lit ? 0.4 : 0,
                shadowRadius: 15,
                shadowOffset: { width: 0, height: 0 },
              }}
            >
              <Light state={lit ? "lit" : "resting"} height={44} />
            </View>
          </View>
          <View style={{ flex: fontScale > 1.3 ? undefined : 1, minWidth: 0, gap: space.m }}>
            <Text style={[type.title, { color: roomInk }]}>{name}</Text>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
              <BrandIcon name={lit ? "check" : "time"} size={16} color={roomMuted} />
              <Text style={[type.caption, { color: roomMuted, flexShrink: 1 }]}>
                {selected.stateText}
              </Text>
            </View>
            {selected.localDate === undefined ? null : (
              <Text style={[type.label, { color: roomMuted }]}>{selected.localDate}</Text>
            )}
            {stale ? (
              <Text style={[type.caption, { color: roomMuted }]}>
                <Trans>Last confirmed update</Trans>
              </Text>
            ) : null}
          </View>
        </View>
        {quote === undefined ? null : (
          <View style={{ gap: space.s }}>
            <Text style={[type.preview, { color: roomInk }]}>{quote}</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Talk with ${name}`}
          onPress={onChat}
          style={({ pressed }) => ({
            backgroundColor: "#FBF2E3",
            opacity: pressed ? 0.85 : 1,
            minHeight: 52,
            borderRadius: 14,
            paddingHorizontal: space.l,
            paddingVertical: space.s,
            flexDirection: "row",
            gap: space.m,
            alignItems: "center",
          })}
        >
          <BrandIcon name="chat" color="#23484B" size={20} strokeWidth={2} />
          <Text style={[type.button, { color: "#23484B", flex: 1 }]}>{t`Talk with ${name}`}</Text>
          <BrandIcon name="chevron" color="#23484B" size={18} strokeWidth={2} />
        </Pressable>
        {onQuiet === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={onQuiet}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={[type.button, { color: roomInk }]}>
              <Trans>View quiet notice</Trans>
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
