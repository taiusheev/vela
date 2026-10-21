import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ApiBookEntry, ApiBookRecipe } from "@vela/contracts";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { apiConfigured } from "../api/client.ts";
import { VoicePlayback } from "../audio/VoicePlayback.tsx";
import { dayMonth, localDayMonth } from "../data/format.ts";
import type { BookView } from "../data/useBook.ts";
import { useToday } from "../data/useToday.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { ConfirmationDialog } from "./confirmation-dialog.tsx";
import { ReplyPhoto } from "./family-photo.tsx";
import { SecondaryButton, Words } from "./ui.tsx";

/**
 * The family book (spec §10, A10; ADR-39): the stories she told and the recipes she kept, beyond
 * the 30 days, newest first, each with its question, who asked it, her words and her voice. Every
 * member reads it; an organiser can take a story out. Reading never needs Vela Light. Shown in
 * Memories and on its own screen.
 */
export function FamilyBook({
  book,
  organiser,
  bookOn,
}: {
  book: BookView;
  organiser: boolean;
  bookOn: boolean;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const stories = book.entries.length;
  const recipes = book.recipes.length;
  return (
    <View style={{ gap: space.xl }}>
      <View
        style={{
          backgroundColor: palette.lightSoft,
          borderRadius: radius.card + 8,
          padding: space.l,
          gap: space.s,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
          <BrandIcon name="book" color={palette.lightDeep} size={20} />
          <Text style={[type.label, { color: palette.ink2, textTransform: "uppercase" }]}>
            <Trans>Kept for good</Trans>
          </Text>
        </View>
        <Text accessibilityRole="header" style={[type.title, { color: palette.ink }]}>
          <Trans>The family book</Trans>
        </Text>
        <Text style={[type.body, { color: palette.ink2 }]}>
          {stories === 0 && recipes === 0
            ? t`Nothing kept yet.`
            : [
                plural(stories, { one: "# story", other: "# stories" }),
                plural(recipes, { one: "# recipe", other: "# recipes" }),
              ].join(" · ")}
        </Text>
        <Text style={[type.caption, { color: palette.ink2 }]}>
          <Trans>
            The stories told on story day, and the recipes shared, stay here after the 30 days, with
            the voice that told them.
          </Trans>
        </Text>
      </View>

      {book.trouble ? <SecondaryButton label={t`Try again`} onPress={book.refresh} /> : null}
      {book.removeFailed ? (
        <Words variant="body" tone="ink2">
          <Trans>That story could not be removed. Try again.</Trans>
        </Words>
      ) : null}

      {book.coming.map((story) => {
        const asker = story.asked_by;
        const day = localDayMonth(story.date);
        const name = story.member_name;
        return (
          <View
            key={story.exchange_id}
            style={{
              borderRadius: radius.card + 6,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: palette.control,
              padding: space.l,
              gap: space.s,
            }}
          >
            <Text style={[type.label, { color: palette.ink3, textTransform: "uppercase" }]}>
              {asker === null
                ? t`Coming up · ${name} · ${day}`
                : t`Coming up · ${name} · ${day} · chosen by ${asker}`}
            </Text>
            {story.question === null ? null : (
              <Text style={[type.preview, { color: palette.ink }]}>{story.question}</Text>
            )}
          </View>
        );
      })}

      {!apiConfigured() ? (
        <Words variant="body" tone="ink2">
          <Trans>The family book fills with the stories told on story day.</Trans>
        </Words>
      ) : book.loading ? (
        <Words variant="body" tone="ink2">
          <Trans>Opening the book…</Trans>
        </Words>
      ) : book.trouble ? (
        <Words variant="body" tone="ink2">
          <Trans>The family book could not be reached just now.</Trans>
        </Words>
      ) : stories === 0 && recipes === 0 ? (
        <Words variant="body" tone="ink2">
          {bookOn ? (
            <Trans>
              No stories yet. Choose a question on the Sunday tab, and the story is kept here.
            </Trans>
          ) : (
            <Trans>No stories have been kept here yet.</Trans>
          )}
        </Words>
      ) : null}

      {stories === 0 ? null : (
        <View style={{ gap: space.l }}>
          <Text accessibilityRole="header" style={[type.heading, { color: palette.ink }]}>
            <Trans>Stories</Trans>
          </Text>
          {book.entries.map((entry) => (
            <BookStory
              key={entry.exchange_id}
              entry={entry}
              {...(organiser ? { onRemove: () => book.remove(entry.exchange_id) } : {})}
              removing={book.removing}
            />
          ))}
        </View>
      )}
      {recipes === 0 ? null : (
        <View style={{ gap: space.l }}>
          <Text accessibilityRole="header" style={[type.heading, { color: palette.ink }]}>
            <Trans>Recipes</Trans>
          </Text>
          {book.recipes.map((recipe) => (
            <BookRecipe key={recipe.id} recipe={recipe} />
          ))}
        </View>
      )}
    </View>
  );
}

/** One kept story, set like a page: who and when, the question, her words, her voice. */
function BookStory({
  entry,
  onRemove,
  removing,
}: {
  entry: ApiBookEntry;
  onRemove?: () => void;
  removing: boolean;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const [confirming, confirm] = useState(false);
  const day = dayMonth(entry.kept_at);
  const name = entry.member_name;
  const asker = entry.asked_by;
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radius.card + 6,
        borderWidth: 1,
        borderColor: palette.rule,
        padding: space.l,
        gap: space.m,
      }}
    >
      <Text style={[type.label, { color: palette.ink3, textTransform: "uppercase" }]}>
        {asker === null ? t`${name} · ${day}` : t`${name} · ${day} · ${asker} asked`}
      </Text>
      {entry.question === null ? null : (
        <Text style={[type.heading, { color: palette.ink2 }]}>{entry.question}</Text>
      )}
      {entry.photo_ids.map((id) => (
        <ReplyPhoto key={id} photo={{ id, width: null, height: null, stored: true }} size="full" />
      ))}
      {entry.answers.map((answer) => (
        <View key={`${answer.at}:${answer.media_id ?? ""}`} style={{ gap: space.s }}>
          {answer.text === null ? null : (
            <Text selectable style={[type.story, { color: palette.ink }]}>
              {answer.text}
            </Text>
          )}
          {answer.media_id !== null && answer.media_kind === "audio" ? (
            <BookVoice mediaId={answer.media_id} />
          ) : null}
          {answer.media_id !== null && answer.media_kind === "image" ? (
            <ReplyPhoto
              photo={{ id: answer.media_id, width: null, height: null, stored: true }}
              size="full"
            />
          ) : null}
        </View>
      ))}
      {onRemove === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          hitSlop={hitSlop}
          disabled={removing}
          onPress={() => confirm(true)}
          style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}
        >
          <Words variant="caption" tone="ink3">
            <Trans>Take this story out of the book</Trans>
          </Words>
        </Pressable>
      )}
      {confirming ? (
        <ConfirmationDialog
          onClose={() => {
            if (!removing) confirm(false);
          }}
        >
          <Words variant="body">
            <Trans>Take this story out of the family book?</Trans>
          </Words>
          <Words variant="caption" tone="ink2">
            <Trans>
              It will stop being kept as a story. The exchange still follows the usual retention
              period.
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
          <SecondaryButton
            label={t`Keep this story`}
            disabled={removing}
            onPress={() => confirm(false)}
          />
        </ConfirmationDialog>
      ) : null}
    </View>
  );
}

