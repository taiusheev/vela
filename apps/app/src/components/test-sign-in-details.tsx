import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Platform, View } from "react-native";
import { apiBaseUrl } from "../api/client.ts";
import { useAccount } from "../auth/clerk.tsx";
import { space } from "../theme/tokens.ts";
import { SecondaryButton, Words } from "./ui.tsx";

/** Native development staging only. Identifiers, never JWT export or a token relay. */
export function TestSignInDetails({ includeAccountId = true }: { includeAccountId?: boolean }) {
  const account = useAccount();
  const { t } = useLingui();
  const [shown, setShown] = useState(false);
  if (
    !__DEV__ ||
    Platform.OS === "web" ||
    apiBaseUrl !== "https://vela.vela-light-staging.workers.dev" ||
    !account.signedIn ||
    typeof account.sessionId !== "string"
  ) {
    return null;
  }
  return (
    <View style={{ gap: space.s }}>
      <SecondaryButton
        label={shown ? t`Hide test sign-in details` : t`Show test sign-in details`}
        onPress={() => setShown((value) => !value)}
      />
      {shown ? (
        <>
          <Words variant="caption" tone="ink3">
            <Trans>
              Copy these ids into the private Terminal helper for the dedicated test account.
            </Trans>
          </Words>
          {includeAccountId ? (
            <Words variant="bodyMedium" selectable>
              {account.userId}
            </Words>
          ) : null}
          <Words variant="bodyMedium" selectable>
            {account.sessionId}
          </Words>
        </>
      ) : null}
    </View>
  );
}
