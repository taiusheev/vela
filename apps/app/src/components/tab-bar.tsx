import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "../accessibility/use-reduced-motion.ts";
import { usePalette } from "../theme/theme.tsx";
import { type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";

/** Which drawing each tab wears. Every tab is a place with a label; adding happens inside a page. */
const ICONS: Record<string, BrandIconName> = {
  index: "today",
  exchanges: "book",
  questions: "questions",
  sunday: "calendar",
  you: "you",
};
const FALLBACK_ICON: BrandIconName = "today";

/** Wide enough for five thumbs, narrow enough that an iPad does not stretch them apart. */
const MAX_ROW = 560;
const INDICATOR = 28;

/**
 * Docked to the bottom edge like the phone's own apps: one hairline above, no floating capsule. The
 * page you are on gets a filled icon, a darker label and a short line that slides over to it, so
 * moving between tabs reads as one motion rather than a highlight blinking from place to place.
 */
export function VelaTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const palette = usePalette();
  const reduced = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const [rowWidth, setRowWidth] = useState(0);
  const slot = rowWidth / state.routes.length;
  const position = useRef(new Animated.Value(state.index)).current;

  useEffect(() => {
    if (reduced) {
      position.setValue(state.index);
      return;
    }
    Animated.spring(position, {
      toValue: state.index,
      stiffness: 260,
      damping: 26,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [position, reduced, state.index]);

  const rowHeight = 54 + Math.max(0, Math.min(fontScale, 1.4) - 1) * 24;
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderTopWidth: 1,
        borderTopColor: palette.rule,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      <View
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        style={{
          flexDirection: "row",
          width: "100%",
          maxWidth: MAX_ROW,
          alignSelf: "center",
          height: rowHeight,
        }}
      >
        {slot > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: -1,
              left: 0,
              width: INDICATOR,
              height: 2,
              borderRadius: 1,
              backgroundColor: palette.action,
              transform: [
                {
                  translateX: position.interpolate({
                    inputRange: [0, 1],
                    outputRange: [(slot - INDICATOR) / 2, (slot - INDICATOR) / 2 + slot],
                    extrapolate: "extend",
                  }),
                },
              ],
            }}
          />
        ) : null}
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          if (!descriptor) return null;
          const { options } = descriptor;
          const focused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
          const title = options.title ?? route.name;
          const icon = ICONS[route.name];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? title}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              {({ pressed }) => (
                <TabItem
                  icon={icon ?? FALLBACK_ICON}
                  title={title}
                  focused={focused}
                  pressed={pressed}
                  reduced={reduced}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Presses sink a little and settle back; the page change itself is the indicator's job. */
function usePress(pressed: boolean, reduced: boolean) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.spring(scale, {
      toValue: pressed ? 0.9 : 1,
      stiffness: pressed ? 600 : 320,
      damping: pressed ? 40 : 18,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [pressed, reduced, scale]);
  return scale;
}

function TabItem({
  icon,
  title,
  focused,
  pressed,
  reduced,
}: {
  icon: BrandIconName;
  title: string;
  focused: boolean;
  pressed: boolean;
  reduced: boolean;
}) {
  const palette = usePalette();
  const lit = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const scale = usePress(pressed, reduced);
  useEffect(() => {
    if (reduced) {
      lit.setValue(focused ? 1 : 0);
      return;
    }
    Animated.timing(lit, {
      toValue: focused ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused, lit, reduced]);
  const dim = lit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const label = {
    fontFamily: type.label.fontFamily,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
  } as const;
  return (
    <Animated.View style={{ alignItems: "center", alignSelf: "stretch", transform: [{ scale }] }}>
      <View style={{ width: 26, height: 26 }}>
        <Animated.View style={{ position: "absolute", opacity: dim }}>
          <BrandIcon name={icon} color={palette.ink3} size={26} />
        </Animated.View>
        <Animated.View
          style={{
            position: "absolute",
            opacity: lit,
            transform: [{ scale: lit.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
          }}
        >
          <BrandIcon
            name={icon}
            color={palette.action}
            fill={palette.actionSoft}
            strokeWidth={1.9}
            size={26}
          />
        </Animated.View>
      </View>
      {/* Two labels share one place so the colour can cross-fade on the native driver. On a
          320 pt phone a tab is 64 pt wide; a label that still does not fit (large text) shrinks
          instead of ending in "…". */}
      <View style={{ marginTop: 3, alignSelf: "stretch" }}>
        <Animated.Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          maxFontSizeMultiplier={1.4}
          style={[label, { color: palette.ink3, opacity: dim }]}
        >
          {title}
        </Animated.Text>
        <Animated.Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          maxFontSizeMultiplier={1.4}
          aria-hidden
          style={[
            label,
            { position: "absolute", left: 0, right: 0, color: palette.ink, opacity: lit },
          ]}
        >
          {title}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}
