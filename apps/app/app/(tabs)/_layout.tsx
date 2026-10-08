import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import { type ColorValue, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandIcon, type BrandIconName } from "../../src/components/brand/icon.tsx";
import { usePalette } from "../../src/theme/theme.tsx";
import { space, type } from "../../src/theme/tokens.ts";

function TabIcon({
  name,
  color,
  focused,
}: {
  name: BrandIconName;
  color: ColorValue;
  focused: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        width: 56,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? palette.actionSoft : "transparent",
      }}
    >
      <BrandIcon name={name} color={color} size={22} />
    </View>
  );
}

/** Today · Exchanges · Sunday · You, and no badge counts anywhere (spec §14.1 A6). */
export default function TabsLayout() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { t } = useLingui();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.action,
        tabBarInactiveTintColor: palette.ink3,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.rule,
          height: 76 + Math.max(0, fontScale - 1) * 24 + insets.bottom,
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
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="today" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="exchanges"
        options={{
          title: t({ context: "tab", message: "Exchanges" }),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="exchanges" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="sunday"
        options={{
          title: t({ context: "tab", message: "Sunday" }),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="sunday" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t({ context: "tab", message: "You" }),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="you" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
