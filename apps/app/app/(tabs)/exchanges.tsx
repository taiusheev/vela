import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { VoicePlayback } from "../../src/audio/VoicePlayback.tsx";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { FamilyBook } from "../../src/components/family-book.tsx";
import { ExchangePhotos, ReplyPhoto } from "../../src/components/family-photo.tsx";
import { Light } from "../../src/components/light.tsx";
import { ParentChooser } from "../../src/components/parent-chooser.tsx";
import { Portrait } from "../../src/components/portrait-lamp.tsx";
import { StoryDay } from "../../src/components/story-day.tsx";
import { SectionTitle, SoftCard, useRoom } from "../../src/components/today-hero.tsx";
import { Chip, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { RoomCard, WarmPage } from "../../src/components/warm.tsx";
import { dayLabel, localDateIn } from "../../src/data/chat.ts";
import type { Exchange } from "../../src/data/exchanges.ts";
import { localDayMonth } from "../../src/data/format.ts";
import { useBook } from "../../src/data/useBook.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useExchanges } from "../../src/data/useExchanges.ts";
import { usePortrait } from "../../src/data/usePortrait.ts";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, radius, softShadow, space, type } from "../../src/theme/tokens.ts";

type Filter = "all" | "photos" | "voice" | "stories";

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of a date's week, on the calendar: Memories groups her words by week. */
function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function matches(exchange: Exchange, filter: Filter, query: string): boolean {
  const answer = exchange.answer;
  if (answer === undefined) return false;
  if (filter === "photos" && answer.photo === undefined) return false;
  if (filter === "voice" && answer.audio === undefined && answer.transcript !== true) return false;
  if (filter === "stories" && exchange.type !== "story" && exchange.type !== "recipe") return false;
  const words = query.trim().toLocaleLowerCase();
  return (
    words.length === 0 ||
    [exchange.ask, answer.text, answer.original ?? ""].some((text) =>
      text.toLocaleLowerCase().includes(words),
    )
  );
}

/** One thing she said, set as a keepsake: who and when, what she was asked, her words, her photo
 * or voice. The newest is `featured`: drawn as Today's lit room, the rest as the family's feed. */
