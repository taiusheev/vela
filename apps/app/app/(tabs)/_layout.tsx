import { useLingui } from "@lingui/react/macro";
import { Tabs } from "expo-router";
import { VelaTabBar } from "../../src/components/tab-bar.tsx";
import { usePalette } from "../../src/theme/theme.tsx";

/**
 * Today · Memories · Questions (+) · Week · You, and no badge counts anywhere (spec §14.1 A6). The chat with a
 * parent opens from Today, as a messenger opens a conversation; Memories keeps her words and the
 * family book (consumer flow, apps/app/docs/consumer-flow.md). The bar itself is drawn by
 * VelaTabBar, which picks each tab's icon by route name.
 */
export default function TabsLayout() {
  const palette = usePalette();
  const { t } = useLingui();
  return (
    <Tabs
      tabBar={(props) => <VelaTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t({ context: "tab", message: "Today" }),
        }}
      />
      <Tabs.Screen
        name="exchanges"
        options={{
          title: t({ context: "tab", message: "Memories" }),
        }}
      />
      <Tabs.Screen
        name="questions"
        options={{
          title: t`Questions`,
          tabBarAccessibilityLabel: t`Questions — add a question`,
          tabBarButtonTestID: "questions-tab",
        }}
      />
      <Tabs.Screen
        name="sunday"
        options={{
          title: t({ context: "tab", message: "Week" }),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t({ context: "tab", message: "You" }),
        }}
      />
    </Tabs>
  );
}
