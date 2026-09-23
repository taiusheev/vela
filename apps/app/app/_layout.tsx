import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Literata_400Regular, Literata_600SemiBold } from "@expo-google-fonts/literata";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "../src/theme/theme.tsx";

void SplashScreen.preventAutoHideAsync();

function Root() {
  const { palette, scheme } = useTheme();
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
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
