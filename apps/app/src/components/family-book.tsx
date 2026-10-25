import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ApiBookEntry, ApiBookRecipe } from "@vela/contracts";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { apiConfigured } from "../api/client.ts";
import { VoicePlayback } from "../audio/VoicePlayback.tsx";
import { dayMonth, longDate, monthYear } from "../data/format.ts";
import { byMonth, type MemoryStory, memoryText, saidAt } from "../data/memories.ts";
import type { BookView } from "../data/useBook.ts";
import { useToday } from "../data/useToday.ts";
import { usePalette, useTheme } from "../theme/theme.tsx";
import { hitSlop, radius, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { ConfirmationDialog } from "./confirmation-dialog.tsx";
import { FamilyPhoto } from "./family-photo.tsx";
import { titleCase, useQuoted } from "./keepsake.tsx";
import { Text } from "./scaled-text.tsx";
import { RoomWindow, useRoom } from "./today-hero.tsx";
import { SecondaryButton, Words } from "./ui.tsx";
import { RoomCard } from "./warm.tsx";

/** The book's paper: a page a shade warmer than the app, its edge, and the ink of a printed book. */
export function usePaper() {
  const palette = usePalette();
  const { scheme } = useTheme();
  return scheme === "dark"
    ? { page: "#241E19", edge: "#3A3129", spine: "rgba(0, 0, 0, 0.35)", ink: palette.ink }
    : { page: "#FFFBF2", edge: "#EADFCB", spine: "rgba(107, 74, 43, 0.10)", ink: "#2B231C" };
}

/** Her words as a printed book sets them: the story serif, a little roomier. */
const pageWords = { ...type.story, fontSize: 20, lineHeight: 33 };

/**
 * A sheet of the book: warm paper with a shadow down its left edge where it meets the spine, wide
 * margins, and room between what is on it.
 */
export function BookPage({ children }: { children: ReactNode }) {
  const paper = usePaper();
  return (
    <View
      style={{
        backgroundColor: paper.page,
        borderRadius: 6,
        borderTopRightRadius: radius.panel,
        borderBottomRightRadius: radius.panel,
        borderWidth: 1,
        borderColor: paper.edge,
        borderLeftWidth: 6,
        borderLeftColor: paper.spine,
        paddingVertical: space.xxl,
        paddingHorizontal: space.xl,
        gap: space.xl,
        shadowColor: "#6B4A2B",
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      }}
    >
      {children}
    </View>
  );
}

/** The small mark between two pages' worth of words: a rule, her lit window, a rule. */
export function Ornament() {
  const palette = usePalette();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}
    >
      <View style={{ width: 36, height: 1, backgroundColor: palette.rule }} />
      <View
        style={{
          width: 8,
          height: 10,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          backgroundColor: palette.light,
        }}
      />
      <View style={{ width: 36, height: 1, backgroundColor: palette.rule }} />
    </View>
  );
}

/** A chapter's heading: the month, set small and spaced between two rules. */
function Chapter({ title }: { title: string }) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.rule }} />
      <Text
        accessibilityRole="header"
        style={[
          type.label,
          { color: palette.lightDeep, textTransform: "uppercase", letterSpacing: 2 },
        ]}
      >
        {title}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: palette.rule }} />
    </View>
  );
}

