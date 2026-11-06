import { Trans, useLingui } from "@lingui/react/macro";
import { type Href, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { readFlag, writeFlag } from "../storage/flags.ts";
import { usePalette } from "../theme/theme.tsx";
import { space, type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { Text } from "./scaled-text.tsx";
import { SoftCard } from "./today-hero.tsx";
import { TextButton, Words } from "./ui.tsx";

const FLAG = "find-your-way-seen";

/**
 * A one-time map of the app for a new family, under the first-days guide on Today (founder,
 * 6 November 2026: "after the first login we should assist along the way"). Each tab in one line,
 * in the words of what it is for, and a tap goes there. It goes for good on "Got it", on this
 * device; a device that cannot remember only shows it again.
 */
export function FindYourWay({ name }: { name: string }) {
  const { t } = useLingui();
  const [seen, setSeen] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void readFlag(FLAG).then((value) => {
      if (alive) setSeen(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (seen !== false) return null;
  const places: { icon: BrandIconName; title: string; line: string; href: Href }[] = [
    {
      icon: "book",
      title: t({ context: "tab", message: "Memories" }),
      line: t`The little things ${name} tells you, kept for the family.`,
      href: "/exchanges",
    },
    {
      icon: "questions",
      title: t`Questions`,
      line: t`Plan what to ask ${name} in the coming mornings.`,
      href: "/questions",
    },
    {
      icon: "calendar",
      title: t({ context: "tab", message: "Week" }),
      line: t`A short letter about ${name}'s week, every Sunday.`,
      href: "/sunday",
    },
    {
      icon: "you",
      title: t({ context: "tab", message: "You" }),
      line: t`Your family, notifications and privacy.`,
      href: "/you",
    },
  ];
  return (
    <SoftCard tone="paper">
      <View style={{ gap: space.xs }}>
        <Words variant="bodyMedium" accessibilityRole="header">
          <Trans>Find your way around</Trans>
        </Words>
        <Words variant="caption" tone="ink2">
          <Trans>Today is home: {name}'s window and answers. The rest, in one line each:</Trans>
        </Words>
      </View>
      <View>
        {places.map((place) => (
          <Place key={place.icon} {...place} />
        ))}
      </View>
      <View style={{ alignSelf: "flex-end" }}>
        <TextButton
          label={t`Got it`}
          onPress={() => {
            setSeen(true);
            void writeFlag(FLAG);
          }}
        />
      </View>
    </SoftCard>
  );
}

function Place({
  icon,
  title,
  line,
  href,
}: {
  icon: BrandIconName;
  title: string;
  line: string;
  href: Href;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${line}`}
      onPress={() => router.navigate(href)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        minHeight: 56,
        paddingVertical: space.s,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <BrandIcon name={icon} color={palette.action} size={22} strokeWidth={2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.button, { color: palette.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: palette.ink2 }]}>{line}</Text>
      </View>
      <BrandIcon name="chevron" color={palette.ink3} size={16} strokeWidth={2} />
    </Pressable>
  );
}
