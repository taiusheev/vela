import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { usePalette } from "../../theme/theme.tsx";
import { space } from "../../theme/tokens.ts";
import { Words } from "../ui.tsx";
import { BrandIcon } from "./icon.tsx";

/** Assistance stays optional; opening it never changes the person's draft. */
export function SuggestionDisclosure({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: p.rule }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{
          minHeight: 56,
          paddingVertical: space.l,
          flexDirection: "row",
          alignItems: "center",
          gap: space.m,
        }}
      >
        <View style={{ flex: 1 }}>
          <Words variant="bodyMedium">{label}</Words>
        </View>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <BrandIcon name="chevron" color={p.ink2} size={20} />
        </View>
      </Pressable>
      {open ? <View style={{ paddingBottom: space.l, gap: space.l }}>{children}</View> : null}
    </View>
  );
}
