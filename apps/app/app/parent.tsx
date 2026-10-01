import { Trans, useLingui } from "@lingui/react/macro";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useParent } from "../src/device/useParent.ts";
import { lightPalette as light } from "../src/theme/tokens.ts";

/**
 * The parent surface (spec §14.2, ADR-35): one message at a time, Vela's newest to her, in large
 * type, with its buttons as large targets and her own words below. It is her consent (P1), her
 * morning's question (P2), a photo choice's 1 and 2 (P3), and Vela's thanks after she answers
 * (P5), because each is the message Vela sent her phone last. Light mode only, body 22 pt or more,
 * targets 64 pt or more, ink on cream for 7:1 contrast; no tabs, no menus.
 */
export default function ParentScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const view = useParent();
  const [words, setWords] = useState("");
  const send = async () => {
    if (await view.say(words)) setWords("");
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 48 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {view.loading ? (
          <Text style={styles.body}>
            <Trans>One moment…</Trans>
          </Text>
        ) : !view.linked ? (
          <>
            <Text style={styles.body}>
              <Trans>
                This phone is not set up for Vela any more. Ask your family to set it up again.
              </Trans>
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.secondary}
              onPress={() => router.replace("/sign-in")}
            >
              <Text style={styles.secondaryLabel}>
                <Trans>Sign in as family</Trans>
              </Text>
            </Pressable>
          </>
        ) : view.message === null ? (
          <Text style={styles.body}>
            <Trans>Nothing yet today. Your morning message will be here.</Trans>
          </Text>
        ) : (
          <>
            {view.name.length > 0 ? <Text style={styles.greeting}>{view.name}</Text> : null}
            <Text style={styles.message} accessibilityRole="text">
              {view.message.text}
            </Text>
            <View style={styles.buttons}>
              {view.message.buttons.flat().map((button) => (
                <Pressable
                  key={button.id}
                  accessibilityRole="button"
                  disabled={view.sending}
                  style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
                  onPress={() => view.tap(button.id)}
                >
                  <Text style={styles.primaryLabel}>{button.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={words}
              onChangeText={setWords}
              placeholder={t`Or say it in your own words`}
              placeholderTextColor={light.ink3}
              multiline
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={view.sending || words.trim().length === 0}
              style={({ pressed }) => [
                styles.secondary,
                words.trim().length === 0 ? styles.disabled : null,
                pressed ? styles.pressed : null,
              ]}
              onPress={() => void send()}
            >
              <Text style={styles.secondaryLabel}>{view.sending ? t`Sending…` : t`Send`}</Text>
            </Pressable>
          </>
        )}
        {view.trouble === undefined ? null : <Text style={styles.body}>{view.trouble}</Text>}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: light.bg },
  content: { paddingHorizontal: 24, gap: 24 },
  greeting: { fontFamily: "Inter_500Medium", fontSize: 22, lineHeight: 30, color: light.ink2 },
  message: { fontFamily: "Literata_400Regular", fontSize: 28, lineHeight: 40, color: light.ink },
  body: { fontFamily: "Inter_400Regular", fontSize: 22, lineHeight: 32, color: light.ink },
  buttons: { gap: 16 },
  primary: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: light.action,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  primaryLabel: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: light.surface },
  secondary: {
    minHeight: 64,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: light.action,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  secondaryLabel: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: light.action },
  input: {
    minHeight: 112,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: light.rule,
    backgroundColor: light.surface,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontFamily: "Inter_400Regular",
    fontSize: 22,
    color: light.ink,
    textAlignVertical: "top",
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
});
