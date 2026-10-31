import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { View } from "react-native";
import { FamilyAction, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { Portrait } from "../../src/components/portrait-lamp.tsx";
import { Text } from "../../src/components/scaled-text.tsx";
import { ServiceStatus } from "../../src/components/service-status.tsx";
import { SoftCard, useRoom } from "../../src/components/today-hero.tsx";
import { Hairline } from "../../src/components/ui.tsx";
import { RoomCard, WarmPage } from "../../src/components/warm.tsx";
import type { KeptLightRow } from "../../src/data/family.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useMyMemories } from "../../src/data/useMyMemories.ts";
import { photoBoxDemo } from "../../src/data/usePhotoBox.ts";
import { usePortrait } from "../../src/data/usePortrait.ts";
import { useToday } from "../../src/data/useToday.ts";
import { space, type } from "../../src/theme/tokens.ts";

/** One parent whose light the family keeps: her face, her name, and her plan in one line. */
function KeptLightLine({ familyId, parent }: { familyId: string; parent: KeptLightRow }) {
  const room = useRoom();
  const photo = usePortrait(familyId, parent.memberId);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        padding: space.m,
        borderRadius: 16,
        backgroundColor: room.glass,
        borderWidth: 1,
        borderColor: room.glassRule,
      }}
    >
      <Portrait uri={photo.uri} name={parent.name} width={40} height={40} round />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.button, { color: room.ink }]}>{parent.name}</Text>
        <Text style={[type.caption, { fontSize: 13, color: room.muted }]}>{parent.line}</Text>
      </View>
    </View>
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
      <FamilyChooser day={day} />
      {/* The family is what this tab is about, so it is lit as Today lights her morning. Everything
          the reader can change sits in the one list under it; there is no second profile page. */}
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
          <FamilyAction
            icon="you"
            title={t`Your name`}
            detail={loading ? undefined : myName}
            actionLabel={t`Change`}
            testID="you-name"
            onPress={() => router.push("/profile")}
          />
          <Hairline />
          {memories.available ? (
            <>
              <FamilyAction
                icon="heart"
                title={t`Your memories`}
                detail={t`Little things worth remembering from your own answers`}
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
                detail={t`Photos Vela shows her on free mornings`}
                testID="you-photo-box"
                onPress={() => router.push("/photo-box")}
              />
              <Hairline />
            </>
          ) : null}
          <FamilyAction
            icon="settings"
            title={t`Settings`}
            detail={t`Parents, notifications, language and account`}
            onPress={() => router.push("/settings")}
          />
          <Hairline />
          <FamilyAction
            icon="mail"
            title={t`Help`}
            detail={t`Get help with Vela or your family connection`}
            onPress={() => router.push("/help")}
          />
        </View>
      </SoftCard>
      <ServiceStatus compact />
    </WarmPage>
  );
}
