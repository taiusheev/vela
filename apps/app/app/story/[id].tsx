import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "../../src/components/back-button.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { BookPage, Ornament, usePaper } from "../../src/components/family-book.tsx";
import { KeptGlow, titleCase, useQuoted } from "../../src/components/keepsake.tsx";
import { Text } from "../../src/components/scaled-text.tsx";
import { PrimaryButton, Words } from "../../src/components/ui.tsx";
import { dayLabel, localDateIn } from "../../src/data/chat.ts";
import { memoriesOf, memoryText } from "../../src/data/memories.ts";
import { useBook } from "../../src/data/useBook.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useExchanges } from "../../src/data/useExchanges.ts";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space, type } from "../../src/theme/tokens.ts";

/**
 * One story gathered from her memories (ADR-51), read as a page: its title in her words, then each
 * morning she told part of it, in order, with what she was asked. Nothing on it is Vela's but the
 * dates. An organiser keeps it, and so every memory in it, for good.
 */
export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const paper = usePaper();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const quoted = useQuoted();
  const day = useToday();
  const { capabilities } = useCapabilities();
  const book = useBook(day.familyId);
  const { exchanges } = useExchanges();
  const story = memoriesOf(book, exchanges).stories.find((candidate) => candidate.id === id);
  const canKeep = (capabilities?.book === true || book.demo) && day.organiser;
  const open = (story?.memories ?? []).filter(
    (memory) => !memory.kept && !book.keptIds.has(memory.id),
  );
  const keeping = (story?.memories ?? []).some((memory) => book.keepingIds.has(memory.id));
  const kept = story !== undefined && open.length === 0;
  const today = localDateIn(Date.now());
  const name = story?.memberName ?? "";
  const count = story?.memories.length ?? 0;

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`A story`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.l,
          gap: space.xl,
        }}
      >
        {story === undefined ? (
          <Words variant="body" tone="ink2">
            {book.loading ? (
              <Trans>Opening the story…</Trans>
            ) : (
              <Trans>This story is no longer here. Its memories may have faded.</Trans>
            )}
          </Words>
        ) : (
          <>
            <KeptGlow id={`story-page-${story.id}`} lit={kept || keeping}>
              <View style={{ padding: space.xl, gap: space.s, alignItems: "center" }}>
                <Text style={[type.label, { color: palette.lightInk, textTransform: "uppercase" }]}>
                  {t`A story in ${name}'s words`}
                </Text>
                <Text
                  accessibilityRole="header"
                  style={[type.display, { color: paper.ink, textAlign: "center" }]}
                >
                  {quoted(titleCase(story.title))}
                </Text>
                <Text style={[type.caption, { color: palette.ink3, textAlign: "center" }]}>
                  {plural(count, { one: "Told on # morning", other: "Told across # mornings" })}
                </Text>
              </View>
            </KeptGlow>
            <BookPage>
              {story.memories.map((memory, index) => {
                const when = dayLabel(localDateIn(Date.parse(memory.at)), today);
                const asker = memory.askedBy;
                const question = memory.question;
                const asked = question === null ? "" : quoted(question);
                return (
                  <View key={memory.id} style={{ gap: space.m }}>
                    {index === 0 ? null : <Ornament />}
                    <Text
                      style={[
                        type.label,
                        { color: palette.ink3, textTransform: "uppercase", letterSpacing: 1.5 },
                      ]}
                    >
                      {when}
                    </Text>
                    {question === null ? null : (
                      <Text style={[type.caption, { color: palette.ink3 }]}>
                        {asker === null ? asked : t`${asker} asked, ${asked}`}
                      </Text>
                    )}
                    <Text selectable style={[type.story, { color: paper.ink }]}>
                      {memoryText(memory)}
                    </Text>
                  </View>
                );
              })}
              <Text
                style={[
                  type.preview,
                  { fontSize: 17, lineHeight: 24, color: palette.ink2, textAlign: "right" },
                ]}
              >
                {`— ${name}`}
              </Text>
            </BookPage>
            {kept ? (
              <View
                accessibilityLiveRegion="polite"
                style={{
                  flexDirection: "row",
                  gap: space.s,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <BrandIcon name="heart" color={palette.lightDeep} fill={palette.light} size={18} />
                <Text
                  style={[type.button, { color: palette.ink2 }]}
                >{t`Kept in the family book`}</Text>
              </View>
            ) : canKeep ? (
              <PrimaryButton
                label={keeping ? t`Keeping…` : t`Keep this story`}
                icon="heart"
                disabled={keeping}
                onPress={() => book.keepAll(open.map((memory) => memory.id))}
              />
            ) : null}
            <Words variant="caption" tone="ink3">
              <Trans>
                Vela gathered these words because they are about the same thing. Every word is{" "}
                {name}'s own, exactly as said; nothing is added or changed.
              </Trans>
            </Words>
          </>
        )}
      </ScrollView>
    </>
  );
}
