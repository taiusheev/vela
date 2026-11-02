import { Trans, useLingui } from "@lingui/react/macro";
import { MEMORY_KEEP_EXPLANATION_EN } from "@vela/contracts";
import { Stack, useFocusEffect } from "expo-router";
import { type ReactNode, useCallback, useState } from "react";
import { Linking, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { noticeUrl } from "../src/api/support.ts";
import { BackButton } from "../src/components/back-button.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import { PrimaryButton, SecondaryButton, Words } from "../src/components/ui.tsx";
import { localDayMonth } from "../src/data/format.ts";
import { type MemoryWrite, useMyMemories } from "../src/data/useMyMemories.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type Pane =
  | { kind: "list" }
  | { kind: "keep"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "withdraw" };
type Notice = "kept" | "left_out" | "removed" | "cleared" | "on" | "not_now" | null;

/** Their own words, set as a quote: the one place this screen uses the family's typeface. */
function Quote({ words }: { words: string }) {
  const palette = usePalette();
  return (
    <View style={{ borderLeftWidth: 3, borderColor: palette.lightSoft, paddingLeft: space.m }}>
      <Words variant="preview">{`“${words}”`}</Words>
    </View>
  );
}

/**
 * "Your memories" (privacy-notice v7, consent.rich_memories@2): the signed-in person's own yes or
 * no, the suggestions from their own answers that only they see, the exact words they kept, and
 * "turn off and clear". Reached from You only where the server offers Memories; nobody else's
 * words appear here, and an organiser cannot answer for anyone.
 */
export default function MyMemoriesScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { familyId } = useToday();
  const memories = useMyMemories(familyId);
  const [pane, setPane] = useState<Pane>({ kind: "list" });
  const [notice, setNotice] = useState<Notice>(null);
  const refresh = memories.refresh;
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const busy = memories.pending !== null;
  const failedLine = (kind: MemoryWrite) =>
    memories.failed === kind ? (
      <Words variant="caption" tone="ink2">
        <Trans>That did not go through. Nothing changed. Try again.</Trans>
      </Words>
    ) : null;
  const done = (next: Notice) => (ok: boolean) => {
    if (ok) {
      setPane({ kind: "list" });
      setNotice(next);
    }
  };
  const state = memories.state?.state;
  const on = state === "yes" && memories.state?.outdated === false;
  const keeping =
    pane.kind === "keep" ? memories.suggestions.find((item) => item.id === pane.id) : undefined;
  const removing =
    pane.kind === "remove" ? memories.kept.find((item) => item.id === pane.id) : undefined;

  let body: ReactNode;
  if (memories.loading) {
    body = (
      <Words variant="body" tone="ink2">
        <Trans>Looking for your memories…</Trans>
      </Words>
    );
  } else if (!memories.available) {
    body = (
      <Words variant="body" tone="ink2">
        {memories.trouble ? (
          <Trans>Your memories could not be reached just now.</Trans>
        ) : (
          <Trans>Memories are not available here yet.</Trans>
        )}
      </Words>
    );
  } else if (memories.question !== null) {
    const shown = memories.question;
    // The words come from the server exactly as reviewed, every one of them shown; the answer
    // echoes their fingerprint. The question leads, then one sentence a line, for easy reading.
    const ask = shown.text.indexOf("?") + 1;
    const sentences = shown.text
      .slice(ask)
      .trim()
      .split(/(?<=\.)\s+/);
    body = (
      <View style={{ gap: space.l }}>
        <Words variant="title" accessibilityRole="header">
          {shown.text.slice(0, ask)}
        </Words>
        <View style={{ gap: space.s }}>
          {sentences.map((sentence) => (
            <Words key={sentence} variant="body">
              {sentence}
            </Words>
          ))}
        </View>
        <SecondaryButton
          label={t`Read the privacy notice`}
          icon="privacy"
          onPress={() => void Linking.openURL(noticeUrl("/privacy"))}
        />
        <PrimaryButton
          label={t`Allow memory suggestions`}
          disabled={busy}
          onPress={() => void memories.answer("yes").then(done("on"))}
        />
        <SecondaryButton
          label={t`Not now`}
          disabled={busy}
          onPress={() => void memories.answer("no").then(done("not_now"))}
        />
        {failedLine("answer")}
      </View>
    );
  } else if (pane.kind === "keep" && keeping !== undefined) {
    body = (
      <View style={{ gap: space.l }}>
        <Words variant="title" accessibilityRole="header">
          <Trans>Keep these words?</Trans>
        </Words>
        <Quote words={keeping.quote} />
        <Words variant="body">{MEMORY_KEEP_EXPLANATION_EN}</Words>
        <PrimaryButton
          label={t`Keep these words`}
          disabled={busy}
          onPress={() => void memories.keep(keeping.id).then(done("kept"))}
        />
        <SecondaryButton label={t`Back`} onPress={() => setPane({ kind: "list" })} />
        {failedLine("keep")}
      </View>
    );
  } else if (pane.kind === "remove" && removing !== undefined) {
    body = (
      <View style={{ gap: space.l }}>
        <Words variant="title" accessibilityRole="header">
          <Trans>Remove this memory?</Trans>
        </Words>
        <Quote words={removing.quote} />
        <Words variant="body">
          <Trans>
            These words will be removed from your memories in Vela. Your original chat does not
            change.
          </Trans>
        </Words>
        <PrimaryButton
          label={t`Remove`}
          disabled={busy}
          onPress={() => void memories.remove(removing.id).then(done("removed"))}
        />
        <SecondaryButton label={t`Back`} onPress={() => setPane({ kind: "list" })} />
        {failedLine("remove")}
      </View>
    );
  } else if (pane.kind === "withdraw") {
    body = (
      <View style={{ gap: space.l }}>
        <Words variant="title" accessibilityRole="header">
          <Trans>Turn off and clear your memories?</Trans>
        </Words>
        <Words variant="body">
          <Trans>
            Vela will stop suggesting memories from your answers. Your suggestions and kept memories
            will be removed from Vela. Your ordinary chats and other choices will not change.
          </Trans>
        </Words>
        <Words variant="body" tone="ink2">
          <Trans>
            This cannot erase copies people have saved outside Vela. Turning memories on again later
            will not bring these memories back.
          </Trans>
        </Words>
        <PrimaryButton
          label={t`Turn off and clear`}
          disabled={busy}
          onPress={() => void memories.withdraw().then(done("cleared"))}
        />
        <SecondaryButton
          label={t`Keep my current settings`}
          onPress={() => setPane({ kind: "list" })}
        />
        {failedLine("withdraw")}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: space.xl }}>
        {notice === null ? null : (
          <View accessibilityLiveRegion="polite">
            <Words variant="body" tone="action">
              {notice === "kept" ? (
                <Trans>Kept. Only you can see these words.</Trans>
              ) : notice === "left_out" ? (
                <Trans>Left out. Your chat has not changed.</Trans>
              ) : notice === "removed" ? (
                <Trans>Removed from your memories.</Trans>
              ) : notice === "cleared" ? (
                <Trans>Your memory permission and copies have been cleared in Vela.</Trans>
              ) : notice === "on" ? (
                <Trans>Memory suggestions are on. New answers from now on can be suggested.</Trans>
              ) : (
                <Trans>Memory suggestions stay off. Nothing else changed.</Trans>
              )}
            </Words>
          </View>
        )}
        {memories.stale ? (
          <Words variant="body" tone="ink2">
            <Trans>That question was no longer current. Nothing was recorded.</Trans>
          </Words>
        ) : null}
        {on ? null : (
          <SoftCard>
            <View style={{ gap: space.m }}>
              <Words variant="heading">
                {memories.state?.outdated ? (
                  <Trans>The memory question has changed</Trans>
                ) : (
                  <Trans>Memory suggestions are off</Trans>
                )}
              </Words>
              <Words variant="body" tone="ink2">
                <Trans>
                  If you agree, Vela can suggest little things worth remembering from your own new
                  answers. Only you see them, and you choose what to keep.
                </Trans>
              </Words>
              <PrimaryButton
                label={t`Read the question`}
                disabled={busy}
                onPress={() => {
                  setNotice(null);
                  memories.openQuestion();
                }}
              />
              {failedLine("question")}
            </View>
          </SoftCard>
        )}
        {on ? (
          <View style={{ gap: space.m }}>
            <Words variant="heading" accessibilityRole="header">
              <Trans>Suggested for you</Trans>
            </Words>
            {memories.suggestions.length === 0 ? (
              <Words variant="body" tone="ink2">
                <Trans>
                  Nothing to suggest yet. Suggestions come from answers you send from now on.
                </Trans>
              </Words>
            ) : null}
            {memories.suggestions.map((item) => {
              const until = localDayMonth(item.expires_at.slice(0, 10));
              return (
                <SoftCard key={item.id}>
                  <View style={{ gap: space.m }}>
                    <Quote words={item.quote} />
                    <Words variant="caption" tone="ink3">
                      <Trans>Disappears on {until} unless you keep it.</Trans>
                    </Words>
                    <SecondaryButton
                      label={t`Keep these words`}
                      icon="heart"
                      disabled={busy}
                      onPress={() => setPane({ kind: "keep", id: item.id })}
                    />
                    <SecondaryButton
                      label={t`Leave out`}
                      disabled={busy}
                      onPress={() => void memories.dismiss(item.id).then(done("left_out"))}
                    />
                  </View>
                </SoftCard>
              );
            })}
            {failedLine("dismiss")}
          </View>
        ) : null}
        {memories.kept.length > 0 ? (
          <View style={{ gap: space.m }}>
            <Words variant="heading" accessibilityRole="header">
              <Trans>Kept</Trans>
            </Words>
            {memories.kept.map((item) => {
              const when = localDayMonth(item.kept_at.slice(0, 10));
              return (
                <SoftCard key={item.id}>
                  <View style={{ gap: space.m }}>
                    <Quote words={item.quote} />
                    <Words variant="caption" tone="ink3">
                      <Trans>Kept on {when}. Only you can see it.</Trans>
                    </Words>
                    <SecondaryButton
                      label={t`Remove`}
                      icon="trash"
                      disabled={busy}
                      onPress={() => setPane({ kind: "remove", id: item.id })}
                    />
                  </View>
                </SoftCard>
              );
            })}
          </View>
        ) : null}
        {memories.trouble ? (
          <SecondaryButton label={t`Try again`} onPress={memories.refresh} />
        ) : null}
        {on || memories.kept.length > 0 ? (
          <SecondaryButton
            label={t`Turn off and clear`}
            icon="stop"
            disabled={busy}
            onPress={() => setPane({ kind: "withdraw" })}
          />
        ) : null}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Your memories`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={false} onRefresh={memories.refresh} />}
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <Words variant="body" tone="ink2">
          <Trans>
            Little things worth remembering from your own answers. Only you can see them.
          </Trans>
        </Words>
        {body}
      </ScrollView>
    </>
  );
}