/** Her photo as a print laid in the book: a white border, a wider foot, a slight tilt. */
function Print({ id, tilt }: { id: string; tilt: number }) {
  const { familyId } = useToday();
  return (
    <View
      style={{
        alignSelf: "center",
        width: "86%",
        backgroundColor: "#FFFFFF",
        padding: 8,
        paddingBottom: 28,
        borderRadius: 3,
        transform: [{ rotate: `${tilt}deg` }],
        shadowColor: "#4A2E14",
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <FamilyPhoto
        familyId={familyId}
        photo={{ id, width: null, height: null, stored: true }}
        size="full"
        aspectRatio={4 / 3}
      />
    </View>
  );
}

/** Her voice, played from the family's media route with the reader's own sign-in. */
function BookVoice({ mediaId }: { mediaId: string }) {
  const { familyId } = useToday();
  return familyId === undefined ? null : <VoicePlayback familyId={familyId} mediaId={mediaId} />;
}

/**
 * One kept memory as a page: the day she said it, what she was asked, her words with the light's
 * quotation mark above them, her name beneath as a signature, her voice and her photos. An
 * organiser can take it out from a quiet mark at the foot.
 */
function EntryPage({
  entry,
  index,
  onRemove,
  removing,
}: {
  entry: ApiBookEntry;
  index: number;
  onRemove?: () => void;
  removing: boolean;
}) {
  const palette = usePalette();
  const paper = usePaper();
  const { t } = useLingui();
  const quoted = useQuoted();
  const [confirming, confirm] = useState(false);
  const day = longDate(saidAt(entry));
  const name = entry.member_name;
  const asker = entry.asked_by;
  const question = entry.question;
  const keeper = entry.kept_by;
  const asked = question === null ? "" : quoted(question);
  const words = entry.answers.flatMap((answer) =>
    answer.text === null || answer.text.trim().length === 0 ? [] : [answer.text.trim()],
  );
  const photos = [
    ...entry.photo_ids,
    ...entry.answers.flatMap((answer) =>
      answer.media_id !== null && answer.media_kind === "image" ? [answer.media_id] : [],
    ),
  ];
  const voices = entry.answers.flatMap((answer) =>
    answer.media_id !== null && answer.media_kind === "audio" ? [answer.media_id] : [],
  );
  return (
    <View style={{ gap: space.m }} testID={`page-${entry.exchange_id}`}>
      <Text
        style={[
          type.label,
          {
            color: palette.ink3,
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: 1.5,
          },
        ]}
      >
        {day}
      </Text>
      {question === null ? null : (
        <Text style={[type.caption, { color: palette.ink3, textAlign: "center" }]}>
          {asker === null ? asked : t`${asker} asked, ${asked}`}
        </Text>
      )}
      {photos.map((id, at) => (
        <Print key={id} id={id} tilt={(index + at) % 2 === 0 ? -1.5 : 1.2} />
      ))}
      {words.length === 0 ? null : (
        <View>
          <Text
            accessible={false}
            style={{
              fontFamily: type.display.fontFamily,
              fontSize: 48,
              lineHeight: 48,
              height: 30,
              color: palette.light,
            }}
          >
            “
          </Text>
          <Text selectable style={[pageWords, { color: paper.ink }]}>
            {words.join("\n\n")}
          </Text>
        </View>
      )}
      {voices.map((id) => (
        <BookVoice key={id} mediaId={id} />
      ))}
      <Text
        style={[
          type.preview,
          { fontSize: 17, lineHeight: 24, color: palette.ink2, textAlign: "right" },
        ]}
      >
        {`— ${name}`}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.s,
        }}
      >
        <Text style={[type.caption, { fontSize: 13, color: palette.ink3 }]}>
          {keeper === null ? t`Kept in the book` : t`Kept by ${keeper}`}
        </Text>
        {onRemove === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t`Take this page out of the book`}
            hitSlop={hitSlop}
            disabled={removing}
            onPress={() => confirm(true)}
            style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
          >
            <BrandIcon name="more" color={palette.ink3} size={18} />
          </Pressable>
        )}
      </View>
      {confirming ? (
        <ConfirmationDialog
          onClose={() => {
            if (!removing) confirm(false);
          }}
        >
          <Words variant="body">
            <Trans>Take this page out of the family book?</Trans>
          </Words>
          <Words variant="caption" tone="ink2">
            <Trans>
              It stops being kept. Like everything in the chat, it is then deleted 30 days after it
              was said.
            </Trans>
          </Words>
          <SecondaryButton
            label={t`Take it out`}
            disabled={removing}
            onPress={() => {
              onRemove?.();
              confirm(false);
            }}
          />
          <SecondaryButton label={t`Keep it`} disabled={removing} onPress={() => confirm(false)} />
        </ConfirmationDialog>
      ) : null}
    </View>
  );
}

