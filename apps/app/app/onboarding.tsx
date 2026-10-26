import { Trans, useLingui } from "@lingui/react/macro";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { LoadingLight } from "../src/components/loading-light.tsx";
import { SeeItFirst } from "../src/components/onboarding/see-it-first.tsx";
import { TelegramFamilyLink } from "../src/components/telegram-family-link.tsx";
import { Card, SecondaryButton, Words } from "../src/components/ui.tsx";
import { resetDraft, useOnboardingDraft } from "../src/data/onboarding-draft.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * Onboarding (spec §14.1 A1, A4, A5). A family starts here with the See It First story and its
 * questions, before any account (`src/components/onboarding`). Where the API starts families in
 * Telegram (the English trial's pilot, `telegram_first`), the organiser connects the family they
 * already have there instead, as before.
 */
export default function OnboardingScreen() {
  const account = useAccount();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {apiConfigured() && account.signedIn ? <SignedIn /> : <SeeItFirst />}
    </>
  );
}

/** Signed in: the API says whether families start in Telegram or here. */
function SignedIn() {
  const capabilities = useCapabilities();
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  const draft = useOnboardingDraft();
  if (preview === "1" && draft.step !== "save") return <SeeItFirst />;
  if (capabilities.capabilities?.telegram_first === false) return <SeeItFirst />;
  return <TelegramFirst waiting={capabilities.capabilities === undefined} />;
}

function TelegramFirst({ waiting }: { waiting: boolean }) {
  const account = useAccount();
  const connectionScope = `${account.userId}:${account.sessionId ?? ""}`;
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const capabilities = useCapabilities();
  const { noAccount, noFamily, loading, trouble, refresh } = useToday();
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.l,
        }}
      >
        {waiting ? (
          <>
            {capabilities.isError ? (
              <Words variant="body" tone="ink2">
                {t`Pilot setup could not be reached just now.`}
              </Words>
            ) : (
              <LoadingLight label={t`Loading pilot setup…`} />
            )}
            <SecondaryButton label={t`Try again`} onPress={() => void capabilities.refetch()} />
          </>
        ) : loading ? (
          <LoadingLight label={t`Loading your family…`} />
        ) : trouble ? (
          <>
            <Words variant="body" tone="ink2">
              <Trans>Your account could not be loaded. Check your connection and try again.</Trans>
            </Words>
            <SecondaryButton label={t`Try again`} onPress={refresh} />
          </>
        ) : (
          <Card>
            {!noAccount && !noFamily ? (
              <>
                <Words variant="body">
                  <Trans>Your family stays together when you update Vela.</Trans>
                </Words>
                <SecondaryButton
                  label={t`Go to Today`}
                  onPress={() => {
                    resetDraft();
                    router.replace("/");
                  }}
                />
              </>
            ) : (
              <TelegramFamilyLink key={connectionScope} noAccount={noAccount} />
            )}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
