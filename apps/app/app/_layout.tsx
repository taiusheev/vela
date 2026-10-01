import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Literata_400Regular, Literata_600SemiBold } from "@expo-google-fonts/literata";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountProvider, accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { readDeviceToken } from "../src/device/token.ts";
import { LocaleProvider, useAppLocale } from "../src/i18n/provider.tsx";
import { PushProvider } from "../src/push/provider.tsx";
import { useOpenTapped } from "../src/push/useOpenTapped.ts";
import { ThemeProvider, useTheme } from "../src/theme/theme.tsx";

void SplashScreen.preventAutoHideAsync();

const queries = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

/**
 * A phone set up for her (ADR-35) opens on her screen and nowhere else; the token it keeps is read
 * once, at start. Undefined until it has been read, so the sign-in guard waits for it.
 */
function useParentMode(): boolean | undefined {
  const [parent, setParent] = useState<boolean | undefined>(undefined);
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
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

/** Nobody reaches a family's screens without a session, once accounts are configured. */
function useSignInGuard(parent: boolean | undefined): void {
  const account = useAccount();
  const segments = useSegments();
  const router = useRouter();
  const onSignIn = segments[0] === "sign-in";
  const onParent = segments[0] === "parent";
  useEffect(() => {
    if (!accountsConfigured() || !account.ready || parent !== false || onParent) return;
    if (!account.signedIn && !onSignIn) router.replace("/sign-in");
    if (account.signedIn && onSignIn) router.replace("/");
  }, [account.ready, account.signedIn, onSignIn, onParent, parent, router]);
}

function Root() {
  const { palette, scheme } = useTheme();
  const { settled } = useAppLocale();
  const parent = useParentMode();
  useSignInGuard(parent);
  // A tapped notification opens where it points once the account and the navigator are ready.
  useOpenTapped();
  const [ready] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Literata_400Regular,
    Literata_600SemiBold,
  });

  // The screens render before Literata and Inter arrive, with the platform's own faces standing in:
  // a slow network must not leave a family looking at nothing. The splash also waits for a phone to
  // read the language it remembers, so the first words seen are in that language.
  useEffect(() => {
    if (ready && settled) void SplashScreen.hideAsync();
  }, [ready, settled]);

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <AccountProvider>
      <QueryClientProvider client={queries}>
        <LocaleProvider>
          <PushProvider>
            <SafeAreaProvider>
              <ThemeProvider>
                <Root />
              </ThemeProvider>
            </SafeAreaProvider>
          </PushProvider>
        </LocaleProvider>
      </QueryClientProvider>
    </AccountProvider>
  );
}
