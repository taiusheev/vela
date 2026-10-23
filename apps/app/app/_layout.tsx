import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  Literata_400Regular,
  Literata_500Medium,
  Literata_600SemiBold,
} from "@expo-google-fonts/literata";
import { focusManager, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { UsageAnalytics } from "../src/analytics/provider.tsx";
import { apiConfigured, fetchMe } from "../src/api/client.ts";
import { sessionRequests } from "../src/api/request-session.ts";
import { englishTrialBuild } from "../src/api/trial.ts";
import { clearAudioCache } from "../src/audio/cache.ts";
import { AccountProvider, accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { AppPrivacyGate } from "../src/components/app-privacy.tsx";
import { AskOutcomeProvider } from "../src/data/ask-outcome.tsx";
import { FamilySelectionProvider } from "../src/data/family-selection.tsx";
import { sessionScope } from "../src/data/live-state.ts";
import { activateOnboardingSession, readDraft } from "../src/data/onboarding-draft.ts";
import { clearPhotoCache } from "../src/data/photos.ts";
import { readDeviceToken } from "../src/device/token.ts";
import { LocaleProvider, useAppLocale } from "../src/i18n/provider.tsx";
import { PushProvider } from "../src/push/provider.tsx";
import { useOpenTapped } from "../src/push/useOpenTapped.ts";
import { activatePrivateSession, clearSessionDrafts } from "../src/storage/drafts.ts";
import {
  activatePortraitSession,
  clearPortraitSession,
  closePortraitSession,
} from "../src/storage/portraits.ts";
import { ThemeProvider, useTheme } from "../src/theme/theme.tsx";

void SplashScreen.preventAutoHideAsync();

function SessionQueries({ children, scope }: { children: ReactNode; scope: string }) {
  const [queries] = useState(() => {
    sessionRequests.activate(scope);
    clearPhotoCache();
    activatePrivateSession(scope);
    activatePortraitSession(scope);
    return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000 } } });
  });
  useEffect(() => {
    sessionRequests.activate(scope);
    activatePrivateSession(scope);
    activatePortraitSession(scope);
    const subscription = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    return () => {
      sessionRequests.end(scope);
      subscription.remove();
      void queries.cancelQueries();
      queries.clear();
      clearPhotoCache();
      void clearAudioCache();
      try {
        closePortraitSession(scope);
      } catch {
        /* The closed session cannot read or save portraits. */
      }
      void clearSessionDrafts(scope);
    };
  }, [queries, scope]);
  return (
    <QueryClientProvider client={queries}>
      <WarmAccount />
      <FamilySelectionProvider>
        <AskOutcomeProvider>{children}</AskOutcomeProvider>
      </FamilySelectionProvider>
    </QueryClientProvider>
  );
}
/** Start the signed-in account read while bundled fonts and language initialise. */
function WarmAccount() {
  const account = useAccount();
  useQuery({
    queryKey: ["me"],
    enabled: apiConfigured() && account.ready && account.signedIn,
    queryFn: async () => fetchMe(await account.token()),
  });
  return null;
}
function AccountQueries({ children }: { children: ReactNode }) {
  const account = useAccount();
  const scope = sessionScope(account);
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current !== scope) {
      try {
        clearPortraitSession(previousScope.current);
      } catch {
        /* Closed scopes reject reads and late picker results even if file cleanup fails. */
      }
      previousScope.current = scope;
    }
  }, [scope]);
  activateOnboardingSession(account.signedIn ? scope : "guest");
  return (
    <SessionQueries key={scope} scope={scope}>
      {children}
    </SessionQueries>
  );
}

/**
 * A phone set up for her (ADR-35) opens on her screen and nowhere else; the token it keeps is read
 * once, at start. Undefined until it has been read, so the sign-in guard waits for it.
 */
function useParentMode(): boolean | undefined {
  const [parent, setParent] = useState<boolean | undefined>(undefined);
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (englishTrialBuild) {
      setParent(false);
      return;
    }
    let current = true;
    void readDeviceToken().then((token) => {
      if (current) setParent(token !== null);
    });
    return () => {
      current = false;
    };
  }, []);
  const onParent = segments[0] === "parent";
  useEffect(() => {
    if (parent === true && !onParent) router.replace("/parent");
  }, [parent, onParent, router]);
  // The family's screens stay upright on a phone; her screen turns, for the kitchen table (P6).
  useEffect(() => {
    if (parent === false && Platform.OS !== "web") {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    }
  }, [parent]);
  return parent;
}

/** Family data still requires sign-in; the local introduction and setup preview do not. */
function useSignInGuard(parent: boolean | undefined): void {
  const account = useAccount();
  const segments = useSegments();
  const router = useRouter();
  const onSignIn = segments[0] === "sign-in";
  const onHelp = segments[0] === "help";
  const onParent = segments[0] === "parent";
  const onOnboarding = segments[0] === "onboarding";
  useEffect(() => {
    if (!accountsConfigured() || !account.ready || parent !== false) return;
    if (onParent) {
      if (englishTrialBuild) router.replace(account.signedIn ? "/" : "/sign-in");
      return;
    }
    if (!account.signedIn && !onSignIn && !onHelp && !onOnboarding) router.replace("/onboarding");
    if (account.signedIn && onSignIn)
      router.replace(readDraft().step === "save" ? "/onboarding" : "/");
  }, [account.ready, account.signedIn, onSignIn, onHelp, onParent, onOnboarding, parent, router]);
}

function Root() {
  const { settled } = useAppLocale();
  const [ready, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Literata_400Regular,
    Literata_500Medium,
    Literata_600SemiBold,
  });

  // Native text can retain its fallback face if mounted before its font is registered. Native
  // fonts are bundled, so keep the splash until they and the remembered language are ready.
  // A font failure still opens the app with system faces; web keeps its immediate fallback render.
  useEffect(() => {
    if ((ready || fontError !== null) && settled) void SplashScreen.hideAsync();
  }, [ready, fontError, settled]);

  if (Platform.OS !== "web" && (!settled || (!ready && fontError === null))) return null;

  return <Navigation />;
}

function Navigation() {
  const { palette, scheme } = useTheme();
  const parent = useParentMode();
  const segments = useSegments();
  useSignInGuard(parent);
  // A tapped notification opens where it points once the account and the navigator are ready.
  useOpenTapped();

  // An old parent-device route must not mount or read its retained token in a trial organiser build.
  if (englishTrialBuild && segments[0] === "parent") return null;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <AppPrivacyGate>
        <UsageAnalytics />
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: palette.bg },
            headerTintColor: palette.ink,
            headerShadowVisible: false,
            headerTitleStyle: { fontFamily: "Inter_600SemiBold", fontSize: 17 },
            contentStyle: { backgroundColor: palette.bg },
          }}
        />
      </AppPrivacyGate>
    </>
  );
}

export default function RootLayout() {
  return (
    <AccountProvider>
      <AccountQueries>
        <LocaleProvider>
          <PushProvider>
            <SafeAreaProvider>
              <ThemeProvider>
                <Root />
              </ThemeProvider>
            </SafeAreaProvider>
          </PushProvider>
        </LocaleProvider>
      </AccountQueries>
    </AccountProvider>
  );
}
