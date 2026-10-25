import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { StorePlan } from "../billing/plans.ts";
import { useBilling } from "../billing/useBilling.ts";
import { usePalette } from "../theme/theme.tsx";
import { linkHitSlop, radius, space, type } from "../theme/tokens.ts";
import { Text } from "./scaled-text.tsx";
import { PrimaryButton, Words } from "./ui.tsx";

/**
 * Keeping a parent's light on through the App Store: the two plans at Apple's own prices, the
 * yearly one chosen first, one button, the renewal said in words before anything is bought, and
 * Restore for a reader who paid on another phone (App Store Review 3.1.1 and 3.1.2). Renders
 * nothing where nothing can be bought, so the pilot and the web never see it.
 */
export function StoreChoice({ memberId, name }: { memberId: string | undefined; name: string }) {
  const { t } = useLingui();
  const billing = useBilling(memberId);
  const [chosen, setChosen] = useState<string | undefined>();
  if (!billing.available) return null;
  if (billing.paid) {
    return (
      <Words variant="body" tone="ink2">
        <Trans>Vela Light is paid for. {name}'s light stays on.</Trans>
      </Words>
    );
  }
  if (billing.loading) {
    return (
      <Words variant="caption" tone="ink2">
        <Trans>Asking the App Store for its prices…</Trans>
      </Words>
    );
  }
  if (billing.plans.length === 0) {
    return (
      <Words variant="caption" tone="ink2">
        <Trans>The App Store's plans could not be reached just now. Try again later.</Trans>
      </Words>
    );
  }
  const plan = billing.plans.find((item) => item.id === chosen) ?? billing.plans[0];
  if (plan === undefined) return null;
  const price = plan.price;
  return (
    <View style={{ gap: space.m }}>
      <Words variant="heading">
        <Trans>Keep {name}'s light on</Trans>
      </Words>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: space.m }}>
        {billing.plans.map((item) => (
          <PlanChoice
            key={item.id}
            plan={item}
            selected={item.id === plan.id}
            onPress={() => setChosen(item.id)}
          />
        ))}
      </View>
      <PrimaryButton
        label={billing.buying ? t`Opening the App Store…` : t`Continue · ${price}`}
        disabled={billing.buying || billing.restoring}
        onPress={() => billing.buy(plan.id)}
      />
      <Words variant="caption" tone="ink3">
        {plan.period === "year"
          ? t`${price} a year, renewing every year until you cancel. Cancel any time in your Apple account settings, at least a day before it renews.`
          : t`${price} a month, renewing every month until you cancel. Cancel any time in your Apple account settings, at least a day before it renews.`}
      </Words>
      {billing.failed ? (
        <Words variant="caption" tone="ink2">
          <Trans>That did not go through. Nothing was charged. Try again in a moment.</Trans>
        </Words>
      ) : null}
      {billing.nothingToRestore ? (
        <Words variant="caption" tone="ink2">
          <Trans>No earlier purchase was found for this Apple account.</Trans>
        </Words>
      ) : null}
      <Pressable
        accessibilityRole="button"
        hitSlop={linkHitSlop}
        disabled={billing.restoring || billing.buying}
        onPress={billing.restore}
        style={{ alignSelf: "center" }}
      >
        <Words variant="button" tone="action">
          {billing.restoring ? t`Restoring…` : t`Restore purchase`}
        </Words>
      </Pressable>
    </View>
  );
}

/** One plan, chosen with a tap; the chosen one carries the stronger edge. */
function PlanChoice({
  plan,
  selected,
  onPress,
}: {
  plan: StorePlan;
  selected: boolean;
  onPress(): void;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const price = plan.price;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        gap: space.xs,
        padding: space.l,
        borderRadius: radius.panel,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? palette.action : palette.rule,
        backgroundColor: palette.surface,
      }}
    >
      <Text
        style={[type.label, { color: plan.period === "year" ? palette.lightInk : palette.ink3 }]}
      >
        {plan.period === "year" ? t`Best value` : " "}
      </Text>
      <Words variant="bodyMedium">{plan.period === "year" ? t`Yearly` : t`Monthly`}</Words>
      <Text style={[type.heading, { color: palette.ink }]}>
        {plan.period === "year" ? t`${price} a year` : t`${price} a month`}
      </Text>
    </Pressable>
  );
}
