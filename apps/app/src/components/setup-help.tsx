import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Linking, View } from "react-native";
import { apiBaseUrl } from "../api/client.ts";
import { PRODUCTION_NOTICE_ORIGIN, SUPPORT_EMAIL, SUPPORT_URL } from "../api/support.ts";
import { space } from "../theme/tokens.ts";
import { SecondaryButton, Words } from "./ui.tsx";

export function SetupHelp() {
  const { t } = useLingui();
  const [failed, setFailed] = useState(false);
  const open = async (url: string) => {
    setFailed(false);
    try {
      await Linking.openURL(url);
    } catch {
      setFailed(true);
    }
  };
  return (
    <View style={{ gap: space.s }}>
      <SecondaryButton label={t`Get help connecting`} onPress={() => void open(SUPPORT_URL)} />
      <SecondaryButton
        label={t`Read the privacy notice`}
        onPress={() => void open(`${apiBaseUrl ?? PRODUCTION_NOTICE_ORIGIN}/privacy`)}
      />
      {failed ? (
        <Words variant="caption" tone="ink2">
          <Trans>That link could not open. Contact Vela at the address below.</Trans>
        </Words>
      ) : null}
      <Words variant="caption" selectable>
        {SUPPORT_EMAIL}
      </Words>
    </View>
  );
}
