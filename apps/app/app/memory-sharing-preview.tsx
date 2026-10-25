import { msg } from "@lingui/core/macro";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { MemorySharing } from "../src/components/memory-sharing.tsx";
import { Text } from "../src/components/scaled-text.tsx";
import { SecondaryButton } from "../src/components/ui.tsx";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { MemorySharingController } from "../src/data/memory-sharing.ts";
import {
  createMemorySharingDemo,
  DEMO_MEMORY_AUTHOR,
  DEMO_MEMORY_ID,
  memorySharingCopy,
} from "../src/data/memory-sharing-demo.ts";
import { sharingI18n } from "../src/i18n/memory-sharing.ts";
import { lightPalette as ink, space, type } from "../src/theme/tokens.ts";

/** Deliberately no production navigation, storage, network, account fallback or live consent. */
export default function MemorySharingPreview() {
  if (!__DEV__ || !demoDataAllowed(apiConfigured(), accountsConfigured())) return <View />;
  return <Preview />;
}
function Preview() {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const onScreenChange = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  const [session, setSession] = useState<{
    demo: ReturnType<typeof createMemorySharingDemo>;
    controller: MemorySharingController;
  } | null>(null);
  const [reader, setReader] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const demo = createMemorySharingDemo();
    let sequence = 0;
    const controller = new MemorySharingController(
      DEMO_MEMORY_AUTHOR,
      DEMO_MEMORY_ID,
      demo.port,
      () => `example-sharing-${++sequence}`,
    );
    setSession({ demo, controller });
    void controller.load();
    return () => controller.dispose();
  }, []);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: sharingI18n._(msg`Memory sharing preview`),
          headerLeft: () => <BackButton />,
        }}
      />
      <ScrollView
        ref={scroll}
        style={{ backgroundColor: ink.bg }}
        contentContainerStyle={{
          padding: space.margin,
          paddingBottom: insets.bottom + space.xxxl,
          width: "100%",
          maxWidth: 680,
          alignSelf: "center",
          gap: space.xxl,
        }}
      >
        <Text style={[type.caption, { color: ink.ink2 }]}>
          {sharingI18n._(msg`Synthetic preview · no real sharing · English draft`)}
        </Text>
        {session ? (
          reader ? (
            <View style={{ gap: space.l }}>
              <Text accessibilityRole="header" style={[type.title, { color: ink.ink }]}>
                {sharingI18n._(msg`Shared with Alex`)}
              </Text>
              <Text selectable style={[type.voice, { color: ink.ink }]}>
                {session.demo.readerQuote() ??
                  sharingI18n._(msg`No memory has been shared with Alex.`)}
              </Text>
              <Text style={[type.body, { color: ink.ink2 }]}>
                {sharingI18n._(
                  msg`Only the selected quote appears. This does not open the original conversation.`,
                )}
              </Text>
            </View>
          ) : (
            <MemorySharing
              controller={session.controller}
              copy={memorySharingCopy}
              onScreenChange={onScreenChange}
            />
          )
        ) : (
          <Text>{sharingI18n._(msg`Opening the example…`)}</Text>
        )}
        <View
          style={{ gap: space.l, borderTopWidth: 1, borderColor: ink.rule, paddingTop: space.xl }}
        >
          <Text accessibilityRole="header" style={[type.heading, { color: ink.ink }]}>
            {sharingI18n._(msg`Preview controls`)}
          </Text>
          <SecondaryButton
            label={
              reader ? sharingI18n._(msg`View as the author`) : sharingI18n._(msg`View as Alex`)
            }
            onPress={() => {
              setReader((value) => !value);
              onScreenChange();
            }}
          />
          {session ? (
            <>
              <SecondaryButton
                label={sharingI18n._(msg`Simulate a failed action`)}
                onPress={() => {
                  session.demo.failNext();
                  setMessage(
                    sharingI18n._(msg`The next action will fail once so you can try recovery.`),
                  );
                }}
              />
              <SecondaryButton
                label={sharingI18n._(msg`Remove the example source`)}
                onPress={() => {
                  session.demo.removeSource();
                  void session.controller.load();
                  setMessage(
                    sharingI18n._(msg`The source is unavailable; the quote is no longer shown.`),
                  );
                }}
              />
              <SecondaryButton
                label={sharingI18n._(msg`Refresh sharing details`)}
                onPress={() => {
                  void session.controller.load();
                  setMessage("");
                }}
              />
            </>
          ) : null}
          {message ? (
            <Text accessibilityLiveRegion="polite" style={[type.body, { color: ink.ink2 }]}>
              {message}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}
