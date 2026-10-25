import { Trans, useLingui } from "@lingui/react/macro";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import {
  BookCover,
  type KeepState,
  MemoryCard,
  StoryCard,
} from "../../src/components/keepsake.tsx";
import { LoadingShapes } from "../../src/components/loading-shapes.tsx";
import { initialOf } from "../../src/components/parent-chooser.tsx";
import { SectionTitle } from "../../src/components/today-hero.tsx";
import { Chip, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { WarmPage } from "../../src/components/warm.tsx";
import { localDateIn } from "../../src/data/chat.ts";
import { listOf, localDayMonth } from "../../src/data/format.ts";
import {
  byWeek,
  filterCounts,
  type MemoryFilter,
  memoriesOf,
  mondayOf,
  narrowMemories,
} from "../../src/data/memories.ts";
import { type KeepRefusal, useBook } from "../../src/data/useBook.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useExchanges } from "../../src/data/useExchanges.ts";
import { usePullRefresh } from "../../src/data/usePullRefresh.ts";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, radius, softShadow, space, type } from "../../src/theme/tokens.ts";

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Memories (ADR-51): not every message, which the chat already holds, but the things she said that
 * the family will want to remember, a week at a time, each with a heart to keep it in the family
 * book; and the stories Vela gathered from them in her own words. Kept memories are lit, as her
 * window is on Today. The book itself opens from its cover at the top.
 */
