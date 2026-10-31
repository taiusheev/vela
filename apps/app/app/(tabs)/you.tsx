import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { FamilyAction, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { Portrait } from "../../src/components/portrait-lamp.tsx";
import { Text } from "../../src/components/scaled-text.tsx";
import { ServiceStatus } from "../../src/components/service-status.tsx";
import { SoftCard, useRoom } from "../../src/components/today-hero.tsx";
import { Hairline, Words } from "../../src/components/ui.tsx";
import { RoomCard, WarmPage } from "../../src/components/warm.tsx";
import type { KeptLightRow } from "../../src/data/family.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useMyMemories } from "../../src/data/useMyMemories.ts";
import { photoBoxDemo } from "../../src/data/usePhotoBox.ts";
import { usePortrait } from "../../src/data/usePortrait.ts";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space, type } from "../../src/theme/tokens.ts";

/** One parent whose light the family keeps: her face, her name and her plan; tapping opens her page. */
function KeptLightLine({ familyId, parent }: { familyId: string; parent: KeptLightRow }) {
  const room = useRoom();
  const photo = usePortrait(familyId, parent.memberId);
  return (
    <Pressable
      accessibilityRole="button"
      testID={`you-parent-${parent.memberId}`}
      onPress={() => router.push({ pathname: "/kept-light", params: { member: parent.memberId } })}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        padding: space.m,
        borderRadius: 16,
        backgroundColor: room.glass,
        borderWidth: 1,
        borderColor: room.glassRule,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Portrait uri={photo.uri} name={parent.name} width={40} height={40} round />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.button, { color: room.ink }]}>{parent.name}</Text>
        <Text style={[type.caption, { fontSize: 13, color: room.muted }]}>{parent.line}</Text>
      </View>
      <BrandIcon name="chevron" color={room.muted} size={16} strokeWidth={2} />
    </Pressable>
  );
}

/**
 * The reader first, as a phone's own settings begin: their face and name, tapped to change the
 * name. It replaces the "Your name · Change" row, so there is one way in and no second profile.
 */
function MeLine({ name, line, loading }: { name: string; line: string; loading: boolean }) {
  const palette = usePalette();
  const { t } = useLingui();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t`Your name, ${name}`}
      accessibilityHint={t`Change the name your family sees`}
      testID="you-name"
      disabled={loading}
      onPress={() => router.push("/profile")}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.l,
        paddingHorizontal: space.xs,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Portrait uri={null} name={loading ? "" : name} width={56} height={56} round />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Words variant="heading">{loading ? t`Loading…` : name}</Words>
        {loading ? null : (
          <Words variant="caption" tone="ink2">
            {line}
          </Words>
        )}
      </View>
      <BrandIcon name="chevron" color={palette.ink3} size={20} />
    </Pressable>
  );
}

export default function YouScreen() {
  const { t } = useLingui();
  const room = useRoom();
  const day = useToday();
  const { family, loading } = useFamily(day.familyId, day.familyId !== undefined);
  const memories = useMyMemories(day.familyId);
  const { capabilities } = useCapabilities();
  const myName = family.me.name;
  return (
    <WarmPage>
      <ScreenHeading title={<Trans context="tab">You</Trans>} />
      <MeLine name={myName} line={family.me.line} loading={loading} />
      <FamilyChooser day={day} />
      {/* The family is what this tab is about, so it is lit as Today lights her morning. Each parent
          opens her own page; everything else the reader can change sits in the one list under it. */}
      <RoomCard id="you-family">
        <Text style={[type.label, { letterSpacing: 0, color: room.muted }]}>
          <Trans>Your family</Trans>
        </Text>
        <Text accessibilityRole="header" style={[type.title, { color: room.ink }]}>
          {loading ? t`Loading your family…` : family.familyName}
        </Text>
        {family.keptLight.map((parent) => (
          <KeptLightLine key={parent.memberId} familyId={day.familyId ?? ""} parent={parent} />
        ))}
        {family.others === undefined ? null : (
          <Text style={[type.caption, { color: room.muted }]}>
            {family.others.names} · {family.others.line}
          </Text>
        )}
      </RoomCard>
      <SoftCard padding={space.s}>
        <View style={{ paddingHorizontal: space.s }}>
          {memories.available ? (
            <>
              <FamilyAction
                icon="heart"
                title={t`Your memories`}
                detail={t`From your own answers`}
                onPress={() => router.push("/my-memories")}
              />
              <Hairline />
            </>
          ) : null}
          {capabilities?.photo_box === true || photoBoxDemo() ? (
            <>
              <FamilyAction
                icon="photo"
                title={t`Photo box`}
                detail={t`Shown on free mornings`}
                testID="you-photo-box"
                onPress={() => router.push("/photo-box")}
              />
              <Hairline />
            </>
          ) : null}
          <FamilyAction
            icon="settings"
            title={t`Settings`}
            detail={t`Notifications, language, privacy, account`}
            onPress={() => router.push("/settings")}
          />
          <Hairline />
          <FamilyAction icon="mail" title={t`Help`} onPress={() => router.push("/help")} />
        </View>
      </SoftCard>
      <ServiceStatus compact />
    </WarmPage>
  );
}
