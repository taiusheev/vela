import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../src/theme/theme.tsx";
import { space, type } from "../../src/theme/tokens.ts";

/** Today · Exchanges · Sunday · You, and no badge counts anywhere (spec §14.1 A6). */
export default function TabsLayout() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.action,
        tabBarInactiveTintColor: palette.ink3,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.rule,
          height: 72 + insets.bottom,
          paddingTop: space.s,
          paddingBottom: insets.bottom + space.m,
        },
        tabBarLabelStyle: { fontFamily: type.label.fontFamily, fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◐</Text>,
        }}
      />
      <Tabs.Screen
        name="exchanges"
        options={{
          title: "Exchanges",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>≡</Text>,
        }}
      />
      <Tabs.Screen
        name="sunday"
        options={{
          title: "Sunday",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>✦</Text>,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: "You",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◇</Text>,
        }}
      />
    </Tabs>
  );
}
