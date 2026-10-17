import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { apiConfigured } from "../../api/client.ts";
import { accountsConfigured } from "../../auth/clerk.tsx";
import { chatFixture, toChat } from "../../data/chat.ts";
import { demoDataAllowed } from "../../data/live-state.ts";
import type { TodayLight } from "../../data/today.ts";
import { useExchanges } from "../../data/useExchanges.ts";
import { useToday } from "../../data/useToday.ts";
import { usePalette } from "../../theme/theme.tsx";
import { radius, space, type } from "../../theme/tokens.ts";
import { BrandIcon } from "../brand/icon.tsx";

/**
 * The way into the chat from Today, as a messenger lists a conversation: her name, the last thing
 * said and when, so it is plain there is a conversation to go back to.
 */
export function ChatLink({ light }: { light: TodayLight }) {
  const palette = usePalette();
  const { t } = useLingui();
  const day = useToday();
  const history = useExchanges();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const name = light.displayName;
  const messages = demo
    ? chatFixture(name)
    : toChat(
        history.summaries,
        light.memberId,
        day.memberId === undefined ? {} : { id: day.memberId },
        light.timeZone,
      );
  const last = messages.at(-1);
  const who = last === undefined ? "" : last.side === "me" ? t`You` : last.from;
  const said = last?.text ?? "";
  const preview =
    last === undefined
      ? light.invited === true
        ? t`Write something for when ${name} says yes.`
        : t`Say something now. It reaches ${name}'s chat right away.`
      : t`${who}: ${said}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t`Talk with ${name}`}
      accessibilityHint={preview}
      onPress={() =>
        router.push({ pathname: "/conversation", params: { recipient: light.memberId } })
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        padding: space.l,
        borderRadius: radius.card + 6,
        borderWidth: 1,
        borderColor: palette.rule,
        backgroundColor: pressed ? palette.surface2 : palette.surface,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.actionSoft,
        }}
      >
        <BrandIcon name="exchanges" color={palette.action} size={22} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.s }}>
          <Text style={[type.heading, { color: palette.ink, flex: 1 }]}>
            {t`Talk with ${name}`}
          </Text>
          {last === undefined ? null : (
            <Text style={[type.caption, { color: palette.ink3 }]}>{last.time}</Text>
          )}
        </View>
        <Text numberOfLines={2} style={[type.caption, { color: palette.ink2 }]}>
          {preview}
        </Text>
      </View>
      <BrandIcon name="chevron" color={palette.action} size={20} />
    </Pressable>
  );
}
