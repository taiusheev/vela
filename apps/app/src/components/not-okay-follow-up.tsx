import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import type { TodayLight } from "../data/today.ts";
import { useCallingNumber } from "../data/useCallingNumber.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";
import { PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/** An explicit request for family, never a concern inferred from silence or a health label. */
export function NotOkayFollowUp({
  light,
  familyId,
  inConversation = false,
  example = false,
}: {
  light: TodayLight;
  familyId?: string;
  inConversation?: boolean;
  example?: boolean;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const calling = useCallingNumber(familyId, light.memberId);
  const [callFailed, setCallFailed] = useState(false);
  if (light.notOkayAt === undefined) return null;
  const name = light.displayName;
  const time = light.notOkayAt;
  const call = async () => {
    if (calling.number === null) return;
    setCallFailed(false);
    try {
      await Linking.openURL(`tel:${calling.number}`);
    } catch {
      setCallFailed(true);
    }
  };
  return (
    <View
      testID={`not-okay-${light.memberId}`}
      style={{
        backgroundColor: palette.surface,
        borderColor: palette.error,
        borderWidth: 2,
        borderRadius: radius.panel,
        padding: space.l,
        gap: space.m,
      }}
    >
      <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ gap: space.s }}>
        <Words variant="heading" tone="error">
          <Trans>{name} asked for the family</Trans>
        </Words>
        <Words variant="body">
          <Trans>
            At {time}, {name} tapped “Not okay, tell my family”. Call now to find out what they
            need.
          </Trans>
        </Words>
      </View>
      {calling.number !== null ? (
        <PrimaryButton label={t`Call ${name} now`} onPress={() => void call()} />
      ) : (
        <Words variant="bodyMedium">
          <Trans>Call {name} using their usual number or messaging app.</Trans>
        </Words>
      )}
      {inConversation ? null : (
        <SecondaryButton
          label={t`Message ${name}`}
          onPress={() =>
            router.push({
              pathname: "/conversation",
              params: { recipient: light.memberId, ...(example ? { example: "not-okay" } : {}) },
            })
          }
        />
      )}
      {callFailed ? (
        <Words variant="body" tone="error">
          <Trans>The call could not open. Call from your phone or messaging app directly.</Trans>
        </Words>
      ) : null}
      <Words variant="caption" tone="ink2">
        <Trans>
          If you cannot reach them, contact someone nearby. If help is needed immediately, call
          local emergency services. Vela cannot send emergency help.
        </Trans>
      </Words>
    </View>
  );
}
