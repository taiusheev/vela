import { useLingui } from "@lingui/react/macro";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "../src/components/back-button.tsx";
import { FamilyBook } from "../src/components/family-book.tsx";
import { memoriesOf } from "../src/data/memories.ts";
import { useBook } from "../src/data/useBook.ts";
import { useExchanges } from "../src/data/useExchanges.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * The family book on its own screen (spec §10, A10; ADR-39, ADR-51), opened from its cover on
 * Memories and from the week's links: a place to sit and read, with nothing else on it.
 */
export default function BookScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { familyId, organiser } = useToday();
  const book = useBook(familyId);
  const { exchanges } = useExchanges();
  const { stories } = memoriesOf(book, exchanges);
  useFocusEffect(
    useCallback(() => {
      book.refresh();
    }, [book.refresh]),
  );

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`The family book`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={book.refreshing} onRefresh={book.refresh} />}
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.l,
        }}
      >
        <FamilyBook book={book} stories={stories} organiser={organiser} />
      </ScrollView>
    </>
  );
}