/** Her voice, played from the family's media route with the reader's own sign-in. */
function BookVoice({ mediaId }: { mediaId: string }) {
  const { familyId } = useToday();
  return familyId === undefined ? null : <VoicePlayback familyId={familyId} mediaId={mediaId} />;
}

/** A recipe card she kept (spec §10, ADR-41): her ingredients, steps and tips, as she told them. */
function BookRecipe({ recipe }: { recipe: ApiBookRecipe }) {
  const palette = usePalette();
  const { t } = useLingui();
  const name = recipe.member_name;
  const day = dayMonth(recipe.kept_at);
  const section = (heading: string, lines: string[], numbered: boolean) =>
    lines.length === 0 ? null : (
      <View style={{ gap: space.s }}>
        <Text style={[type.label, { color: palette.ink3, textTransform: "uppercase" }]}>
          {heading}
        </Text>
        {lines.map((line, index) => (
          <View key={`${heading}:${line}`} style={{ flexDirection: "row", gap: space.m }}>
            <Text style={[type.bodyMedium, { color: palette.lightDeep, minWidth: 18 }]}>
              {numbered ? `${index + 1}` : "•"}
            </Text>
            <Text style={[type.body, { color: palette.ink, flex: 1 }]}>{line}</Text>
          </View>
        ))}
      </View>
    );
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radius.card + 6,
        borderWidth: 1,
        borderColor: palette.rule,
        overflow: "hidden",
      }}
    >
      <View style={{ height: 6, backgroundColor: palette.light }} />
      <View style={{ padding: space.l, gap: space.l }}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: palette.ink3, textTransform: "uppercase" }]}>
            <Trans>
              {name}'s recipe · {day}
            </Trans>
          </Text>
          <Text style={[type.title, { color: palette.ink }]}>{recipe.title}</Text>
        </View>
        {section(t`You need`, recipe.ingredients, false)}
        {section(t`How`, recipe.steps, true)}
        {section(t`Tips`, recipe.remarks, false)}
      </View>
    </View>
  );
}
