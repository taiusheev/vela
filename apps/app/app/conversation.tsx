import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ComposeAsk } from "@vela/contracts";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, composeAsk } from "../src/api/client.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import {
  Card,
  Hairline,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { selectedLight } from "../src/data/selected-light.ts";
import { useExchanges } from "../src/data/useExchanges.ts";
import { useToday } from "../src/data/useToday.ts";
import { useDraft } from "../src/storage/useDraft.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

const UNLINKED = "pending";

/** Anytime text and the existing morning ritual share a person, without sharing a daily slot. */
export default function ConversationScreen() {
  const { recipient } = useLocalSearchParams<{ recipient?: string }>();
  const day = useToday();
  return <Conversation key={`${day.familyId ?? UNLINKED}:${recipient ?? UNLINKED}`} />;
}

function Conversation() {
  const { recipient } = useLocalSearchParams<{ recipient?: string }>();
  const day = useToday();
  const light = selectedLight(day.today.lights, recipient);
  const account = useAccount();
  const queries = useQueryClient();
  const [watching, setWatching] = useState(false);
  const history = useExchanges(watching);
  useFocusEffect(
    useCallback(() => {
      setWatching(true);
      return () => setWatching(false);
    }, []),
  );
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const inlineComposer = fontScale > 1.3;
  const scroll = useRef<ScrollView>(null);
  const following = useRef(true);
  const { t } = useLingui();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const draft = useDraft(`conversation.${day.familyId ?? UNLINKED}.${light?.memberId ?? UNLINKED}`);
  const [receipt, setReceipt] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      history.refresh();
      day.refresh();
    }, [history.refresh, day.refresh]),
  );
  const name = light?.displayName ?? t`Your parent`;
  const invited = light?.invited === true;
  const send = useMutation({
    mutationFn: async () => {
      if (demo) return { when: "now" };
      if (day.familyId === undefined || light === undefined) throw new Error("No recipient");
      const body = {
        recipient_id: light.memberId,
        type: "question" as const,
        when: invited ? ("whenever" as const) : ("now" as const),
        text: draft.text.trim(),
      };
      const saved = draft.savedBody<ComposeAsk>();
      const request = ComposeAsk.parse(
        saved?.text === body.text && saved?.recipient_id === body.recipient_id ? saved : body,
      );
      await composeAsk(day.familyId, await draft.keyFor(request), request, await account.token());
      return { when: request.when };
    },
    onSuccess: async (accepted) => {
      await draft.clear();
      setReceipt(
        demo
          ? t`Example only. Nothing was sent.`
          : accepted.when === "whenever"
            ? t`Saved for their first morning after they join.`
            : t`Accepted for delivery. This is not a read receipt.`,
      );
      void queries.invalidateQueries({ queryKey: ["exchanges"] });
      void queries.invalidateQueries({ queryKey: ["today"] });
    },
  });
  const canSend =
    light !== undefined &&
    (demo || day.live) &&
    light.state !== "paused" &&
    light.unreachableOn === undefined;
  const composer = (
    <View
      style={{
        gap: space.s,
        paddingHorizontal: inlineComposer ? 0 : space.margin,
        paddingTop: space.m,
        paddingBottom: insets.bottom + space.m,
        borderTopWidth: 1,
        borderTopColor: palette.rule,
        backgroundColor: palette.bg,
      }}
    >
      <TextField
        label={t`Something for ${name}`}
        value={draft.text}
        onChangeText={(text) => {
          draft.setText(text);
          setReceipt(null);
        }}
        placeholder={t`Write to ${name}`}
        multiline
        maxLength={1000}
        disabled={send.isPending}
      />
      <PrimaryButton
        label={
          send.isPending ? t`Sending…` : invited ? t`Save for their first morning` : t`Send now`
        }
        onPress={() => send.mutate()}
        disabled={!canSend || !draft.ready || draft.text.trim() === "" || send.isPending}
      />
      {draft.saveFailed ? (
        <Words>
          <Trans>
            This draft could not be saved on this phone. Keep this screen open and try again.
          </Trans>
        </Words>
      ) : null}
      {!canSend ? (
        <Words tone="ink2">
          <Trans>
            Messaging is unavailable while their connection is paused or cannot be reached. Your
            draft stays here.
          </Trans>
        </Words>
      ) : null}
      {send.isError ? (
        <Words>
          <Trans>
            That could not be confirmed. Your words are still here. Retry to confirm the same
            message.
          </Trans>
        </Words>
      ) : null}
      {receipt === null ? null : (
        <View accessibilityLiveRegion="polite">
          <Words>{receipt}</Words>
        </View>
      )}
      {light === undefined ? (
        <SecondaryButton label={t`Go to You`} onPress={() => router.push("/(tabs)/you")} />
      ) : (
        <SecondaryButton
          label={t`Leave something for their morning`}
          onPress={() => router.push({ pathname: "/ask", params: { recipient: light?.memberId } })}
        />
      )}
    </View>
  );
  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: name, headerLeft: () => <BackButton /> }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: palette.bg }}
      >
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          onContentSizeChange={() => {
            if (following.current)
              requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
          }}
          onScroll={({ nativeEvent }) => {
            following.current =
              nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >=
              nativeEvent.contentSize.height - 80;
          }}
          scrollEventThrottle={100}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={history.refreshing} onRefresh={history.refresh} />
          }
          contentContainerStyle={{
            padding: space.margin,
            paddingBottom: insets.bottom + space.xxxl,
            gap: space.l,
          }}
        >
          <Words variant="title">
            <Trans>Talk with {name}</Trans>
          </Words>
          <Words tone="ink2">
            {invited
              ? t`Write something they will recognise as you. It waits for their yes.`
              : t`Say it while it is on your mind. Their daily morning stays scheduled.`}
          </Words>
          {history.loading ? (
            <Words>
              <Trans>Loading your conversation…</Trans>
            </Words>
          ) : null}
          {history.trouble ? (
            <SecondaryButton label={t`Try again`} onPress={history.refresh} />
          ) : null}
          {history.exchanges
            .filter((exchange) => exchange.recipientId === light?.memberId)
            .slice()
            .reverse()
            .map((exchange) => (
              <Card key={exchange.id}>
                <Words variant="caption" tone="ink2">
                  {exchange.asker} · {exchange.day}
                </Words>
                <Words>{exchange.ask}</Words>
                {exchange.deliveryNotice === undefined ? null : (
                  <Words tone="ink2">{exchange.deliveryNotice}</Words>
                )}
                {exchange.answer === undefined ? null : (
                  <>
                    <Hairline />
                    <Words variant="caption" tone="ink2">
                      {name} · {exchange.answer.at}
                    </Words>
                    <Words>{exchange.answer.text}</Words>
                  </>
                )}
                <SecondaryButton
                  label={t`Open this exchange`}
                  onPress={() =>
                    router.push({ pathname: "/exchange/[id]", params: { id: exchange.id } })
                  }
                />
              </Card>
            ))}
          {history.more ? (
            <SecondaryButton
              label={t`Earlier messages`}
              onPress={() => {
                following.current = false;
                history.loadMore();
              }}
            />
          ) : null}
          {inlineComposer ? composer : null}
        </ScrollView>
        {inlineComposer ? null : composer}
      </KeyboardAvoidingView>
    </>
  );
}
