import type { ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../accessibility/use-reduced-motion.ts";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { Card } from "./ui.tsx";

/** A long underlying page must never leave the confirmation's actions below the viewport. */
export function ConfirmationDialog({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return (
    <Modal
      visible
      transparent
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: palette.bg,
          paddingHorizontal: space.margin,
          paddingTop: insets.top + space.margin,
          paddingBottom: insets.bottom + space.margin,
        }}
      >
        <ScrollView style={{ flexGrow: 0, maxHeight: "100%" }} keyboardShouldPersistTaps="handled">
          <Card>{children}</Card>
        </ScrollView>
      </View>
    </Modal>
  );
}
