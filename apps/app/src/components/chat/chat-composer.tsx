import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import { usePalette } from "../../theme/theme.tsx";
import { hitSlop, space, type } from "../../theme/tokens.ts";
import { BrandIcon } from "../brand/icon.tsx";

/**
 * The bar at the foot of the chat, as people know it from their messengers: "+" on the left for
 * something for her morning, a field that grows with the words, and a round send button that
 * wakes once there is something to send.
 */
export function ChatComposer({
  value,
  onChangeText,
  placeholder,
  sendLabel,
  onSend,
  onMore,
  disabled,
  canSend,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** What the send button does, for a screen reader: "Send now", "Save for her first morning". */
  sendLabel: string;
  onSend: () => void;
  onMore?: () => void;
  disabled: boolean;
  canSend: boolean;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const [focused, setFocused] = useState(false);
  const ready = canSend && !disabled && value.trim().length > 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.s }}>
      {onMore === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Something for her morning`}
          testID="chat-more"
          hitSlop={hitSlop}
          onPress={onMore}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: palette.rule,
            backgroundColor: pressed ? palette.surface2 : palette.surface,
          })}
        >
          <BrandIcon name="plus" color={palette.action} size={22} strokeWidth={2} />
        </Pressable>
      )}
      <View
        style={{
          flex: 1,
          minHeight: 44,
          justifyContent: "center",
          borderRadius: 22,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? palette.action : palette.rule,
          backgroundColor: palette.surface,
          paddingHorizontal: focused ? space.l - 1 : space.l,
        }}
      >
        <TextInput
          accessibilityLabel={placeholder}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.ink3}
          multiline
          // One line to start, growing with the words, as a messenger's field does. The web draws
          // a multiline field two rows tall unless told; a phone's field already starts at one.
          {...(Platform.OS === "web" ? { numberOfLines: 1 } : {})}
          maxLength={1000}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            type.body,
            {
              color: palette.ink,
              maxHeight: 132,
              paddingTop: 10,
              paddingBottom: 10,
              // The web draws its own focus ring around a field; the pill already shows focus.
              outlineStyle: "none",
            } as object,
          ]}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sendLabel}
        testID="chat-send"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        hitSlop={hitSlop}
        onPress={onSend}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ready ? palette.action : palette.surface2,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <BrandIcon
          name="send"
          color={ready ? palette.onAction : palette.ink3}
          size={22}
          strokeWidth={2.2}
        />
      </Pressable>
    </View>
  );
}
