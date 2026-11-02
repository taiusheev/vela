import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { radius, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { Text } from "./scaled-text.tsx";
import { SectionTitle } from "./today-hero.tsx";
import { Words } from "./ui.tsx";

interface Offer {
  key: string;
  icon: BrandIconName;
  title: string;
  /** The words the chat opens with, shown here as they will be sent, and still editable there. */
  words: string;
}

/** One offer: what it is, and the message it starts, drawn as the bubble she will receive. */
function OfferRow({ offer, first, onPress }: { offer: Offer; first: boolean; onPress(): void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={offer.words}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space.s,
        paddingHorizontal: space.l,
        paddingVertical: space.m + 2,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: p.rule,
        backgroundColor: pressed ? p.surface2 : "transparent",
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <BrandIcon name={offer.icon} color={p.lightDeep} size={20} strokeWidth={2} />
        <Text style={[type.button, { color: p.ink, flex: 1 }]}>{offer.title}</Text>
        <BrandIcon name="chevron" color={p.ink3} size={16} strokeWidth={2} />
      </View>
      <View
        style={{
          marginLeft: 20 + space.m,
          alignSelf: "flex-start",
          maxWidth: "100%",
          backgroundColor: p.lightSoft,
          borderRadius: 16,
          borderBottomLeftRadius: 4,
          paddingHorizontal: space.m,
          paddingVertical: space.s,
        }}
      >
        <Text style={[type.body, { fontSize: 15, lineHeight: 21, color: p.ink }]}>
          {offer.words}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * General, optional family support; no inferred condition or health data processing. Each offer
 * opens the chat with its words ready, so the family can change them before anything is sent.
 */
export function WeeklySupport({ name, memberId }: { name: string; memberId: string }) {
  const { t } = useLingui();
  const p = usePalette();
  const offers: Offer[] = [
    {
      key: "ask",
      icon: "chat",
      title: t`Ask what would help`,
      words: t`Is there anything that would make this week easier for you? Big or small, just tell me.`,
    },
    {
      key: "time",
      icon: "call",
      title: t`Time together`,
      words: t`Would you like a call or some company this week? When would suit you?`,
    },
    {
      key: "practical",
      icon: "heart",
      title: t`A little practical help`,
      words: t`Could I help with a meal, an errand or getting somewhere this week? Tell me what would make things easier.`,
    },
  ];
  const offer = (suggestion: string) =>
    router.push({ pathname: "/conversation", params: { recipient: memberId, suggestion } });
  return (
    <View style={{ gap: space.m }}>
      <View style={{ gap: space.xs }}>
        <SectionTitle title={t`What would help this week?`} />
        <Words variant="body" tone="ink2">
          <Trans>Pick one to send {name}. You can change the words first.</Trans>
        </Words>
      </View>
      {/* The shadow sits outside the clipped rows, since iOS drops a shadow on a clipped view. */}
      <View style={[{ backgroundColor: p.surface, borderRadius: radius.panel }, softShadow]}>
        <View
          style={{
            borderWidth: 1,
            borderColor: p.rule,
            borderRadius: radius.panel,
            overflow: "hidden",
          }}
        >
          {offers.map((item, index) => (
            <OfferRow
              key={item.key}
              offer={item}
              first={index === 0}
              onPress={() => offer(item.words)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
