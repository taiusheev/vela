import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { ConfirmationDialog } from "../src/components/confirmation-dialog.tsx";
import { SettingsNote, SettingsRow, SettingsSection } from "../src/components/settings-list.tsx";
import { TestSignInDetails } from "../src/components/test-sign-in-details.tsx";
import { SecondaryButton, Words } from "../src/components/ui.tsx";
import { useFamily } from "../src/data/useFamily.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePush } from "../src/push/provider.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * Account, opened from the last row on You: signing out, leaving the family and deleting the
 * account. They are rare and hard to undo, so they live one page down from where the reader spends
 * their time, drawn quietly, each with its own question before anything happens. Delete account
 * stays two taps from You, as App Store guideline 5.1.1(v) asks: easy to find, never in the way.
 */
export default function AccountScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const account = useAccount();
  const push = usePush();
  const day = useToday();
  const { family, live, leave, changing, refused } = useFamily(
    day.familyId,
    day.familyId !== undefined,
  );
  const signingOut = useMutation({ mutationFn: () => push.signOut() });
  const [leaving, setLeaving] = useState(false);
  const [exampleNote, setExampleNote] = useState(false);
  const { familyName } = family;
  // A kept light pauses and stops in her own chat, where her mornings arrive (spec §9).
  const canLeave = !((!live && apiConfigured()) || family.me.lightOn) && familyName !== "";

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Account`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.l,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.l,
          gap: space.xxl,
        }}
      >
        {account.signedIn ? (
          <SettingsSection
            footer={
              <>
                {signingOut.isError ? (
                  <SettingsNote tone="ink2">
                    <Trans>Sign-out did not finish. You are still signed in. Try again.</Trans>
                  </SettingsNote>
                ) : null}
                <TestSignInDetails />
              </>
            }
          >
            {/* push (A5): the phone is let go from the account first, so a phone handed on is not told. */}
            <SettingsRow
              icon="back"
              title={signingOut.isPending ? t`Signing out…` : t`Sign out`}
              disabled={signingOut.isPending}
              onPress={() => signingOut.mutate()}
            />
          </SettingsSection>
        ) : (
          <View style={{ paddingHorizontal: space.xs }}>
            <SettingsNote>
              <Trans>Sign in to connect your family.</Trans>
            </SettingsNote>
          </View>
        )}

        {canLeave || account.signedIn ? (
          <SettingsSection
            title={t`Leave or delete`}
            footer={
              <>
                {refused === undefined ? null : <SettingsNote tone="ink2">{refused}</SettingsNote>}
                {exampleNote ? (
                  <SettingsNote>
                    <Trans>This is the example family, so nobody left.</Trans>
                  </SettingsNote>
                ) : null}
                {familyName === "" ? null : (
                  <SettingsNote>
                    <Trans>
                      To take a break instead, pause your turns on You. Nothing is deleted.
                    </Trans>
                  </SettingsNote>
                )}
              </>
            }
          >
            {canLeave ? (
              <SettingsRow
                quiet
                icon="leave"
                title={t`Leave ${familyName}`}
                disabled={changing || signingOut.isPending}
                onPress={() => {
                  setExampleNote(false);
                  setLeaving(true);
                }}
              />
            ) : null}
            {account.signedIn ? (
              <SettingsRow
                quiet
                icon="trash"
                title={t`Delete account`}
                disabled={signingOut.isPending}
                onPress={() => router.push("/delete-account")}
              />
            ) : null}
          </SettingsSection>
        ) : null}
      </ScrollView>

      {leaving ? (
        <ConfirmationDialog
          onClose={() => {
            if (!changing) setLeaving(false);
          }}
        >
          <Words variant="heading">
            <Trans>Leave {familyName}?</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            <Trans>
              You will stop seeing the family's days and taking turns. Thirty days on, what is kept
              about you is deleted.
            </Trans>
          </Words>
          {refused === undefined ? null : (
            <Words variant="body" tone="ink2">
              {refused}
            </Words>
          )}
          <SecondaryButton
            label={changing ? t`Leaving…` : t`Leave the family`}
            disabled={changing}
            onPress={() => {
              if (!live) {
                setLeaving(false);
                setExampleNote(true);
                return;
              }
              leave(() => router.replace("/"));
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={changing}
            onPress={() => setLeaving(false)}
          >
            <Words variant="button" tone="action">
              <Trans>Stay</Trans>
            </Words>
          </Pressable>
        </ConfirmationDialog>
      ) : null}
    </>
  );
}
