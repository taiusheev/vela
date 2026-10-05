import { Trans } from "@lingui/react/macro";
import { useKeepAwake } from "expo-keep-awake";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lightPalette as light } from "../theme/tokens.ts";
import { photoAt, tableClock, tableDate } from "./kitchen.ts";
import type { ParentView } from "./useParent.ts";

/**
 * P6 · Kitchen-table mode (spec §14.2): her phone or tablet on its side on the table, kept awake.
 * The clock and the date in her language, Vela's newest message to her in Display type, and, when
 * it asks something of her, "Answer" at 88 pt; the family's photos cycle beside it. A tap anywhere
 * wakes her screen to the message itself (P2, P3), which goes back to the table when left alone.
 * Her morning's one chime is the notification at her arrival hour (`scheduleHerMorning`).
 */
export function KitchenTable({ view, wake }: { view: ParentView; wake: () => void }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [since] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const shown = photoAt(view.cycle, now.getTime() - since);
  const [uri, setUri] = useState<string | undefined>();
  useEffect(() => {
    if (shown === undefined || view.photo === undefined) return;
    let current = true;
    view.photo(shown).then(
      (next) => {
        if (current) setUri(next);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [shown, view.photo]);
  const message = view.message;
  const asks = message !== null && message.buttons.length > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={message?.text}
      onPress={wake}
      style={[
        styles.table,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingLeft: insets.left + 32,
          paddingRight: insets.right + 32,
        },
      ]}
    >
      <View style={styles.words}>
        <Text style={styles.clock}>{tableClock(now, view.language)}</Text>
        <Text style={styles.date}>{tableDate(now, view.language)}</Text>
        <Text style={styles.message} numberOfLines={6}>
          {message === null ? (
            <Trans>Nothing yet today. Your morning message will be here.</Trans>
          ) : (
            message.text
          )}
        </Text>
        {asks ? (
          <View style={styles.answer}>
            <Text style={styles.answerLabel}>
              <Trans>Answer</Trans>
            </Text>
          </View>
        ) : null}
      </View>
      {uri === undefined ? null : (
        <View style={styles.photoFrame} accessibilityElementsHidden>
          <Image source={{ uri }} resizeMode="cover" style={styles.photo} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  table: { flex: 1, flexDirection: "row", gap: 32, backgroundColor: light.bg },
  words: { flex: 1, gap: 16, justifyContent: "center" },
  clock: { fontFamily: "Inter_600SemiBold", fontSize: 64, lineHeight: 72, color: light.ink },
  date: { fontFamily: "Inter_500Medium", fontSize: 26, lineHeight: 34, color: light.ink2 },
  message: { fontFamily: "Literata_400Regular", fontSize: 34, lineHeight: 46, color: light.ink },
  answer: {
    minHeight: 88,
    borderRadius: 22,
    backgroundColor: light.action,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    alignSelf: "flex-start",
    minWidth: 280,
  },
  answerLabel: { fontFamily: "Inter_600SemiBold", fontSize: 30, color: light.surface },
  photoFrame: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: light.surface2,
  },
  photo: { width: "100%", height: "100%" },
});