function MemoryCard({
  exchange,
  originals,
  today,
  featured = false,
}: {
  exchange: Exchange;
  originals: boolean;
  today: string;
  featured?: boolean;
}) {
  const palette = usePalette();
  const room = useRoom();
  const { t } = useLingui();
  const { familyId } = useToday();
  const photo = usePortrait(familyId ?? "", exchange.recipientId ?? "");
  const answer = exchange.answer;
  if (answer === undefined) return null;
  const shown = originals ? (answer.original ?? answer.text) : answer.text;
  const recipient = exchange.recipient;
  const asker = exchange.asker;
  const when = exchange.date === undefined ? exchange.day : dayLabel(exchange.date, today);
  const kept = exchange.type === "story" || exchange.type === "recipe";
  const time = answer.at;
  const replies = exchange.replies.length;
  const ink = featured ? room.ink : palette.ink;
  const ink2 = featured ? room.muted : palette.ink2;
  const ink3 = featured ? room.muted : palette.ink3;
  const rule = featured ? room.glassRule : palette.rule;
  const body = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <Portrait uri={photo.uri} name={recipient} width={36} height={36} round />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.button, { color: ink }]}>{recipient}</Text>
          <Text style={[type.caption, { fontSize: 13, color: ink3 }]}>{`${when} · ${time}`}</Text>
        </View>
        {kept ? (
          <View
            style={{
              borderRadius: radius.chip,
              backgroundColor: featured ? room.glass : palette.lightSoft,
              borderWidth: featured ? 1 : 0,
              borderColor: room.glassRule,
              paddingHorizontal: space.s,
              paddingVertical: 2,
            }}
          >
            <Text
              style={[
                type.label,
                { letterSpacing: 0, color: featured ? room.ink : palette.lightDeep },
              ]}
            >
              {exchange.type === "recipe" ? t`Recipe` : t`Story`}
            </Text>
          </View>
        ) : (
          <Light state="lit" height={featured ? 24 : 18} />
        )}
      </View>
      <View style={{ gap: 2 }}>
        <Text style={[type.caption, { color: ink3 }]}>
          {exchange.draftedByVela === true
            ? t`${asker} asked · written by Vela`
            : t`${asker} asked`}
        </Text>
        <Text numberOfLines={2} style={[type.body, { color: ink2 }]}>
          {exchange.ask}
        </Text>
      </View>
      <ExchangePhotos photos={exchange.photos} picked={exchange.picked} size={56} />
      <Text numberOfLines={8} style={[type.preview, { color: ink }]}>
        {shown}
      </Text>
      {answer.photo === undefined ? null : <ReplyPhoto photo={answer.photo} size="full" />}
      {answer.audio === undefined || familyId === undefined ? null : (
        <VoicePlayback
          familyId={familyId}
          mediaId={answer.audio.id}
          durationMs={answer.audio.duration_ms}
          expiresAt={answer.audio.expires_at}
          state={answer.audio.state}
          ready={answer.audio.state === "ready"}
        />
      )}
      {/* Who and when are said once, at the top; the foot keeps small signs, never wrapping. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.m,
          paddingTop: space.s,
          borderTopWidth: 1,
          borderTopColor: rule,
        }}
      >
        {answer.transcript === true ? (
          <View
            accessible
            accessibilityLabel={t`From a voice note`}
            style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
          >
            <BrandIcon name="mic" color={ink3} size={16} />
            <Text style={[type.caption, { color: ink3 }]}>{t`Voice`}</Text>
          </View>
        ) : null}
        {replies === 0 ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <BrandIcon name="reply" color={ink3} size={16} />
            <Text style={[type.caption, { color: ink3 }]}>
              {plural(replies, { one: "# reply", other: "# replies" })}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <BrandIcon name="chevron" color={featured ? room.ink : palette.action} size={18} />
      </View>
    </>
  );
  return (
    <Link href={{ pathname: "/exchange/[id]", params: { id: exchange.id } }} asChild>
      <Pressable accessibilityRole="button" hitSlop={hitSlop}>
        {featured ? (
          <RoomCard id={`memory-${exchange.id}`}>{body}</RoomCard>
        ) : (
          <SoftCard>{body}</SoftCard>
        )}
      </Pressable>
    </Link>
  );
}

/**
 * Memories (consumer flow rows 26–37, 83–92): what she said in the last thirty days, a week at a
 * time, which a reader can search and narrow to her photos, her voice or her stories; and, where it
 * is on, the family book that keeps her stories and recipes for good. The day-by-day conversation is
 * the chat's, opened from Today.
 */
export default function MemoriesScreen() {
  const palette = usePalette();
  const { t } = useLingui();
  const [originals, setOriginals] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<"words" | "book">("words");
  const [parent, setParent] = useState<string | undefined>();
  const { capabilities } = useCapabilities();
  const day = useToday();
  const book = useBook(day.familyId);
  const { exchanges, live, loading, refreshing, refresh, trouble, more, loadMore } = useExchanges();
  useFocusEffect(
    useCallback(() => {
      refresh();
      book.refresh();
    }, [refresh, book.refresh]),
  );
  const bookOn = capabilities?.book === true;
  const showing = bookOn ? section : "words";
  const today = localDateIn(Date.now());
  const answered = exchanges.filter(
    (exchange) =>
      exchange.answer !== undefined && (parent === undefined || exchange.recipientId === parent),
  );
  const shown = answered.filter((exchange) => matches(exchange, filter, query));
  // The switch is offered when something listed was translated for this reader (spec A8).
  const canShowOriginals = answered.some((exchange) => exchange.answer?.original !== undefined);
  const thisWeek = mondayOf(today);
  const weeks: { key: string; label: string; items: Exchange[] }[] = [];
  for (const exchange of shown) {
    const monday = exchange.date === undefined ? thisWeek : mondayOf(exchange.date);
    const date = localDayMonth(monday);
    const label =
      monday === thisWeek
        ? t`This week`
        : monday === addDays(thisWeek, -7)
          ? t`Last week`
          : t`Week of ${date}`;
    const group = weeks.at(-1);
    if (group?.key === monday) group.items.push(exchange);
    else weeks.push({ key: monday, label, items: [exchange] });
  }
  // The newest of her words, when nothing narrows the list, is lit as Today lights her morning.
  const featuredId = filter === "all" && query.trim().length === 0 ? shown[0]?.id : undefined;
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t`All` },
    { key: "photos", label: t`Photos` },
    { key: "voice", label: t`Voice` },
    { key: "stories", label: t`Stories` },
  ];

  return (
    <WarmPage
      gap={space.l}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <ScreenHeading
        title={<Trans context="tab">Memories</Trans>}
        subtitle={
          <Trans>What she told you this month, and the stories the family keeps for good.</Trans>
        }
      />
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
              { key: "words", label: t`Her words` },
              { key: "book", label: t`Family book` },
            ] as const
          ).map((tab) => (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: showing === tab.key }}
              onPress={() => setSection(tab.key)}
              style={[
                {
                  flex: 1,
                  minHeight: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.chip,
                  backgroundColor: showing === tab.key ? palette.surface : "transparent",
                },
                showing === tab.key ? softShadow : null,
              ]}
            >
              <Text
                style={[type.button, { color: showing === tab.key ? palette.ink : palette.ink2 }]}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {showing === "book" ? (
        <View style={{ gap: space.xl }}>
          <FamilyBook book={book} organiser={day.organiser} bookOn={bookOn} />
          <StoryDay key={`${day.familyId}:book`} inBook />
        </View>
      ) : (
        <>
          <ParentChooser
            lights={day.today.lights}
            selected={parent}
            onSelect={(id) => setParent((current) => (current === id ? undefined : id))}
            everyone={{
              label: day.today.lights.length === 2 ? t`Both` : t`Everyone`,
              onSelect: () => setParent(undefined),
            }}
          />
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
              ...softShadow,
            }}
          >
            <BrandIcon name="search" color={palette.ink3} size={18} />
            <TextInput
              accessibilityLabel={t`Search her words`}
              value={query}
              onChangeText={setQuery}
              placeholder={t`Search her words`}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: space.s }}>
              {filters.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  selected={filter === option.key}
                  onPress={() => setFilter(option.key)}
                />
              ))}
            </View>
          </ScrollView>
          {canShowOriginals ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={hitSlop}
              accessibilityState={{ selected: originals }}
              style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
              onPress={() => setOriginals((on) => !on)}
            >
              <Words variant="button" tone="action">
                {originals ? <Trans>Show translations</Trans> : <Trans>Show originals</Trans>}
              </Words>
            </Pressable>
          ) : null}
          {trouble ? (
            <Words variant="body" tone="ink2">
              <Trans>The exchanges could not be reached just now.</Trans>
            </Words>
          ) : loading ? (
            <Words variant="body" tone="ink2">
              <Trans>Looking for your family's days…</Trans>
            </Words>
          ) : live && answered.length === 0 ? (
            <Words variant="body" tone="ink2">
              <Trans>Nothing has happened yet. Her first morning will be here.</Trans>
            </Words>
          ) : answered.length > 0 && shown.length === 0 ? (
            <Words variant="body" tone="ink2">
              <Trans>Nothing here matches. Try another word, or All.</Trans>
            </Words>
          ) : null}
          {trouble ? <SecondaryButton label={t`Try again`} onPress={refresh} /> : null}
          {weeks.map((week) => (
            <View key={week.key} style={{ gap: space.m, paddingTop: space.s }}>
              <SectionTitle title={week.label} />
              {week.items.map((exchange) => (
                <MemoryCard
                  key={exchange.id}
                  exchange={exchange}
                  originals={originals}
                  today={today}
                  featured={exchange.id === featuredId}
                />
              ))}
            </View>
          ))}
          {more ? <SecondaryButton label={t`Earlier this month`} onPress={loadMore} /> : null}
          <Words variant="caption" tone="ink3">
            {bookOn ? (
              <Trans>
                Her words stay here for thirty days. The stories she tells are kept in the family
                book.
              </Trans>
            ) : (
              <Trans>Her words stay here for thirty days.</Trans>
            )}
          </Words>
        </>
      )}
    </WarmPage>
  );
}
