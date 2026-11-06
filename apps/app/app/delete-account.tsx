import { useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { BackButton } from "../src/components/back-button.tsx";
import { DeleteAccountBody } from "../src/components/delete-account.tsx";

/** The normal account route shares its confirmation and deletion flow with the setup gate. */
export default function DeleteAccountScreen() {
  const { t } = useLingui();
  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Delete account`, headerLeft: () => <BackButton /> }}
      />
      <DeleteAccountBody />
    </>
  );
}
