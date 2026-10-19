import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Linking, View } from "react-native";
import { apiBaseUrl } from "../api/client.ts";
import { PRODUCTION_NOTICE_ORIGIN, SUPPORT_EMAIL } from "../api/support.ts";
import { space } from "../theme/tokens.ts";
import { SecondaryButton, Words } from "./ui.tsx";

/** English pilot links use the API origin, independent of the marketing-domain bridge. */
export function LegalLinks() {
  const { t } = useLingui();
  const [failed, setFailed] = useState(false);
  const open = async (path: string) => {
    setFailed(false);
    try {
      await Linking.openURL(`${apiBaseUrl ?? PRODUCTION_NOTICE_ORIGIN}${path}`);
    } catch {
      setFailed(true);
    }
  };
  return (
    <View style={{ gap: space.s }}>
      <SecondaryButton label={t`Service terms`} onPress={() => void open("/terms")} />
      <SecondaryButton label={t`Security`} onPress={() => void open("/security")} />
      <SecondaryButton
        label={t`Your data and deletion`}
        onPress={() => void open("/data-rights")}
      />
      {failed ? (
        <Words variant="caption">
          <Trans>That link could not open. Contact {SUPPORT_EMAIL}.</Trans>
        </Words>
      ) : null}
    </View>
  );
}
