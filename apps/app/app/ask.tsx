import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  Chip,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import {
  type AskType,
  askTypes,
  previewTranslation,
  recipientLanguage,
  suggestionFixture,
  tomorrowTakenBy,
} from "../src/data/ask.ts";
import { todayFixture } from "../src/data/today.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type When = "tomorrow" | "day_after" | "whenever";

export default function AskScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const recipient = todayFixture.lights[0]?.displayName ?? "her";
  const [kind, setKind] = useState<AskType>("question");
  const [text, setText] = useState("");
  const [when, setWhen] = useState<When>(tomorrowTakenBy === undefined ? "tomorrow" : "whenever");
  const preview = previewTranslation(text);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `Ask ${recipient} something` }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
          <Eyebrow>PROMPT · FROM HER OWN WORDS</Eyebrow>
          <Words variant="voice">{suggestionFixture.text}</Words>
          <SecondaryButton label="Use this" onPress={() => setText(suggestionFixture.text)} />
        </Card>

        <View style={{ gap: space.m }}>
          <Words variant="heading">What are you sending?</Words>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            {askTypes.map((option) => (
              <Chip
                key={option.kind}
                label={option.label}
                selected={option.kind === kind}
                disabled={!option.available}
                onPress={() => setKind(option.kind)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: space.m }}>
          <TextField
            value={text}
            onChangeText={setText}
            placeholder="Say it the way you would say it"
            helper={`She reads it in ${recipientLanguage}. One question at a time.`}
            multiline
          />
          {preview.length === 0 ? null : (
            <Card>
              <Eyebrow>{`SHE WILL SEE · ${recipientLanguage.toUpperCase()}`}</Eyebrow>
              <Words variant="voice">{preview}</Words>
            </Card>
          )}
        </View>

        <View style={{ gap: space.m }}>
          <Words variant="heading">When</Words>
          {tomorrowTakenBy === undefined ? null : (
            <Words variant="body" tone="ink2">
              {`${tomorrowTakenBy} already has tomorrow morning.`}
            </Words>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            <Chip
              label="Tomorrow morning"
              selected={when === "tomorrow"}
              disabled={tomorrowTakenBy !== undefined}
              onPress={() => setWhen("tomorrow")}
            />
            {tomorrowTakenBy === undefined ? null : (
              <Chip
                label="The day after"
                selected={when === "day_after"}
                onPress={() => setWhen("day_after")}
              />
            )}
            <Chip
              label="Whenever"
              selected={when === "whenever"}
              onPress={() => setWhen("whenever")}
            />
          </View>
        </View>

        <PrimaryButton label="Into her morning" onPress={() => router.back()} />
      </ScrollView>
    </>
  );
}