export default function MemoriesScreen() {
  const palette = usePalette();
  const { t } = useLingui();
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [section, setSection] = useState<"moments" | "stories">("moments");
  const [parent, setParent] = useState<string | undefined>();
  const { capabilities } = useCapabilities();
  const day = useToday();
  const book = useBook(day.familyId);
  const { exchanges, live, loading, refresh, trouble, more, loadMore } = useExchanges();
  const refreshPage = useCallback(async () => {
    await Promise.all([day.refresh(), refresh(), book.refresh()]);
  }, [day.refresh, refresh, book.refresh]);
  const pull = usePullRefresh(refreshPage);
  useFocusEffect(
    useCallback(() => {
      refresh();
      book.refresh();
    }, [refresh, book.refresh]),
  );
  const bookOn = capabilities?.book === true || book.demo;
  // An organiser keeps her memories for good (ADR-50); everyone sees what was kept.
  const canKeep = bookOn && day.organiser;
  const refusalText: Record<KeepRefusal, string> = {
    memories_off: t`Memories are turned off in the chat, so this is not kept.`,
    sensitive: t`This one mentions health or something private, so it is not kept.`,
    not_kept: t`This one was taken out of the book, so it is not kept again.`,
    no_answer: t`There is nothing to keep here yet.`,
  };
  const { memories, stories } = memoriesOf(book, exchanges);
  const stateOf = (id: string, kept: boolean): KeepState =>
    kept || book.keptIds.has(id) ? "kept" : book.keepingIds.has(id) ? "keeping" : "open";
  const names = day.today.lights.map((light) => light.displayName);
  const who = names.length === 0 ? t`your parent` : listOf(names);
  const several = names.length > 1;
  const mine = memories.filter((memory) => parent === undefined || memory.memberId === parent);
  const counts = filterCounts(mine);
  const shown = narrowMemories(memories, { filter, query, parent });
  const storiesShown = stories.filter((story) => parent === undefined || story.memberId === parent);
  const today = localDateIn(Date.now());
  const thisWeek = mondayOf(today);
  const weeks = byWeek(shown, (at) => localDateIn(Date.parse(at))).map(({ monday, items }) => {
    const date = localDayMonth(monday);
    const label =
      monday === thisWeek
        ? t`This week`
        : monday === addDays(thisWeek, -7)
          ? t`Last week`
          : t`Week of ${date}`;
    return { monday, label, items };
  });
  const keptCount = new Set([...book.entries.map((entry) => entry.exchange_id), ...book.keptIds])
    .size;
  const filters = (
    [
      { key: "open", label: t`To keep` },
      { key: "kept", label: t`Kept` },
      { key: "photos", label: t`Photos` },
      { key: "voice", label: t`Voice` },
    ] as const
  ).filter((option) => option.key === filter || counts[option.key] > 0);
  // One row of filters above the memories, as a phone's own photo library has: All, each parent,
  // then what kind of memory, with search at the end. Tapping a chosen chip again lets it go.
  const filterRow =
    several || filters.length > 0 || counts.all > 0 ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: space.s }}>
            <Chip
              label={t`All`}
              selected={parent === undefined && (section === "stories" || filter === "all")}
              onPress={() => {
                setParent(undefined);
                setFilter("all");
              }}
            />
            {several
              ? day.today.lights.map((light) => (
                  <Chip
                    key={light.memberId}
                    label={light.displayName}
                    initials={[{ key: light.memberId, initial: initialOf(light.displayName) }]}
                    selected={parent === light.memberId}
                    onPress={() =>
                      setParent((current) =>
                        current === light.memberId ? undefined : light.memberId,
                      )
                    }
                  />
                ))
              : null}
            {section === "moments"
              ? filters.map((option) => (
                  <Chip
                    key={option.key}
                    label={`${option.label} ${counts[option.key]}`}
                    selected={filter === option.key}
                    onPress={() =>
                      setFilter((current) => (current === option.key ? "all" : option.key))
                    }
                  />
                ))
              : null}
          </View>
        </ScrollView>
        {section === "moments" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t`Search memories`}
            accessibilityState={{ expanded: searching }}
            hitSlop={hitSlop}
            onPress={() => {
              setSearching((now) => !now);
              setQuery("");
            }}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <BrandIcon
              name={searching ? "close" : "search"}
              color={searching ? palette.action : palette.ink2}
              size={22}
            />
          </Pressable>
        ) : null}
      </View>
    ) : null;
  const waiting = trouble ? (
    <View style={{ gap: space.m }}>
      <Words variant="body" tone="ink2">
        <Trans>The memories could not be reached just now.</Trans>
      </Words>
      <SecondaryButton label={t`Try again`} onPress={refreshPage} />
    </View>
  ) : loading || book.loading ? (
    <LoadingShapes label={t`Opening the memories`} shape="list" />
  ) : null;

  return (
    <WarmPage
      gap={space.l}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.refresh} />}
    >
      <ScreenHeading
        title={<Trans context="tab">Memories</Trans>}
        subtitle={
          canKeep ? (
            <Trans>Little things worth remembering, from {who}. Keep the ones you love.</Trans>
          ) : (
            <Trans>Little things worth remembering, from {who}.</Trans>
          )
        }
      />
      {bookOn ? (
        <BookCover kept={keptCount} stories={stories.filter((s) => s.kept).length} />
      ) : null}
      {bookOn ? (
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            backgroundColor: palette.surface2,
            borderRadius: radius.chip,
            padding: 4,
            borderWidth: 1,
            borderColor: palette.rule,
          }}
        >
          {(
            [
              { key: "moments", label: t`Moments`, count: mine.length },
              { key: "stories", label: t`Stories`, count: storiesShown.length },
            ] as const
          ).map((tab) => (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: section === tab.key }}
              onPress={() => setSection(tab.key)}
              style={[
                {
                  flex: 1,
                  minHeight: 40,
                  flexDirection: "row",
                  gap: space.xs,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.chip,
                  backgroundColor: section === tab.key ? palette.surface : "transparent",
                },
                section === tab.key ? softShadow : null,
              ]}
            >
              <Text
                style={[type.button, { color: section === tab.key ? palette.ink : palette.ink2 }]}
              >
                {tab.label}
              </Text>
              {tab.count === 0 ? null : (
                <Text style={[type.caption, { fontSize: 13, color: palette.ink3 }]}>
                  {tab.count}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
      {filterRow}

      {section === "stories" && bookOn ? (
        <View style={{ gap: space.m }}>
          <Words variant="caption" tone="ink3">
            <Trans>
              When a few mornings come back to the same thing, Vela gathers those words into a
              story. Every word is exactly as it was said; nothing is added.
            </Trans>
          </Words>
          {waiting}
          {waiting === null && storiesShown.length === 0 ? (
            <Words variant="body" tone="ink2">
              <Trans>No stories yet. The first one appears when a subject comes up again.</Trans>
            </Words>
          ) : null}
          {storiesShown.map((story) => {
            const open = story.memories.filter(
              (memory) => stateOf(memory.id, memory.kept) === "open",
            );
            const keeping = story.memories.some((memory) => book.keepingIds.has(memory.id));
            const state: KeepState = open.length === 0 ? "kept" : keeping ? "keeping" : "open";
            return (
              <StoryCard
                key={story.id}
                story={story}
                keepState={state}
                {...(canKeep
                  ? { onKeep: () => book.keepAll(open.map((memory) => memory.id)) }
                  : {})}
              />
            );
          })}
        </View>
      ) : (
        <>
          {searching ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.s,
                minHeight: 46,
                borderRadius: 23,
                borderWidth: 1,
                borderColor: palette.rule,
                backgroundColor: palette.surface,
                paddingHorizontal: space.l,
              }}
            >
              <BrandIcon name="search" color={palette.ink3} size={18} />
              <TextInput
                autoFocus
                accessibilityLabel={t`Search memories`}
                value={query}
                onChangeText={setQuery}
                placeholder={t`Search memories`}
                placeholderTextColor={palette.ink3}
                returnKeyType="search"
                style={[
                  type.body,
                  {
                    flex: 1,
                    color: palette.ink,
                    paddingVertical: 10,
                    outlineStyle: "none",
                  } as object,
                ]}
              />
            </View>
          ) : null}
          {waiting}
          {waiting === null && live && mine.length === 0 ? (
            <Words variant="body" tone="ink2">
              <Trans>
                No memories yet. When {who} tells you something worth remembering, it appears here.
              </Trans>
            </Words>
          ) : waiting === null && mine.length > 0 && shown.length === 0 ? (
            <Words variant="body" tone="ink2">
              <Trans>Nothing here matches. Try another word, or All.</Trans>
            </Words>
          ) : null}
          {weeks.map((week) => (
            <View key={week.monday} style={{ gap: space.m, paddingTop: space.xs }}>
              <SectionTitle title={week.label} />
              {week.items.map((memory) => {
                const refused =
                  book.refused?.exchangeId === memory.id ? book.refused.reason : undefined;
                const failed = book.failedId === memory.id;
                return (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    familyId={day.familyId}
                    showName={several && parent === undefined}
                    keepState={
                      refused === undefined && !failed ? stateOf(memory.id, memory.kept) : "open"
                    }
                    {...(canKeep ? { onKeep: () => book.keep(memory.id) } : {})}
                    {...(refused !== undefined
                      ? { refusal: refusalText[refused] }
                      : failed
                        ? { refusal: t`That could not be kept just now. Try again.` }
                        : {})}
                  />
                );
              })}
            </View>
          ))}
          {book.moments === undefined && more ? (
            <SecondaryButton label={t`Earlier this month`} onPress={loadMore} />
          ) : null}
          <Words variant="caption" tone="ink3">
            {canKeep ? (
              <Trans>
                Memories you do not keep fade after 30 days, like everything else in the chat.
                Anything about health or private matters is never offered as a memory.
              </Trans>
            ) : (
              <Trans>
                Memories fade after 30 days unless the family keeps them. Anything about health or
                private matters is never shown as a memory.
              </Trans>
            )}
          </Words>
        </>
      )}
    </WarmPage>
  );
}
