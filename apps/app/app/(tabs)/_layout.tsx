import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import { type ColorValue, Text, useWindowDimensions, View } from "react-native";
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
        width: 48,
        height: 28,
        borderRadius: 12,
        borderTopColor: palette.action,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? palette.actionSoft : "transparent",
      }}
    >
      <BrandIcon name={name} color={color} size={22} />
    </View>
  );
}

/**
 * Today · Memories · Questions (+) · Sunday · You, and no badge counts anywhere (spec §14.1 A6). The chat with a
 * parent opens from Today, as a messenger opens a conversation; Memories keeps her words and the
 * family book (consumer flow, apps/app/docs/consumer-flow.md).
 */
export default function TabsLayout() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { fontScale, width } = useWindowDimensions();
  const barHeight = 68 + Math.max(0, fontScale - 1) * 24;
  const barBottom = Math.max(insets.bottom, space.m);
  const { t } = useLingui();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.action,
        tabBarInactiveTintColor: palette.ink3,
        tabBarStyle: {
          position: "absolute",
          left: Math.max(space.m, (width - 560) / 2),
          right: Math.max(space.m, (width - 560) / 2),
          bottom: barBottom,
          backgroundColor: palette.surface,
          borderColor: palette.rule,
          borderWidth: 1,
          borderTopColor: palette.rule,
          borderTopWidth: 1,
          borderRadius: 32,
          height: barHeight,
          paddingTop: 6,
          paddingBottom: 6,
        },
        sceneStyle: { backgroundColor: palette.bg, paddingBottom: barHeight + barBottom + space.m },
        tabBarIconStyle: { width: 48, height: 28, marginBottom: 2 },
        // On a 320 pt phone a tab is 59 pt wide; "Memories" needs 53, and the tab button keeps
        // 5 pt of padding on each side. The label reaches into that padding, and a label that still
        // does not fit (large text) shrinks instead of ending in "…".
        tabBarLabel: ({ color, children }) => (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={1.4}
            style={{
              fontFamily: type.label.fontFamily,
              fontSize: 11,
              lineHeight: 14,
              alignSelf: "stretch",
              marginHorizontal: -5,
              // The web caps a one-line label at its parent's content width; lift it.
              maxWidth: 999,
              textAlign: "center",
              color,
            }}
          >
            {children}
          </Text>
        ),
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
          title: t({ context: "tab", message: "Memories" }),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="book" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="questions"
        options={{
          title: t`Questions`,
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: t`Questions — add a question`,
          tabBarButtonTestID: "questions-tab",
          tabBarIcon: () => (
            <View
              style={{
                width: 44,
                height: 40,
                borderRadius: 20,
                backgroundColor: palette.action,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BrandIcon name="plus" color={palette.onAction} size={25} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="sunday"
        options={{
          title: t({ context: "tab", message: "Week" }),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="calendar" color={color} focused={focused} />
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
