import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getLocales } from "expo-localization";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured, startTrial, trialRefusal } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { noticeUrl } from "../src/api/support.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { Light } from "../src/components/light.tsx";
import { Text } from "../src/components/scaled-text.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import { Card, PrimaryButton, SecondaryButton, Words } from "../src/components/ui.tsx";
import { dayMonth } from "../src/data/format.ts";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { money, pricesFor, yearPerMonth, yearSaving } from "../src/data/plans.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { useFamily } from "../src/data/useFamily.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { linkHitSlop, radius, space, type } from "../src/theme/tokens.ts";

/**
 * A13 · Vela Light (spec §14.1, §16): shown once, after her first answer, and again only when
 * opened from You. The thirty days need no card. The screen says what happens on day 30 and what
 * each plan will cost in the reader's currency (NT$ in Taiwan, plan/pricing-taiwan.md), with the
 * terms and privacy notice under it, as a store's subscription screen must.
 */
export default function VelaLightScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const queries = useQueryClient();
  const { t } = useLingui();
  const caps = useCapabilities();
  const trialKey = useIdempotencyKey("trial");
  const { member } = useLocalSearchParams<{ member?: string }>();
  const { familyId } = useToday();
  const { family, live } = useFamily(familyId, familyId !== undefined);
  const her = family.keptLight.find((row) => row.memberId === member) ?? family.keptLight[0];
  const name = her?.name ?? t`Mom`;
  const [exampleStarted, setExampleStarted] = useState(false);
  const prices = pricesFor(getLocales()[0]?.regionCode);
  const yearly = money(prices.year, prices.currency);
  const monthly = money(prices.month, prices.currency);
  const yearlyMonth = money(yearPerMonth(prices), prices.currency);
  const saving = yearSaving(prices);

  const start = useMutation({
    mutationFn: async () =>
      startTrial(
        family.familyId,
        her?.memberId ?? "",
        trialKey({ member: her?.memberId }),
        await account.token(),
      ),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["family"] });
    },
  });

  // The day the thirty days end, once they run. In the example there is nothing to start, so the
  // offer is always the one shown.
  const date = live
    ? start.data?.trial_ends_at != null
      ? dayMonth(start.data.trial_ends_at)
      : her?.plan === "trial"
        ? her.trialEnds
        : undefined
    : exampleStarted
      ? dayMonth(new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString())
      : undefined;
  const on = date !== undefined || (live && her?.plan === "active");
  const ended = live && her?.plan === "ended";
  const refusal = trialRefusal(start.error);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (
    !demoDataAllowed(apiConfigured(), accountsConfigured()) &&
    (caps.capabilities === undefined || caps.pilot || !live)
  ) {
    return (
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.margin,
          gap: space.l,
        }}
      >
        <Words variant="title">
          <Trans>Vela pilot</Trans>
        </Words>
        <Words variant="body" tone="ink2">
          {caps.pilot
            ? t`The pilot is free. No payment or card is required. Your family’s asks, replies, quiet notices and weekly read continue throughout the pilot.`
            : t`Loading your family’s plan…`}
        </Words>
        {caps.isError ? (
          <SecondaryButton label={t`Try again`} onPress={() => void caps.refetch()} />
        ) : null}
        <PrimaryButton label={t`Go to Today`} onPress={close} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xxl,
        paddingHorizontal: space.margin,
        gap: space.l,
        alignItems: "stretch",
      }}
    >
      <Stack.Screen options={{ presentation: "modal" }} />
      <View style={{ alignItems: "center", gap: space.l }}>
        <Light state="lit" height={72} />
        <Words variant="title">
          <Trans>{name}'s light is on</Trans>
        </Words>
      </View>

      {on ? (
        <>
          <Words variant="body" tone="ink2">
            {date === undefined
              ? t`Vela Light is on for ${name}.`
              : t`Vela Light is on for ${name} until ${date}. Nothing is charged, and no card was asked for.`}
          </Words>
          <PrimaryButton label={t`Go to Today`} onPress={close} />
        </>
      ) : ended ? (
        <>
          <Words variant="body" tone="ink2">
            <Trans>
              {name}'s thirty days have ended. The daily ask and the exchanges carry on as before.
            </Trans>
          </Words>
          <PrimaryButton label={t`Go to Today`} onPress={close} />
        </>
      ) : (
        <>
          <Words variant="body" tone="ink2">
            <Trans>
              {name} answered. For 30 days, Vela Light is on for free, so you can see what it does
              before you decide.
            </Trans>
          </Words>
          <SoftCard>
            <Words variant="heading">
              <Trans>How the 30 days work</Trans>
            </Words>
            <TimelineStep
              lit
              when={t`Today`}
              what={t`Vela Light starts for ${name}. No card is needed.`}
            />
            <TimelineStep
              when={t`Day 30`}
              what={t`You choose whether to keep it. Nothing is charged unless you choose a plan.`}
            />
          </SoftCard>
          <Words variant="heading">
            <Trans>After the 30 days</Trans>
          </Words>
          <View style={{ flexDirection: "row", gap: space.m }}>
            <PlanCard
              badge={t`Best value · save ${saving}%`}
              title={t`Yearly`}
              price={t`${yearly} a year`}
              detail={t`${yearlyMonth} a month`}
            />
            <PlanCard title={t`Monthly`} price={t`${monthly} a month`} detail={t`Stop any time`} />
          </View>
          <Words variant="caption" tone="ink3">
            <Trans>For one parent. Each extra parent adds half the price.</Trans>
          </Words>
          <Card>
            <Words variant="bodyMedium">
              <Trans>What Vela Light adds</Trans>
            </Words>
            <Words variant="body" tone="ink2">
              <Trans>
                A quiet notice when a morning goes unanswered · people nearby who can look in · away
                mode · the weekly read
              </Trans>
            </Words>
          </Card>
          <Card style={{ backgroundColor: palette.lightSoft, borderColor: palette.lightSoft }}>
            <Words variant="bodyMedium">
              <Trans>Always free</Trans>
            </Words>
            <Words variant="caption" tone="ink2">
              <Trans>
                The daily ask, the exchanges, turns, translation, story day, everyone in the family.
              </Trans>
            </Words>
          </Card>
          {refusal === null ? null : (
            <Words variant="caption" tone="ink2">
              {refusal === "not_answered_yet"
                ? t`The 30 days start after ${name}'s first answer.`
                : t`${name}'s light is not on.`}
            </Words>
          )}
          {start.isError && refusal === null ? (
            <Words variant="caption" tone="ink2">
              <Trans>That did not go through. Try again in a moment.</Trans>
            </Words>
          ) : null}
          <PrimaryButton
            label={start.isPending ? t`Starting…` : t`Start 30 free days`}
            onPress={() => {
              if (!live) setExampleStarted(true);
              else if (her !== undefined && !start.isPending) start.mutate();
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={{ alignItems: "center", paddingVertical: space.m }}
          >
            <Words variant="button" tone="action">
              <Trans>Not now</Trans>
            </Words>
          </Pressable>
          <LegalFooter />
        </>
      )}
    </ScrollView>
  );
}

