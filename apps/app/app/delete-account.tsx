import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, apiConfigured, deleteAccount } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { ConfirmationDialog } from "../src/components/confirmation-dialog.tsx";
import { Card, SecondaryButton, Words } from "../src/components/ui.tsx";
import { usePush } from "../src/push/provider.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * Delete account (ADR-43, App Store guideline 5.1.1(v)), opened from You. It says what goes and
 * what stays before anything happens, asks once more, and then deletes the sign-in and the Vela
 * account on the server. The phone is signed out afterwards; if that local sign-out fails, the
 * account is still deleted, and the screen says so rather than offering to try again.
 */
export default function DeleteAccountScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const account = useAccount();
  const push = usePush();
  const queries = useQueryClient();
  const deleteKey = useIdempotencyKey("delete-account");
  const [confirming, setConfirming] = useState(false);
  const [signedOutFailed, setSignedOutFailed] = useState(false);

  const deletion = useMutation({
    mutationFn: async () => deleteAccount(deleteKey({}), await account.token({ fresh: true })),
    onSuccess: async () => {
      setConfirming(false);
      queries.clear();
      try {
        await push.signOut();
        router.replace("/");
      } catch {
        setSignedOutFailed(true);
      }
    },
  });

  const failed = deletion.isError
    ? deletion.error instanceof ApiError && deletion.error.status === 401
      ? t`Your sign-in has expired. Sign in again, then delete your account.`
      : t`Your account could not be deleted just now. Nothing was changed. Try again.`
    : undefined;

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Delete account`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        {deletion.isSuccess ? (
          <Card>
            <Words variant="heading">
              <Trans>Your account is deleted.</Trans>
            </Words>
            {signedOutFailed ? (
              <Words variant="body" tone="ink2">
                <Trans>Close Vela and open it again to finish signing out on this phone.</Trans>
              </Words>
            ) : null}
            {deletion.data.kept > 0 ? (
              <Words variant="body" tone="ink2">
                <Trans>
                  Vela still writes to you on Telegram or LINE in a family where you are the only
                  organiser or have your own light. Say stop there to end it.
                </Trans>
              </Words>
            ) : null}
          </Card>
        ) : (
          <>
            <Words variant="body" tone="ink2">
              <Trans>
                Deleting your account removes your sign-in, this phone's notifications and your
                place in each family. Thirty days on, what is kept about you in a family is deleted.
              </Trans>
            </Words>
            <Words variant="body" tone="ink2">
              <Trans>
                Words, photos and voice messages you sent stay with the family, as they are part of
                their days.
              </Trans>
            </Words>
            <Words variant="body" tone="ink2">
              <Trans>
                If you are a family's only organiser, or Vela keeps your own light, you stay in that
                family on Telegram or LINE, so nobody is left without being told. To leave it too,
                say stop there or ask another member to organise first.
              </Trans>
            </Words>
            {account.signedIn && apiConfigured() ? (
              <SecondaryButton
                label={t`Delete my account`}
                disabled={deletion.isPending}
                onPress={() => setConfirming(true)}
              />
            ) : (
              <Words variant="body" tone="ink2">
                <Trans>Sign in to delete your account.</Trans>
              </Words>
            )}
            {failed === undefined ? null : (
              <Words variant="body" tone="ink2">
                {failed}
              </Words>
            )}
          </>
        )}
      </ScrollView>
      {confirming ? (
        <ConfirmationDialog
          onClose={() => {
            if (!deletion.isPending) setConfirming(false);
          }}
        >
          <Words variant="heading">
            <Trans>Delete your account?</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            <Trans>This cannot be undone.</Trans>
          </Words>
          <View style={{ gap: space.m }}>
            <SecondaryButton
              label={deletion.isPending ? t`Deleting…` : t`Delete my account`}
              disabled={deletion.isPending}
              onPress={() => deletion.mutate()}
            />
            <Pressable
              accessibilityRole="button"
              disabled={deletion.isPending}
              onPress={() => setConfirming(false)}
            >
              <Words variant="button" tone="action">
                <Trans>Keep my account</Trans>
              </Words>
            </Pressable>
          </View>
        </ConfirmationDialog>
      ) : null}
    </>
  );
}
