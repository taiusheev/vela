import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, updateAccount } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { FamilyAction } from "../src/components/brand/experience.tsx";
import { Portrait } from "../src/components/portrait-lamp.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import {
  Hairline,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import { useFamily } from "../src/data/useFamily.ts";
import { useMyMemories } from "../src/data/useMyMemories.ts";
import { usePortrait } from "../src/data/usePortrait.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space, type } from "../src/theme/tokens.ts";

/** One parent in the family list: their face, name and plan, opening their own settings. */
function ParentRow({
  familyId,
  memberId,
  name,
  line,
}: {
  familyId: string;
  memberId: string;
  name: string;
  line: string;
}) {
  const photo = usePortrait(familyId, memberId);
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
      <Portrait uri={photo.uri} name={name} width={36} height={36} round />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.button, { color: p.ink }]}>{name}</Text>
        <Text style={[type.caption, { color: p.ink2 }]}>{line}</Text>
      </View>
    </View>
  );
}

/**
 * The reader's own profile, opened from the card at the top of You: who they are in the family
 * (the name everyone sees on their asks and replies, which they can change here), the family and
 * its people, and the places their own things live. Settings keep the family's controls.
 */
export default function ProfileScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const day = useToday();
  const account = useAccount();
  const queries = useQueryClient();
  const { family, loading } = useFamily(day.familyId, day.familyId !== undefined);
  const memories = useMyMemories(day.familyId);
  const nameKey = useIdempotencyKey("profile-name");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // The example family has no account to change; its name changes on this screen only.
  const [exampleName, setExampleName] = useState<string | null>(null);
  const name = exampleName ?? family.me.name;
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
    onSuccess: () => setEditing(false),
  });
  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 80 && trimmed !== name;

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Profile`, headerLeft: () => <BackButton /> }}
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

        <SoftCard>
          {editing ? (
            <View style={{ gap: space.m }}>
              <TextField
                label={t`Your name`}
                value={draft}
                onChangeText={setDraft}
                helper={t`Your family sees this name on your questions and replies.`}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
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
              <SecondaryButton
                label={t`Cancel`}
                onPress={() => {
                  setEditing(false);
                  rename.reset();
                }}
              />
              {rename.isError ? (
                <Words variant="caption" tone="ink2">
                  <Trans>Your name could not be saved. Nothing changed. Try again.</Trans>
                </Words>
              ) : null}
            </View>
          ) : (
            <FamilyAction
              icon="you"
              title={t`Your name`}
              detail={name}
              actionLabel={t`Change`}
              testID="profile-name"
              onPress={() => {
                setDraft(name);
                setEditing(true);
              }}
            />
          )}
        </SoftCard>

        <View style={{ gap: space.m }}>
          <Words variant="heading" accessibilityRole="header">
            {family.familyName}
          </Words>
          <SoftCard>
            <View style={{ gap: space.m }}>
              {family.keptLight.map((parent) => (
                <ParentRow
                  key={parent.memberId}
                  familyId={day.familyId ?? ""}
                  memberId={parent.memberId}
                  name={parent.name}
                  line={parent.line}
                />
              ))}
              {family.others === undefined ? null : (
                <>
                  <Hairline />
                  <View>
                    <Text style={[type.button, { color: p.ink }]}>{family.others.names}</Text>
                    <Text style={[type.caption, { color: p.ink2 }]}>{family.others.line}</Text>
                  </View>
                </>
              )}
            </View>
          </SoftCard>
        </View>

        <SoftCard padding={space.s}>
          <View style={{ paddingHorizontal: space.s }}>
            {memories.available ? (
              <>
                <FamilyAction
                  icon="heart"
                  title={t`Your memories`}
                  detail={t`Little things worth remembering from your own answers`}
                  onPress={() => router.push("/my-memories")}
                />
                <Hairline />
              </>
            ) : null}
            <FamilyAction
              icon="you"
              title={t`Settings`}
              detail={t`Parent photos and links, notifications, language, and account`}
              onPress={() => router.push("/settings")}
            />
          </View>
        </SoftCard>
      </ScrollView>
    </>
  );
}