/** One step of the free month: a small window, lit for today, and what happens then. */
function TimelineStep({ when, what, lit = false }: { when: string; what: string; lit?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: space.m, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}>
        <Light state={lit ? "lit" : "resting"} height={22} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Words variant="bodyMedium">{when}</Words>
        <Words variant="caption" tone="ink2">
          {what}
        </Words>
      </View>
    </View>
  );
}

/**
 * A plan, shown for reading, not chosen here: the choice comes on day 30. The yearly plan carries
 * the "best value" mark and the stronger edge, as stores' own subscription screens do.
 */
function PlanCard({
  title,
  price,
  detail,
  badge,
}: {
  title: string;
  price: string;
  detail: string;
  /** The yearly plan's mark; the card that has one gets the stronger edge. */
  badge?: string;
}) {
  const palette = usePalette();
  const best = badge !== undefined;
  return (
    <View
      style={{
        flex: 1,
        gap: space.xs,
        padding: space.l,
        borderRadius: radius.panel,
        borderWidth: best ? 2 : 1,
        borderColor: best ? palette.action : palette.rule,
        backgroundColor: palette.surface,
      }}
    >
      {best ? (
        <Text style={[type.label, { color: palette.lightInk }]}>{badge}</Text>
      ) : (
        <Text style={[type.label, { color: palette.ink3 }]}> </Text>
      )}
      {/* The price is what a reader compares, so it is the largest line; the plan's name labels it. */}
      <Words variant="caption" tone="ink2">
        {title}
      </Words>
      <Text
        style={[
          type.heading,
          {
            fontSize: type.preview.fontSize,
            lineHeight: type.preview.lineHeight,
            color: palette.ink,
            fontVariant: ["tabular-nums"],
          },
        ]}
      >
        {price}
      </Text>
      <Words variant="caption" tone="ink2">
        {detail}
      </Words>
    </View>
  );
}

/** Terms and privacy, one tap away, under any price the app shows. */
function LegalFooter() {
  const { t } = useLingui();
  const link = (label: string, path: string) => (
    <Pressable
      accessibilityRole="link"
      hitSlop={linkHitSlop}
      onPress={() => void Linking.openURL(noticeUrl(path)).catch(() => undefined)}
    >
      <Words variant="caption" tone="ink2">
        {label}
      </Words>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: space.l }}>
      {link(t`Service terms`, "/terms")}
      {link(t`Privacy notice`, "/privacy")}
    </View>
  );
}
