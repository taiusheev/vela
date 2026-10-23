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
import { RoomWindow, SectionTitle, SoftCard, useRoom } from "../../src/components/today-hero.tsx";
import { Chip, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { RoomCard, WarmPage } from "../../src/components/warm.tsx";
import { dayLabel, localDateIn } from "../../src/data/chat.ts";
import type { Exchange } from "../../src/data/exchanges.ts";
import { localDayMonth } from "../../src/data/format.ts";
import { type BookView, type KeepRefusal, useBook } from "../../src/data/useBook.ts";
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

/** "Keep" on one of her answers: kept, being kept, or why it could not be. */
interface KeepControl {
  id: string;
  kept: boolean;
  busy: boolean;
  onKeep(): void;
  refusal?: string;
}

/**
 * Keeps one of her answers for good (ADR-50). Once kept it says so and does nothing more; taking it
 * out again is the family book's.
 */
function KeepButton({ keep, featured }: { keep: KeepControl; featured: boolean }) {
  const palette = usePalette();
  const room = useRoom();
  const { t } = useLingui();
  const ink = featured ? room.ink : palette.action;
  if (keep.kept) {
    return (
      <View
        accessible
        testID={`kept-${keep.id}`}
        accessibilityLabel={t`Kept for good`}
        style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
      >
        <BrandIcon name="heart" color={featured ? room.ink : palette.lightDeep} size={16} />
        <Text style={[type.caption, { color: featured ? room.ink : palette.lightDeep }]}>
          {t`Kept`}
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      testID={`keep-${keep.id}`}
      accessibilityRole="button"
      accessibilityLabel={t`Keep for good`}
      accessibilityHint={t`Keeps this answer in the family book instead of deleting it after 30 days`}
      accessibilityState={{ busy: keep.busy, disabled: keep.busy }}
      disabled={keep.busy}
      hitSlop={hitSlop}
      onPress={keep.onKeep}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        minHeight: 32,
        paddingHorizontal: space.s,
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: featured ? room.glassRule : palette.rule,
        opacity: pressed || keep.busy ? 0.6 : 1,
      })}
    >
      <BrandIcon name="heart" color={ink} size={16} />
      <Text style={[type.caption, { color: ink }]}>{keep.busy ? t`Keeping…` : t`Keep`}</Text>
    </Pressable>
  );
}

/**
 * Vela's suggestions of answers worth keeping (ADR-50), for organisers: her exact words, with Keep
 * and "Not this one". She is never asked; the first answer kept is told to her in her chat.
 */
function KeepSuggestions({ book }: { book: BookView }) {
  const palette = usePalette();
  const { t } = useLingui();
  const shown = book.suggestions.slice(0, 2);
  if (shown.length === 0) return null;
  return (
    <View style={{ gap: space.m }} testID="keep-suggestions">
      <SectionTitle title={t`Worth keeping?`} />
      {shown.map((suggestion) => {
        const name = suggestion.member_name;
        const question = suggestion.question;
        return (
          <SoftCard key={suggestion.exchange_id}>
            <Text style={[type.caption, { color: palette.ink3 }]}>
              {question === null ? t`${name} said` : t`${name}, asked “${question}”`}
            </Text>
            <Text style={[type.preview, { color: palette.ink }]}>{`“${suggestion.quote}”`}</Text>
            <View style={{ flexDirection: "row", gap: space.s, flexWrap: "wrap" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`Keep for good`}
                disabled={book.keepingId === suggestion.exchange_id}
                onPress={() => book.keep(suggestion.exchange_id)}
                style={({ pressed }) => ({
                  minHeight: 44,
                  paddingHorizontal: space.l,
                  borderRadius: radius.chip,
                  backgroundColor: palette.action,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <BrandIcon name="heart" color={palette.onAction} size={16} />
                <Text style={[type.button, { color: palette.onAction }]}>{t`Keep`}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => book.dismiss(suggestion.exchange_id)}
                style={{ minHeight: 44, paddingHorizontal: space.m, justifyContent: "center" }}
              >
                <Text style={[type.button, { color: palette.ink2 }]}>{t`Not this one`}</Text>
              </Pressable>
            </View>
          </SoftCard>
        );
      })}
      <Words variant="caption" tone="ink3">
        <Trans>
          Vela suggests answers you may want to keep. Kept answers stay in the family book instead
          of being deleted after 30 days.
        </Trans>
      </Words>
    </View>
  );
}

/** One thing she said, set as a keepsake: who and when, what she was asked, her words, her photo
 * or voice. The newest is `featured`: drawn as Today's lit room, the rest as the family's feed. */
function MemoryCard({
  exchange,
  originals,
  today,
  featured = false,
  keep,
}: {
  exchange: Exchange;
  originals: boolean;
  today: string;
  featured?: boolean;
  /** An organiser's "Keep" (ADR-50), where the family book is on; absent for a story. */
  keep?: KeepControl;
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
          <RoomWindow>
            <Light state="lit" height={featured ? 24 : 18} />
          </RoomWindow>
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
  const opened = (
    <Link href={{ pathname: "/exchange/[id]", params: { id: exchange.id } }} asChild>
      <Pressable accessibilityRole="button" hitSlop={hitSlop} style={{ gap: space.m }}>
        {body}
      </Pressable>
    </Link>
  );
  // "Keep" sits beside the card's link, not inside it, so a screen reader reaches it on its own.
  const keeping =
    keep === undefined ? null : (
      <View style={{ gap: space.xs, alignItems: "flex-end" }}>
        <KeepButton keep={keep} featured={featured} />
        {keep.refusal === undefined ? null : (
          <Text
            accessibilityLiveRegion="polite"
            style={[type.caption, { color: ink2, alignSelf: "stretch" }]}
          >
            {keep.refusal}
          </Text>
        )}
      </View>
    );
  return featured ? (
    <RoomCard id={`memory-${exchange.id}`}>
      {opened}
      {keeping}
    </RoomCard>
  ) : (
    <SoftCard>
      {opened}
      {keeping}
    </SoftCard>
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
  const bookOn = capabilities?.book === true || book.demo;
  // An organiser keeps any ordinary answer of hers for good (ADR-50); a story is kept already.
  const canKeep = bookOn && day.organiser;
  const refusalText: Record<KeepRefusal, string> = {
    memories_off: t`She has turned memories off, so her answers are not kept.`,
    sensitive: t`This answer mentions health or something private, so it is not kept.`,
    not_kept: t`She asked not to keep this one.`,
    no_answer: t`There is no answer to keep yet.`,
  };
  const keepFor = (exchange: Exchange): KeepControl | undefined => {
    if (!canKeep || exchange.type === "story" || exchange.type === "recipe") return undefined;
    const refused = book.refused?.exchangeId === exchange.id ? book.refused.reason : undefined;
    return {
      id: exchange.id,
      kept: book.keptIds.has(exchange.id),
      busy: book.keepingId === exchange.id,
      onKeep: () => book.keep(exchange.id),
      ...(refused === undefined ? {} : { refusal: refusalText[refused] }),
    };
  };
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
          {canKeep && filter === "all" && query.trim().length === 0 ? (
            <KeepSuggestions book={book} />
          ) : null}
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
                  keep={keepFor(exchange)}
                />
              ))}
            </View>
          ))}
          {more ? <SecondaryButton label={t`Earlier this month`} onPress={loadMore} /> : null}
          <Words variant="caption" tone="ink3">
            {canKeep ? (
              <Trans>
                Her words stay here for thirty days. Tap Keep on the ones you want to keep for good;
                they and her stories stay in the family book.
              </Trans>
            ) : bookOn ? (
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