/** A kept story as its own chapter: its title in her words, then each morning's words in turn. */
function StoryChapter({ story }: { story: MemoryStory }) {
  const palette = usePalette();
  const paper = usePaper();
  const { t } = useLingui();
  const quoted = useQuoted();
  const name = story.memberName;
  const count = story.memories.length;
  return (
    <View style={{ gap: space.l }} testID={`book-story-${story.id}`}>
      <View style={{ gap: space.xs, alignItems: "center" }}>
        <Text style={[type.label, { color: palette.lightDeep, textTransform: "uppercase" }]}>
          {t`A story in ${name}'s words`}
        </Text>
        <Text
          accessibilityRole="header"
          style={[type.title, { color: paper.ink, textAlign: "center" }]}
        >
          {quoted(titleCase(story.title))}
        </Text>
        <Text style={[type.caption, { color: palette.ink3 }]}>
          {plural(count, { one: "Told on # morning", other: "Told across # mornings" })}
        </Text>
      </View>
      {story.memories.map((memory) => {
        const date = dayMonth(memory.at);
        return (
          <View key={memory.id} style={{ gap: space.xs }}>
            <Text style={[type.label, { color: palette.ink3, textTransform: "uppercase" }]}>
              {date}
            </Text>
            <Text selectable style={[pageWords, { color: paper.ink }]}>
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
    </View>
  );
}

/** A recipe card she kept (spec §10, ADR-41): her ingredients, steps and tips, as she told them. */
function RecipePage({ recipe }: { recipe: ApiBookRecipe }) {
  const palette = usePalette();
  const paper = usePaper();
  const { t } = useLingui();
  const name = recipe.member_name;
  const section = (heading: string, lines: string[], numbered: boolean) =>
    lines.length === 0 ? null : (
      <View style={{ gap: space.s }}>
        <Text style={[type.label, { color: palette.ink3, textTransform: "uppercase" }]}>
          {heading}
        </Text>
        {lines.map((line, index) => (
          <View
            key={`${heading}:${line}`}
            style={{
              flexDirection: "row",
              gap: space.m,
              paddingBottom: space.xs,
              borderBottomWidth: 1,
              borderBottomColor: palette.rule,
            }}
          >
            <Text style={[type.bodyMedium, { color: palette.lightDeep, minWidth: 18 }]}>
              {numbered ? `${index + 1}` : "•"}
            </Text>
            <Text style={[type.body, { color: paper.ink, flex: 1 }]}>{line}</Text>
          </View>
        ))}
      </View>
    );
  return (
    <View style={{ gap: space.l }}>
      <View style={{ gap: space.xs, alignItems: "center" }}>
        <Text style={[type.label, { color: palette.lightDeep, textTransform: "uppercase" }]}>
          {t`From ${name}'s kitchen`}
        </Text>
        <Text style={[type.title, { color: paper.ink, textAlign: "center" }]}>{recipe.title}</Text>
      </View>
      {section(t`You need`, recipe.ingredients, false)}
      {section(t`How`, recipe.steps, true)}
      {section(t`Tips`, recipe.remarks, false)}
    </View>
  );
}

/** The cover: the logo's ink, her window lit on it once anything is kept, the family's name. */
function Cover({
  familyName,
  kept,
  stories,
  recipes,
  since,
}: {
  familyName: string | undefined;
  kept: number;
  stories: number;
  recipes: number;
  since: string | undefined;
}) {
  const room = useRoom();
  const { t } = useLingui();
  const held = [
    plural(kept, { one: "# memory", other: "# memories" }),
    ...(stories === 0 ? [] : [plural(stories, { one: "# story", other: "# stories" })]),
    ...(recipes === 0 ? [] : [plural(recipes, { one: "# recipe", other: "# recipes" })]),
  ].join(" · ");
  const date = since === undefined ? "" : monthYear(since);
  return (
    <RoomCard id="book-cover" strong={kept > 0}>
      <View style={{ alignItems: "center", gap: space.m, paddingVertical: space.l }}>
        <RoomWindow>
          <View
            style={{
              width: 26,
              height: 34,
              borderTopLeftRadius: 13,
              borderTopRightRadius: 13,
              borderWidth: 1.5,
              borderColor: room.muted,
              backgroundColor: kept > 0 ? room.hot : "transparent",
            }}
          />
        </RoomWindow>
        <Text
          accessibilityRole="header"
          style={[type.display, { color: room.ink, textAlign: "center" }]}
        >
          {t`The family book`}
        </Text>
        {familyName === undefined || familyName.length === 0 ? null : (
          <Text style={[type.preview, { fontSize: 18, color: room.muted, textAlign: "center" }]}>
            {familyName}
          </Text>
        )}
        <View style={{ width: 40, height: 1, backgroundColor: room.glassRule }} />
        <View style={{ gap: 2, alignItems: "center" }}>
          <Text style={[type.caption, { color: room.muted, textAlign: "center" }]}>
            {kept === 0 && recipes === 0 ? t`Kept for the family, in their own words` : held}
          </Text>
          {kept === 0 || date.length === 0 ? null : (
            <Text style={[type.caption, { color: room.muted, textAlign: "center" }]}>
              {t`Kept since ${date}`}
            </Text>
          )}
        </View>
      </View>
    </RoomCard>
  );
}

/**
 * The family book (spec §10, A10; ADR-39, ADR-50, ADR-51), read as a book: a cover, then her kept
 * memories a month at a time, oldest first, each set as a page in her words and signed with her
 * name; the stories the family kept as chapters of their own; then her recipes. Every member reads
 * it; an organiser can take a page out. Reading never needs Vela Light.
 */
export function FamilyBook({
  book,
  stories,
  organiser,
}: {
  book: BookView;
  /** Stories gathered from her memories; the kept ones are chapters here. */
  stories: MemoryStory[];
  organiser: boolean;
}) {
  const palette = usePalette();
  const paper = usePaper();
  const { t } = useLingui();
  const { families, familyId } = useToday();
  const familyName = families.find((family) => family.id === familyId)?.name;
  const keptStories = stories.filter((story) => story.kept);
  const inStory = new Set(keptStories.flatMap((story) => story.memories.map((m) => m.id)));
  const pages = book.entries
    .filter((entry) => !inStory.has(entry.exchange_id))
    .sort((a, b) => saidAt(a).localeCompare(saidAt(b)));
  type Leaf =
    | { kind: "page"; at: string; entry: ApiBookEntry }
    | { kind: "story"; at: string; story: MemoryStory };
  const leaves: Leaf[] = [
    ...pages.map((entry) => ({ kind: "page" as const, at: saidAt(entry), entry })),
    ...keptStories.map((story) => ({ kind: "story" as const, at: story.from, story })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const chapters = byMonth(leaves, (leaf) => leaf.at.slice(0, 7));
  const since = leaves[0]?.at.slice(0, 7);
  const empty = book.entries.length === 0 && book.recipes.length === 0;
  return (
    <View style={{ gap: space.xl }}>
      <Cover
        familyName={familyName}
        kept={book.entries.length}
        stories={keptStories.length}
        recipes={book.recipes.length}
        since={since}
      />
      {book.trouble ? (
        <View style={{ gap: space.m }}>
          <Words variant="body" tone="ink2">
            <Trans>The family book could not be reached just now.</Trans>
          </Words>
          <SecondaryButton label={t`Try again`} onPress={book.refresh} />
        </View>
      ) : null}
      {book.removeFailed ? (
        <Words variant="body" tone="ink2">
          <Trans>That page could not be taken out. Try again.</Trans>
        </Words>
      ) : null}
      {book.loading ? (
        <Words variant="body" tone="ink2">
          <Trans>Opening the book…</Trans>
        </Words>
      ) : !book.trouble && empty ? (
        <BookPage>
          <View style={{ gap: space.m, alignItems: "center" }}>
            <Ornament />
            <Text style={[pageWords, { textAlign: "center", color: paper.ink }]}>
              <Trans>The first page is waiting.</Trans>
            </Text>
            <Text style={[type.body, { color: palette.ink2, textAlign: "center" }]}>
              {apiConfigured() || book.demo ? (
                <Trans>
                  Tap the heart on a memory, and it is kept here, long after the chat has let it go.
                </Trans>
              ) : (
                <Trans>Kept memories and stories appear here.</Trans>
              )}
            </Text>
            <SecondaryButton
              label={t`Find a memory to keep`}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/exchanges"))}
            />
          </View>
        </BookPage>
      ) : null}
      {chapters.map((chapter) => (
        <BookPage key={chapter.month}>
          <Chapter title={monthYear(chapter.month)} />
          {chapter.items.map((leaf, index) => (
            <View
              key={leaf.kind === "page" ? leaf.entry.exchange_id : leaf.story.id}
              style={{ gap: space.xl }}
            >
              {index === 0 ? null : <Ornament />}
              {leaf.kind === "page" ? (
                <EntryPage
                  entry={leaf.entry}
                  index={index}
                  removing={book.removing}
                  {...(organiser ? { onRemove: () => book.remove(leaf.entry.exchange_id) } : {})}
                />
              ) : (
                <StoryChapter story={leaf.story} />
              )}
            </View>
          ))}
        </BookPage>
      ))}
      {book.recipes.length === 0 ? null : (
        <BookPage>
          <Chapter title={t`Recipes`} />
          {book.recipes.map((recipe, index) => (
            <View key={recipe.id} style={{ gap: space.xl }}>
              {index === 0 ? null : <Ornament />}
              <RecipePage recipe={recipe} />
            </View>
          ))}
        </BookPage>
      )}
      {empty ? null : (
        <Text style={[type.caption, { color: palette.ink3, textAlign: "center" }]}>
          <Trans>
            Everything here stays until an organiser takes it out, or memories are turned off in the
            chat.
          </Trans>
        </Text>
      )}
    </View>
  );
}
