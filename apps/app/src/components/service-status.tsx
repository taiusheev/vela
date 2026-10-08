import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import { useServiceStatus } from "../data/useServiceStatus.ts";
import { space } from "../theme/tokens.ts";
import { SecondaryButton, Words } from "./ui.tsx";

export function ServiceStatus({ compact = false }: { compact?: boolean }) {
  const { t } = useLingui();
  const service = useServiceStatus();
  return (
    <View style={{ gap: space.m }} accessibilityLiveRegion="polite">
      <Words variant={compact ? "caption" : "body"} tone="ink2">
        {service.status === "example" ? (
          <Trans>This is an example. No live status is checked.</Trans>
        ) : service.status === "unconfigured" ? (
          <Trans>A live connection has not been set up.</Trans>
        ) : service.status === "checking" ? (
          <Trans>Checking Vela…</Trans>
        ) : service.status === "responding" ? (
          <Trans>Vela's last scheduled check completed.</Trans>
        ) : service.status === "degraded" ? (
          <Trans>Vela reports a service problem. Messages may be delayed.</Trans>
        ) : (
          <Trans>Vela status is unavailable. Try again shortly.</Trans>
        )}
      </Words>
      {!compact && service.status === "responding" ? (
        <Words variant="caption" tone="ink2">
          <Trans>For a particular morning message, check Today or your parent's chat.</Trans>
        </Words>
      ) : null}
      {compact || service.status === "example" || service.status === "unconfigured" ? null : (
        <SecondaryButton
          label={t`Check again`}
          disabled={service.status === "checking"}
          onPress={service.check}
        />
      )}
    </View>
  );
}
