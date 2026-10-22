import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { PUBLIC_ELIGIBILITY_TERMS, PUBLIC_ELIGIBILITY_TEXT } from "@vela/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import {
  type EligibilityAnswer,
  type EligibilityReviewController,
  eligibilityReviewDecision,
} from "../data/public-eligibility.ts";
import { useAppLocale } from "../i18n/provider.tsx";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { Card, Chip, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/** Draft messages use Lingui; no live notice or consent text is replaced. */
export const eligibilityReviewCopy = {
  title: msg`Before joining Vela`,
  intro: msg`A few questions about you. Every adult answers separately.`,
  age: msg`Are you 18 or older?`,
  adult: msg`18 or older`,
  under: msg`Under 18`,
  private: msg`Prefer not to say`,
  residence: msg`Do you usually live in Taiwan?`,
  taiwan: msg`Taiwan`,
  elsewhere: msg`Somewhere else`,
  details: msg`Read the draft notice and terms`,
  hide: msg`Hide draft documents`,
  notice: msg`I have read the draft eligibility notice.`,
  terms: msg`I have read the draft service terms.`,
  save: msg`Record test declaration`,
  saving: msg`Recording…`,
  retry: msg`Try recording again`,
  outside: msg`These answers are outside the proposed Taiwan launch scope. Nothing is submitted. This is not a legal eligibility decision.`,
  incomplete: msg`Choose your own answers and read both draft documents to continue.`,
  failure: msg`The test declaration was not recorded. Your answers are still here. Try again.`,
  done: msg`Test declaration recorded`,
  doneBody: msg`This is a self-declaration, not verified identity or legal clearance. No family access, messages, AI processing or parent consent has been enabled.`,
  clear: msg`Clear my test declaration`,
  clearing: msg`Clearing…`,
  clearFailure: msg`The test declaration could not be cleared. It is still recorded. Try again.`,
  help: msg`Privacy rights and help remain available even if you cannot join.`,
  noticeHeading: msg`Eligibility notice — review draft`,
  termsHeading: msg`Service terms — review draft`,
} as const;

function Check({
  label,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      aria-checked={checked}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: space.m,
        minHeight: 48,
        flexDirection: "row",
        gap: space.m,
        alignItems: "center",
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderWidth: 1,
          borderColor: palette.control,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Words>{checked ? "✓" : ""}</Words>
      </View>
      <View style={{ flex: 1 }}>
        <Words>{label}</Words>
      </View>
    </Pressable>
  );
}
export function EligibilityReview({ controller }: { controller: EligibilityReviewController }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const [details, setDetails] = useState(false);
  const { i18n } = useLingui();
  const { locale, choose } = useAppLocale();
  useEffect(() => {
    if (locale === "en" || locale === "zh-TW") controller.change({ language: locale });
  }, [locale, controller]);
  const copy = Object.fromEntries(
    Object.entries(eligibilityReviewCopy).map(([key, message]) => [key, i18n._(message)]),
  ) as Record<keyof typeof eligibilityReviewCopy, string>;
  const busy = state.status === "saving" || state.status === "clearing";
  const saved = state.status === "saved" || state.status === "clearing";
  const decision = eligibilityReviewDecision(state);
  const options = (field: "adult" | "taiwan", labels: readonly string[]) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {(["yes", "no", "unsure"] as const).map((value, index) => (
        <Chip
          key={value}
          label={labels[index] ?? ""}
          selected={state[field] === value}
          disabled={busy || saved}
          onPress={() => controller.change({ [field]: value as EligibilityAnswer })}
        />
      ))}
    </View>
  );
  return (
    <View style={{ gap: space.l }}>
      <View style={{ flexDirection: "row", gap: space.s }}>
        <Chip
          label="English"
          selected={state.language === "en"}
          disabled={busy || saved}
          onPress={() => {
            controller.change({ language: "en" });
            choose("en");
            setDetails(false);
          }}
        />
        <Chip
          label="繁體中文"
          selected={state.language === "zh-TW"}
          disabled={busy || saved}
          onPress={() => {
            controller.change({ language: "zh-TW" });
            choose("zh-TW");
            setDetails(false);
          }}
        />
      </View>
      <Words variant="title">{saved ? copy.done : copy.title}</Words>
      <Words tone="ink2">{saved ? copy.doneBody : copy.intro}</Words>
      {!saved ? (
        <>
          <Card>
            <Words variant="heading">{copy.age}</Words>
            {options("adult", [copy.adult, copy.under, copy.private])}
          </Card>
          <Card>
            <Words variant="heading">{copy.residence}</Words>
            {options("taiwan", [copy.taiwan, copy.elsewhere, copy.private])}
          </Card>
          <SecondaryButton
            label={details ? copy.hide : copy.details}
            disabled={busy}
            onPress={() => setDetails(!details)}
          />
          {details ? (
            <Card>
              <Words variant="heading">{copy.noticeHeading}</Words>
              <Words selectable>{PUBLIC_ELIGIBILITY_TEXT[state.language]}</Words>
              <Words variant="heading">{copy.termsHeading}</Words>
              <Words selectable>{PUBLIC_ELIGIBILITY_TERMS[state.language]}</Words>
            </Card>
          ) : null}
          <Check
            label={copy.notice}
            checked={state.noticeRead}
            disabled={busy || !details}
            onPress={() => controller.change({ noticeRead: !state.noticeRead })}
          />
          <Check
            label={copy.terms}
            checked={state.termsRead}
            disabled={busy || !details}
            onPress={() => controller.change({ termsRead: !state.termsRead })}
          />
          <View accessibilityLiveRegion="polite">
            <Words tone="ink2">
              {decision === "outside_scope"
                ? copy.outside
                : state.status === "failed"
                  ? copy.failure
                  : copy.incomplete}
            </Words>
          </View>
          <PrimaryButton
            label={
              state.status === "saving"
                ? copy.saving
                : state.status === "failed"
                  ? copy.retry
                  : copy.save
            }
            disabled={busy || decision !== "ready"}
            onPress={() => void controller.save()}
          />
        </>
      ) : (
        <>
          {state.clearFailed ? (
            <View accessibilityRole="alert">
              <Words tone="ink2">{copy.clearFailure}</Words>
            </View>
          ) : null}
          <SecondaryButton
            label={state.status === "clearing" ? copy.clearing : copy.clear}
            disabled={busy}
            onPress={() => void controller.clear()}
          />
        </>
      )}
      <Words variant="caption" tone="ink2">
        {copy.help}
      </Words>
    </View>
  );
}
