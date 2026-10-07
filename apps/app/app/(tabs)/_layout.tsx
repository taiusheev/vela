import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { usePalette } from "../../src/theme/theme.tsx";
import { space, type } from "../../src/theme/tokens.ts";

/** Today · Exchanges · Sunday · You, and no badge counts anywhere (spec §14.1 A6). */
export default function TabsLayout() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.action,
        tabBarInactiveTintColor: palette.ink3,
        tabBarStyle: {
          backgroundColor: palette.bg,
          borderTopColor: palette.rule,
          height: 80 + insets.bottom,
          paddingTop: space.s,
          paddingBottom: insets.bottom + space.m,
        },
        tabBarLabelStyle: { fontFamily: type.label.fontFamily, fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t({ context: "tab", message: "Today" }),
          tabBarIcon: ({ color }) => <BrandIcon name="today" color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="exchanges"
        options={{
          title: t({ context: "tab", message: "Exchanges" }),
          tabBarIcon: ({ color }) => <BrandIcon name="exchanges" color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="sunday"
        options={{
          title: t({ context: "tab", message: "Sunday" }),
          tabBarIcon: ({ color }) => <BrandIcon name="sunday" color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t({ context: "tab", message: "You" }),
          tabBarIcon: ({ color }) => <BrandIcon name="you" color={color} size={24} />,
        }}
      />
    </Tabs>
  );
}
