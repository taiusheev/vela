import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, updateAccount } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { CancelButton, SHEET } from "../src/components/back-button.tsx";
import { Portrait } from "../src/components/portrait-lamp.tsx";
import { PrimaryButton, TextField, Words } from "../src/components/ui.tsx";
import { useFamily } from "../src/data/useFamily.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

/**
 * The reader's name, opened from "Your name" on You: the name everyone sees on their questions and
 * replies. You already shows the family and the reader's own things, so this page holds only the
 * name, ready to edit.
 */
export default function ProfileScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const day = useToday();
  const account = useAccount();
  const queries = useQueryClient();
  const { family, loading } = useFamily(day.familyId, day.familyId !== undefined);
  const nameKey = useIdempotencyKey("profile-name");
  // The example family has no account to change; its name changes on this screen only.
  const [exampleName, setExampleName] = useState<string | null>(null);
  const name = exampleName ?? family.me.name;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (loading ? "" : name);
  const [saved, setSaved] = useState(false);
  const rename = useMutation({
    mutationFn: async (next: string) => {
      if (!apiConfigured()) {
        setExampleName(next);
        return;
      }
      await updateAccount(
        { display_name: next },
        nameKey({ display_name: next }),
        await account.token(),
      );
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["me"] }),
        queries.invalidateQueries({ queryKey: ["family"] }),
      ]);
    },
    onSuccess: () => {
      setDraft(null);
      setSaved(true);
    },
  });
  const trimmed = shown.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 80 && trimmed !== name;

  return (
    <>
      <Stack.Screen
        options={{ ...SHEET, title: t`Your name`, headerLeft: () => <CancelButton /> }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: p.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <View style={{ alignItems: "center", gap: space.s }}>
          <Portrait uri={null} name={name} width={72} height={72} round />
          <Words variant="title" accessibilityRole="header">
            {loading ? t`Loading…` : name}
          </Words>
          <Words variant="caption" tone="ink2">
            {family.me.line}
          </Words>
        </View>
        <TextField
          label={t`Your name`}
          value={shown}
          onChangeText={(value) => {
            setSaved(false);
            setDraft(value);
          }}
          helper={t`Your family sees this name on your questions and replies.`}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={80}
          onSubmit={() => {
            if (canSave) rename.mutate(trimmed);
          }}
        />
        <PrimaryButton
          label={rename.isPending ? t`Saving…` : t`Save name`}
          disabled={!canSave || rename.isPending}
          onPress={() => rename.mutate(trimmed)}
        />
        {rename.isError ? (
          <Words variant="caption" tone="ink2">
            <Trans>Your name could not be saved. Nothing changed. Try again.</Trans>
          </Words>
        ) : saved ? (
          <Words variant="caption" tone="ink2">
            <Trans>Saved. Your family sees {name} from now on.</Trans>
          </Words>
        ) : null}
      </ScrollView>
    </>
  );
}
