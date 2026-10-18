import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FamilyAction, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { ServiceStatus } from "../../src/components/service-status.tsx";
import { Card, Eyebrow, Words } from "../../src/components/ui.tsx";
import { useFamily } from "../../src/data/useFamily.ts";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

export default function YouScreen() {
  const { t } = useLingui();
  const day = useToday();
  const { family, loading } = useFamily(day.familyId, day.familyId !== undefined);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: insets.bottom + space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      <ScreenHeading title={<Trans context="tab">You</Trans>} />
      <FamilyChooser day={day} />
      <Card>
        <Eyebrow>
          <Trans>Your family</Trans>
        </Eyebrow>
        <Words variant="title">{loading ? t`Loading your family…` : family.me.name}</Words>
        <Words variant="body" tone="ink2">
          {family.familyName}
        </Words>
        {family.keptLight.map((parent) => (
          <Words key={parent.memberId} variant="body">
            {parent.name} · {parent.line}
          </Words>
        ))}
      </Card>
      <Card>
        <FamilyAction
          icon="you"
          title={t`Settings`}
          detail={t`Parent photos and links, notifications, language, and account`}
          onPress={() => router.push("/settings")}
        />
        <FamilyAction
          icon="mail"
          title={t`Help`}
          detail={t`Get help with Vela or your family connection`}
          onPress={() => router.push("/help")}
        />
      </Card>
      <ServiceStatus compact />
    </ScrollView>
  );
}
