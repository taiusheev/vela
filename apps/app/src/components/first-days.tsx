import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import { firstDaysSteps, type StepState } from "../data/first-days.ts";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Text } from "./scaled-text.tsx";
import { SoftCard } from "./today-hero.tsx";
import { PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/**
 * Her family's first days on Today (founder, 3 November 2026: "when there is nothing, make it super
 * easy and nice to be there and understand the workflow"). One card instead of several notes: the
 * three things that happen, in order, which of them is done, and the one thing to do now. It goes
 * once she has answered a first morning.
 */

export function FirstDaysGuide({
  name,
  invited,
  askedForTomorrow,
  answered,
  onAsk,
  onInvitation,
}: {
  name: string;
  invited: boolean;
  askedForTomorrow: boolean;
  answered: boolean;
  /** Absent while nobody may ask her yet. */
  onAsk: (() => void) | undefined;
  onInvitation: () => void;
}) {
  const { t } = useLingui();
  const steps = firstDaysSteps({ invited, askedForTomorrow, answered });
  return (
    <SoftCard>
      <Words variant="heading">
        <Trans>Your first days with {name}</Trans>
      </Words>
      <View style={{ gap: space.l }}>
        <Step
          number={1}
          state={steps.yes}
          title={steps.yes === "done" ? t`${name} said yes` : t`${name} says yes`}
          line={
            steps.yes === "done"
              ? t`Mornings are on. ${name} needs no app, only their usual chat.`
              : t`The invitation is waiting in ${name}'s chat. One tap, and their mornings begin.`
          }
        >
          {steps.yes === "now" ? (
            <SecondaryButton label={t`See the invitation`} onPress={onInvitation} />
          ) : null}
        </Step>
        <Step
          number={2}
          state={steps.ask}
          title={t`The first morning question`}
          line={
            steps.ask === "done"
              ? t`Ready for ${name}'s morning, signed with your name.`
              : t`Ask one thing in your own words for tomorrow morning. Ask nothing, and Vela sends a gentle hello.`
          }
        >
          {steps.ask === "now" && onAsk !== undefined ? (
            <PrimaryButton label={t`Write the first question`} onPress={onAsk} />
          ) : null}
        </Step>
        <Step
          number={3}
          state={steps.answer}
          title={t`${name} answers`}
          line={t`Their window lights up here. Reply, listen to their voice, or send a heart.`}
        />
      </View>
    </SoftCard>
  );
}

function Step({
  number,
  state,
  title,
  line,
  children,
}: {
  number: number;
  state: StepState;
  title: string;
  line: string;
  children?: React.ReactNode;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const later = state === "later";
  return (
    <View
      style={{ flexDirection: "row", gap: space.m }}
      accessible
      accessibilityLabel={
        state === "done"
          ? t`Done: ${title}`
          : state === "now"
            ? t`Now: ${title}`
            : t`Later: ${title}`
      }
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor:
            state === "done" ? palette.light : state === "now" ? palette.action : "transparent",
          borderWidth: later ? 1.5 : 0,
          borderColor: palette.rule,
        }}
      >
        {state === "done" ? (
          <BrandIcon name="check" size={16} color={palette.action} />
        ) : (
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: state === "now" ? palette.onAction : palette.ink3,
            }}
          >
            {number}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Words variant="bodyMedium" tone={later ? "ink3" : "ink"}>
          {title}
        </Words>
        <Words variant="caption" tone={later ? "ink3" : "ink2"}>
          {line}
        </Words>
        {children === undefined || children === null ? null : (
          <View style={{ marginTop: space.s, alignSelf: "flex-start" }}>{children}</View>
        )}
      </View>
    </View>
  );
}
