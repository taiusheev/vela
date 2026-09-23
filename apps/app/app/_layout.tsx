import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Literata_400Regular, Literata_600SemiBold } from "@expo-google-fonts/literata";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountProvider, accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { ThemeProvider, useTheme } from "../src/theme/theme.tsx";

void SplashScreen.preventAutoHideAsync();

const queries = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

/** Nobody reaches a family's screens without a session, once accounts are configured. */
function useSignInGuard(): void {
  const account = useAccount();
  const segments = useSegments();
  const router = useRouter();
  const onSignIn = segments[0] === "sign-in";
  useEffect(() => {
    if (!accountsConfigured() || !account.ready) return;
    if (!account.signedIn && !onSignIn) router.replace("/sign-in");
    if (account.signedIn && onSignIn) router.replace("/");
  }, [account.ready, account.signedIn, onSignIn, router]);
}

function Root() {
  const { palette, scheme } = useTheme();
  useSignInGuard();
  const [ready] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Literata_400Regular,
    Literata_600SemiBold,
  });

  // The screens render before Literata and Inter arrive, with the platform's own faces standing in:
  // a slow network must not leave a family looking at nothing.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

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
        <SafeAreaProvider>
          <ThemeProvider>
            <Root />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </AccountProvider>
  );
}
