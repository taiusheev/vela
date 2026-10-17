import { useLingui } from "@lingui/react/macro";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "../src/components/back-button.tsx";
import { FamilyBook } from "../src/components/family-book.tsx";
import { useBook } from "../src/data/useBook.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * The family book on its own screen (spec §10, A10; ADR-39), for the links into it from Sunday's
 * story of the week. Memories shows the same book beside her words.
 */
export default function BookScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { familyId, organiser } = useToday();
  const { capabilities } = useCapabilities();
  const book = useBook(familyId);
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
          paddingHorizontal: space.margin,
        }}
      >
        <FamilyBook book={book} organiser={organiser} bookOn={capabilities?.book === true} />
      </ScrollView>
    </>
  );
}
