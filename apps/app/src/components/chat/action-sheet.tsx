import { useLingui } from "@lingui/react/macro";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../../accessibility/use-reduced-motion.ts";
import { usePalette } from "../../theme/theme.tsx";
import { radius, sheetShadow, space, type } from "../../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "../brand/icon.tsx";

export interface SheetAction {
  icon: BrandIconName;
  label: string;
  detail?: string;
  onPress: () => void;
}

/** A short list of things to do, rising from the foot of the screen, as a phone's own sheets do. */
export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  title: string;
  actions: readonly SheetAction[];
  onClose: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { t } = useLingui();
  return (
    <Modal
      visible
      transparent
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`Close`}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(30,26,22,0.32)" }}
      />
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: palette.bg,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          paddingTop: space.m,
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.l,
          gap: space.xs,
          ...sheetShadow,
        }}
      >
        <View
          style={{
            alignSelf: "center",
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: palette.rule,
            marginBottom: space.s,
          }}
        />
        <Text accessibilityRole="header" style={[type.heading, { color: palette.ink }]}>
          {title}
        </Text>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              action.onPress();
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.l,
              minHeight: 56,
              paddingVertical: space.s,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: palette.actionSoft,
              }}
            >
              <BrandIcon name={action.icon} color={palette.action} size={20} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.bodyMedium, { color: palette.ink }]}>{action.label}</Text>
              {action.detail === undefined ? null : (
                <Text style={[type.caption, { color: palette.ink2 }]}>{action.detail}</Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}
