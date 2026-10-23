import { useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import { BrandHeader } from "../src/components/brand/header.tsx";
import { EligibilityReview } from "../src/components/eligibility-review.tsx";
import { Chip, SecondaryButton, Words } from "../src/components/ui.tsx";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { EligibilityReviewController } from "../src/data/public-eligibility.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/** Synthetic review only. Never mounts with an API, account provider, or production build. */
export default function EligibilityPreview() {
  if (
    !__DEV__ ||
    !demoDataAllowed(apiConfigured(), accountsConfigured()) ||
    apiConfigured() ||
    accountsConfigured()
  )
    return <View />;
  return <Preview />;
}
function Preview() {
  const { t } = useLingui();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [actor, setActor] = useState<"app" | "parent">("app");
  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingHorizontal: space.margin,
        paddingTop: insets.top + space.xl,
        paddingBottom: insets.bottom + space.xl,
        gap: space.l,
      }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <BrandHeader />
      <Words variant="caption" tone="ink2">{t`SYNTHETIC REVIEW · DRAFT · NO LIVE CONSENT`}</Words>
      <Words tone="ink2">{t`Use fictional answers only. This preview keeps test choices in memory until you leave. No account, network, database or messages.`}</Words>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        <Chip
          label={t`App user: Alex`}
          selected={actor === "app"}
          onPress={() => setActor("app")}
        />
        <Chip
          label={t`Parent: Lin`}
          selected={actor === "parent"}
          onPress={() => setActor("parent")}
        />
      </View>
      <Example key={actor} actor={actor} />
    </ScrollView>
  );
}
function Example({ actor }: { actor: string }) {
  const { t } = useLingui();
  const [failureQueued, setFailureQueued] = useState(false);
  const [demo] = useState(() => {
    let failure = false;
    let sequence = 0;
    const controller = new EligibilityReviewController(
      `example-${actor}`,
      {
        record: async () => {
          if (failure) {
            failure = false;
            setFailureQueued(false);
            throw new Error("synthetic-save-failure");
          }
        },
        clear: async () => {
          if (failure) {
            failure = false;
            setFailureQueued(false);
            throw new Error("synthetic-clear-failure");
          }
        },
      },
      () => `example-eligibility-${actor}-${++sequence}`,
    );
    return {
      controller,
      failNext: () => {
        failure = true;
      },
    };
  });
  useEffect(() => () => demo.controller.dispose(), [demo]);
  return (
    <>
      <EligibilityReview controller={demo.controller} />
      <SecondaryButton
        label={t`Make the next record or clear fail`}
        onPress={() => {
          demo.failNext();
          setFailureQueued(true);
        }}
      />
      {failureQueued ? (
        <Words
          variant="caption"
          tone="ink2"
        >{t`One synthetic failure queued. No real connection is used.`}</Words>
      ) : null}
    </>
  );
}
