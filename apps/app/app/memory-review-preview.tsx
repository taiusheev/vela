import { msg } from "@lingui/core/macro";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { MemoryReview } from "../src/components/memory-review.tsx";
import { Text } from "../src/components/scaled-text.tsx";
import { SecondaryButton } from "../src/components/ui.tsx";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { MemoryReviewController } from "../src/data/memory-review.ts";
import { createMemoryReviewDemo, memoryReviewCopy } from "../src/data/memory-review-demo.ts";
import { reviewI18n } from "../src/i18n/memory-review.ts";
import { lightPalette, space, type } from "../src/theme/tokens.ts";

/** No production navigation entry, API fallback or stored demo consent. Explicit development demo only. */
export default function MemoryReviewPreview() {
  if (!__DEV__ || !demoDataAllowed(apiConfigured(), accountsConfigured())) return <View />;
  return <Preview />;
}
function Preview() {
  const insets = useSafeAreaInsets();
  const [revision, setRevision] = useState(0);
  const [viewer, setViewer] = useState("example-parent");
  const [locale, setLocale] = useState<"en" | "zh-TW">("en");
  reviewI18n.activate(locale);
  const scroll = useRef<ScrollView>(null);
  const onScreenChange = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: reviewI18n._(msg`Memory review preview`),
          headerLeft: () => <BackButton />,
        }}
      />
      <ScrollView
        ref={scroll}
        style={{ backgroundColor: lightPalette.bg }}
        contentContainerStyle={{
          padding: space.margin,
          paddingBottom: insets.bottom + space.xxxl,
          width: "100%",
          maxWidth: 680,
          alignSelf: "center",
          gap: space.xxl,
        }}
      >
        <Text style={[type.caption, { color: lightPalette.ink2 }]}>
          {reviewI18n._(msg`Design preview · synthetic conversations · no real saving`)}
        </Text>
        <Example
          key={`${viewer}:${revision}:${locale}`}
          viewer={viewer}
          onScreenChange={onScreenChange}
        />
        <View
          style={{
            borderTopWidth: 1,
            borderColor: lightPalette.rule,
            paddingTop: space.xl,
            gap: space.l,
          }}
        >
          <Text accessibilityRole="header" style={[type.heading, { color: lightPalette.ink }]}>
            {reviewI18n._(msg`Preview controls`)}
          </Text>
          <SecondaryButton
            label={
              viewer === "example-parent"
                ? reviewI18n._(msg`View as a family member`)
                : reviewI18n._(msg`View as the author`)
            }
            onPress={() =>
              setViewer(viewer === "example-parent" ? "example-child" : "example-parent")
            }
          />
          <SecondaryButton
            label={reviewI18n._(msg`Reset the examples`)}
            onPress={() => setRevision((value) => value + 1)}
          />
          <SecondaryButton
            label={locale === "en" ? "繁體中文" : "English"}
            onPress={() => setLocale(locale === "en" ? "zh-TW" : "en")}
          />
        </View>
      </ScrollView>
    </>
  );
}
function Example({ viewer, onScreenChange }: { viewer: string; onScreenChange(): void }) {
  const [session, setSession] = useState<{
    demo: ReturnType<typeof createMemoryReviewDemo>;
    controller: MemoryReviewController;
  } | null>(null);
  const [simulation, setSimulation] = useState<string | null>(null);
  useEffect(() => {
    const demo = createMemoryReviewDemo();
    let sequence = 0;
    const controller = new MemoryReviewController(
      viewer,
      demo.port,
      () => `example-operation:${++sequence}`,
    );
    setSession({ demo, controller });
    void controller.load();
    return () => controller.dispose();
  }, [viewer]);
  if (session === null) return <Text>{reviewI18n._(msg`Opening the preview…`)}</Text>;
  const { demo, controller } = session;
  const copy =
    viewer === "example-parent"
      ? memoryReviewCopy()
      : {
          ...memoryReviewCopy(),
          title: reviewI18n._(msg`Mom’s memories`),
          introduction: reviewI18n._(
            msg`The things Mom loves, and the stories the family keeps. Mom decides what stays.`,
          ),
          categories: {
            ...memoryReviewCopy().categories,
            preference: reviewI18n._(msg`Something Mom loves`),
          },
        };
  return (
    <View style={{ gap: space.xxl }}>
      <MemoryReview controller={controller} copy={copy} onScreenChange={onScreenChange} />
      <View style={{ gap: space.m }}>
        {simulation ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[type.caption, { color: lightPalette.ink2 }]}
          >
            {simulation}
          </Text>
        ) : null}
        <SecondaryButton
          label={reviewI18n._(msg`Simulate a failed change`)}
          onPress={() => {
            demo.failNext();
            setSimulation(
              reviewI18n._(msg`The next action will fail once, so you can try recovery.`),
            );
          }}
        />
        <SecondaryButton
          label={reviewI18n._(msg`Simulate a changed source`)}
          onPress={() => {
            demo.unavailableNext();
            setSimulation(
              reviewI18n._(msg`The source will become unavailable on the next action.`),
            );
          }}
        />
      </View>
    </View>
  );
}
