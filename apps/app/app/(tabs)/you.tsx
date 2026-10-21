import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { FamilyAction, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { Portrait } from "../../src/components/portrait-lamp.tsx";
import { ServiceStatus } from "../../src/components/service-status.tsx";
import { SoftCard, useRoom } from "../../src/components/today-hero.tsx";
import { Hairline } from "../../src/components/ui.tsx";
import { RoomCard, WarmPage } from "../../src/components/warm.tsx";
import type { KeptLightRow } from "../../src/data/family.ts";
import { useFamily } from "../../src/data/useFamily.ts";
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
  const myName = family.me.name;
  return (
    <WarmPage>
      <ScreenHeading title={<Trans context="tab">You</Trans>} />
      <FamilyChooser day={day} />
      {/* The family is what this tab is about, so it is lit as Today lights her morning. */}
      <RoomCard id="you-family">
        <Text style={[type.label, { letterSpacing: 0, color: room.muted }]}>
          <Trans>Your family</Trans>
        </Text>
        <Text style={[type.title, { color: room.ink }]}>
          {loading ? t`Loading your family…` : family.familyName}
        </Text>
        {loading ? null : (
          <Text style={[type.caption, { color: room.muted }]}>
            <Trans>Signed in as {myName}</Trans>
          </Text>
        )}
        {family.keptLight.map((parent) => (
          <KeptLightLine key={parent.memberId} familyId={day.familyId ?? ""} parent={parent} />
        ))}
      </RoomCard>
      <SoftCard padding={space.s}>
        <View style={{ paddingHorizontal: space.s }}>
          <FamilyAction
            icon="you"
            title={t`Settings`}
            detail={t`Parent photos and links, notifications, language, and account`}
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
