import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { apiConfigured, setUpDevice } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { writeDeviceToken } from "../device/token.ts";
import { space } from "../theme/tokens.ts";
import { Card, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/**
 * "Set up this phone for Mom" (ADR-35, spec §14.2): for an organiser holding her phone. A first tap
 * says what happens; the second sets it up, keeps her phone's token in its secure store, signs the
 * organiser out of this phone, and opens her screen, which is all this phone shows from then on.
 * On the web it is offered only in the demo, where it opens the example of her screen.
 */
export function SetUpPhone({
  familyId,
  memberId,
  name,
}: {
  familyId: string;
  memberId: string;
  name: string;
}) {
  const { t } = useLingui();
  const account = useAccount();
  const keyFor = useIdempotencyKey("device");
  const [asking, setAsking] = useState(false);
  const demo = !apiConfigured();
  const setUp = useMutation({
    mutationFn: async () => {
      const set = await setUpDevice(
        familyId,
        memberId,
        keyFor({ memberId }),
        await account.token(),
      );
      await writeDeviceToken(set.token);
      await account.signOut();
    },
    onSuccess: () => router.replace("/parent"),
  });
  if (!demo && Platform.OS === "web") return null;

  return (
    <Card>
      <Words variant="bodyMedium">
        <Trans>Set up this phone for {name}</Trans>
      </Words>
      {asking ? (
        <View style={{ gap: space.m }}>
          <Words variant="body" tone="ink2">
            <Trans>
              This phone becomes {name}'s: large words, one message at a time, her answers with a
              tap or in her own words. You are signed out of it, and she needs no account.
            </Trans>
          </Words>
          {setUp.isError ? (
            <Words variant="body" tone="ink2">
              <Trans>That did not go through. Try again in a moment.</Trans>
            </Words>
          ) : null}
          <PrimaryButton
            label={setUp.isPending ? t`Setting up…` : t`Yes, this is ${name}'s phone`}
            disabled={setUp.isPending}
            onPress={() => (demo ? router.push("/parent") : setUp.mutate())}
          />
          <SecondaryButton label={t`Not now`} onPress={() => setAsking(false)} />
        </View>
      ) : (
        <SecondaryButton label={t`Set it up`} onPress={() => setAsking(true)} />
      )}
    </Card>
  );
}
