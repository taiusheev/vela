import { Trans, useLingui } from "@lingui/react/macro";
import { Pressable, Text, View } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Words } from "./ui.tsx";

export interface AskIdea {
  key: string;
  text: string;
  /** Vela's suggestion, drawn from what the parent said lately: named as such on its card. */
  fromHerWords?: boolean;
}

/**
 * Ready questions to start from, side by side above the composer: Vela's suggestion first, then the
 * question bank's family wording. A tap puts the words in the box, to send as they are or change;
 * "More ideas" shows the next few. Nothing is sent by tapping an idea.
 */
export function AskIdeas({
  ideas,
  name,
  onPick,
  onMore,
  disabled = false,
}: {
  ideas: AskIdea[];
  name: string;
  onPick: (idea: AskIdea) => void;
  onMore: () => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  const { t } = useLingui();
  if (ideas.length === 0) return null;
  return (
    <View style={{ gap: space.s }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Words variant="heading" accessibilityRole="header">
          <Trans>Ideas for {name}</Trans>
        </Words>
        <Pressable
          accessibilityRole="button"
          hitSlop={hitSlop}
          disabled={disabled}
          onPress={onMore}
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.xs }}
        >
          <BrandIcon name="refresh" color={p.action} size={16} strokeWidth={2} />
          <Words variant="button" tone="action">
            <Trans>More ideas</Trans>
          </Words>
        </Pressable>
      </View>
      <View style={{ gap: space.s }}>
        {ideas.map((idea) => (
          <Pressable
            key={idea.key}
            accessibilityRole="button"
            accessibilityHint={t`Puts these words in your question, to send or change`}
            disabled={disabled}
            onPress={() => onPick(idea)}
            style={({ pressed }) => [
              {
                width: "100%",
                minHeight: 64,
                padding: space.m,
                gap: space.s,
                borderRadius: radius.panel,
                borderWidth: 1,
                borderColor: idea.fromHerWords ? "rgba(233, 162, 59, 0.45)" : p.rule,
                backgroundColor: idea.fromHerWords ? p.lightSoft : p.surface,
                opacity: pressed ? 0.85 : disabled ? 0.5 : 1,
              },
              softShadow,
            ]}
          >
            {idea.fromHerWords ? (
              <Text style={[type.label, { letterSpacing: 0, color: p.lightDeep }]}>
                <Trans>From {name}'s own words</Trans>
              </Text>
            ) : null}
            <Text
              numberOfLines={6}
              style={[type.preview, { fontSize: 17, lineHeight: 24, color: p.ink }]}
            >
              {idea.text}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * The question as the parent will see it in their chat: the words, then the asker's name, as an
 * arrival signs a family question. Shown once there are words, so nothing reads as a surprise.
 */
export function AskPreview({ text, name, asker }: { text: string; name: string; asker: string }) {
  const p = usePalette();
  const words = text.trim();
  if (words.length === 0) return null;
  return (
    <View style={{ gap: space.s }} accessible accessibilityLabel={`${words} — ${asker}`}>
      <Words variant="caption" tone="ink2">
        <Trans>How {name} sees it</Trans>
      </Words>
      <View
        style={{
          alignSelf: "flex-start",
          maxWidth: "88%",
          padding: space.m,
          gap: space.xs,
          borderRadius: 18,
          borderTopLeftRadius: 6,
          backgroundColor: p.surface2,
          borderWidth: 1,
          borderColor: p.rule,
        }}
      >
        <Text style={[type.body, { color: p.ink }]}>{words}</Text>
        <Text style={[type.caption, { color: p.ink2 }]}>{`— ${asker}`}</Text>
      </View>
    </View>
  );
}
