import { Trans, useLingui } from "@lingui/react/macro";
import type { ApiBookEntry, ApiBookRecipe } from "@vela/contracts";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiBaseUrl, apiConfigured } from "../src/api/client.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { ReplyPhoto } from "../src/components/family-photo.tsx";
import { Card, Eyebrow, SecondaryButton, Words } from "../src/components/ui.tsx";
import { dayMonth } from "../src/data/format.ts";
import { useBook } from "../src/data/useBook.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { hitSlop, space } from "../src/theme/tokens.ts";

/**
 * The family book (spec §10, A10; ADR-39): the stories she told, kept beyond the 30 days, newest
 * first, each with its question, who asked it, her words and her voice. Every member reads it; an
 * organiser can take a story out. Reading never needs Vela Light.
 */
export default function BookScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { familyId, organiser } = useToday();
  const book = useBook(familyId);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t`The family book` }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        {!apiConfigured() ? (
          <Words variant="body" tone="ink2">
            <Trans>The family book fills with the stories she tells on story day.</Trans>
          </Words>
        ) : book.loading ? (
          <Words variant="body" tone="ink2">
            <Trans>Opening the book…</Trans>
          </Words>
        ) : book.trouble ? (
          <Words variant="body" tone="ink2">
            <Trans>The family book could not be reached just now.</Trans>
          </Words>
        ) : book.entries.length === 0 && book.recipes.length === 0 ? (
          <Words variant="body" tone="ink2">
            <Trans>
              No stories yet. Choose a question on the Sunday tab, and what she tells is kept here.
            </Trans>
          </Words>
        ) : (
          [
            ...book.recipes.map((recipe) => <Recipe key={recipe.id} recipe={recipe} />),
            ...book.entries.map((entry) => (
              <Story
                key={entry.exchange_id}
                entry={entry}
                {...(organiser ? { onRemove: () => book.remove(entry.exchange_id) } : {})}
                removing={book.removing}
              />
            )),
          ]
        )}
      </ScrollView>
    </>
  );
}

function Story({
  entry,
  onRemove,
  removing,
}: {
  entry: ApiBookEntry;
  onRemove?: () => void;
  removing: boolean;
}) {
  const { t } = useLingui();
  const day = dayMonth(entry.kept_at);
  const name = entry.member_name;
  const asker = entry.asked_by;
  return (
    <Card>
      <Eyebrow>
        {asker === null ? t`${name} · ${day}` : t`${name} · ${day} · ${asker} asked`}
      </Eyebrow>
      {entry.question === null ? null : <Words variant="voice">{entry.question}</Words>}
      {entry.photo_ids.map((id) => (
        <ReplyPhoto key={id} photo={{ id, width: null, height: null, stored: true }} size="full" />
      ))}
      {entry.answers.map((answer) => (
        <View key={`${answer.at}:${answer.media_id ?? ""}`} style={{ gap: space.s }}>
          {answer.text === null ? null : <Words variant="body">{answer.text}</Words>}
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
          onPress={onRemove}
        >
          <Words variant="caption" tone="ink3">
            <Trans>Take this story out of the book</Trans>
          </Words>
        </Pressable>
      )}
    </Card>
  );
}

/** Her voice, played from the family's media route with the reader's own sign-in. */
function BookVoice({ mediaId }: { mediaId: string }) {
  const { t } = useLingui();
  const account = useAccount();
  const { familyId } = useToday();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void account.token().then((next) => {
      if (current) setToken(next);
    });
    return () => {
      current = false;
    };
  }, [account]);
  const source =
    token === null || familyId === undefined
      ? null
      : {
          uri: `${apiBaseUrl ?? ""}/v1/families/${familyId}/media/${mediaId}`,
          headers: { authorization: `Bearer ${token}` },
        };
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  return (
    <SecondaryButton
      label={status.playing ? t`Stop` : t`▶ Her voice`}
      onPress={() => {
        if (status.playing) {
          player.pause();
          return;
        }
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).then(
          async () => {
            if (status.didJustFinish || status.currentTime >= status.duration)
              await player.seekTo(0);
            player.play();
          },
        );
      }}
    />
  );
}

/** A recipe card she kept (spec §10, ADR-41): her ingredients, steps and tips, as she told them. */
function Recipe({ recipe }: { recipe: ApiBookRecipe }) {
  const { t } = useLingui();
  const name = recipe.member_name;
  const day = dayMonth(recipe.kept_at);
  const section = (heading: string, lines: string[]) =>
    lines.length === 0 ? null : (
      <View style={{ gap: space.xs }}>
        <Words variant="bodyMedium">{heading}</Words>
        {lines.map((line) => (
          <Words key={line} variant="body">
            {`• ${line}`}
          </Words>
        ))}
      </View>
    );
  return (
    <Card>
      <Eyebrow>
        <Trans>
          {name}'s recipe · {day}
        </Trans>
      </Eyebrow>
      <Words variant="voice">{recipe.title}</Words>
      {section(t`You need`, recipe.ingredients)}
      {section(t`How`, recipe.steps)}
      {section(t`Tips`, recipe.remarks)}
    </Card>
  );
}
