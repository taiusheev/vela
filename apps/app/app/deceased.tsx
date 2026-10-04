import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, markDeceased } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { PrimaryButton, SecondaryButton, Words } from "../src/components/ui.tsx";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * When she has died (spec §19), opened from You. Any member of the family may say so: Vela stops at
 * once, sends nothing about her to anyone again, and keeps the family book for the family. It asks
 * once, plainly, and cannot be undone from the app.
 */
export default function DeceasedScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const keyFor = useIdempotencyKey("deceased");
  const { member } = useLocalSearchParams<{ member?: string }>();
  const { today, familyId } = useToday();
  const her = today.lights.find((light) => light.memberId === member);
  const name = her?.displayName ?? t`her`;
  const say = useMutation({
    mutationFn: async () =>
      markDeceased(
        familyId ?? "",
        her?.memberId ?? "",
        keyFor({ memberId: her?.memberId ?? "" }),
        await account.token(),
      ),
    onSuccess: async () => {
      await queries.invalidateQueries();
      router.replace("/");
    },
  });

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "" }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <Words variant="title">
          <Trans>We are very sorry.</Trans>
        </Words>
        <Words variant="body" tone="ink2">
          <Trans>
            If {name} has died, Vela stops now. No more mornings, and no message of any kind about{" "}
            {name}, to anyone. The family book stays, for everyone in the family to read.
          </Trans>
        </Words>
        <Words variant="body" tone="ink2">
          <Trans>This cannot be undone from the app.</Trans>
        </Words>
        {say.isError ? (
          <Words variant="body" tone="ink2">
            <Trans>That did not go through. Try again in a moment.</Trans>
          </Words>
        ) : null}
        <PrimaryButton
          label={say.isPending ? t`Stopping…` : t`Stop Vela for ${name}`}
          disabled={say.isPending || her === undefined || !apiConfigured()}
          onPress={() => say.mutate()}
        />
        <SecondaryButton label={t`Go back`} onPress={() => router.back()} />
      </ScrollView>
    </>
  );
}
