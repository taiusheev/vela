import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import type { Memory } from "../data/memories.ts";
import { space } from "../theme/tokens.ts";
import { FamilyScene } from "./brand/scene.tsx";
import { GuideStep } from "./first-days.tsx";
import { MemoryCard } from "./keepsake.tsx";
import { SoftCard } from "./today-hero.tsx";
import { Eyebrow, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/**
 * Memories before the first one (founder, 6 November 2026: "first time and we are very neutral …
 * after the first login we should assist along the way"). Instead of one grey line, the page says
 * how a memory gets here, shows what one looks like, and offers the one thing to do now. The book
 * cover, tabs and filters wait until there is something to sort (Refactoring UI: empty states are
 * first impressions; hide filters until content exists).
 */
export function FirstMemories({
  name,
  invited,
  canKeep,
  onAsk,
  onInvitation,
}: {
  name: string;
  /** She has not said yes yet: the next step is her invitation, not a question. */
  invited: boolean;
  /** The reader may keep memories (an organiser), so the heart is explained as theirs to tap. */
  canKeep: boolean;
  /** Absent while nobody may ask her yet. */
  onAsk: (() => void) | undefined;
  onInvitation: () => void;
}) {
  const { t } = useLingui();
  const example: Memory = {
    id: "first-memories-example",
    memberId: "example",
    memberName: name,
    askedBy: null,
    question: t`What did your mother cook when you were small?`,
    words: null,
    quote: t`My mother’s red-bean soup. The beans soaked overnight, and I got to stir.`,
    kind: "story",
    at: new Date().toISOString(),
    photo: null,
    voice: null,
    kept: false,
    keptBy: null,
    storyId: null,
    fadesAt: null,
    opens: false,
  };
  return (
    <View style={{ gap: space.xl }}>
      <View style={{ alignItems: "center", gap: space.l, paddingTop: space.s }}>
        <FamilyScene kind="book" width={168} />
        <View style={{ alignSelf: "stretch", gap: space.s }}>
          <Words variant="title" accessibilityRole="header">
            <Trans>{name}'s first memory is on its way</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            <Trans>
              The little things {name} tells you, a recipe, an old story, a photo, gather here so
              the family never loses them.
            </Trans>
          </Words>
        </View>
      </View>

      <SoftCard>
        <Words variant="bodyMedium">
          <Trans>How a memory gets here</Trans>
        </Words>
        <View style={{ gap: space.l }}>
          <GuideStep
            number={1}
            state={invited ? "now" : "done"}
            title={invited ? t`${name} says yes` : t`${name} said yes`}
            line={
              invited
                ? t`The invitation is waiting in ${name}'s chat. One tap, and their mornings begin.`
                : t`${name} needs no app, only their usual chat.`
            }
          />
          <GuideStep
            number={2}
            state={invited ? "later" : "now"}
            title={t`You ask one small thing`}
            line={t`Vela brings it to ${name} in the morning, signed with your name. Ask nothing, and Vela sends a gentle hello.`}
          />
          <GuideStep
            number={3}
            state="later"
            title={t`${name} answers, and it lands here`}
            line={
              canKeep
                ? t`Tap the heart on the ones you love to keep them for good.`
                : t`The family can keep the ones they love for good.`
            }
          />
        </View>
        <View style={{ alignSelf: "flex-start" }}>
          {invited ? (
            <SecondaryButton label={t`See the invitation`} onPress={onInvitation} />
          ) : onAsk !== undefined ? (
            <PrimaryButton icon="ask" label={t`Ask ${name} something`} onPress={onAsk} />
          ) : null}
        </View>
      </SoftCard>

      <View style={{ gap: space.m }}>
        <Eyebrow>
          <Trans>What a memory looks like</Trans>
        </Eyebrow>
        <View accessibilityLabel={t`An example memory`} pointerEvents="none">
          <MemoryCard memory={example} familyId={undefined} showName={false} keepState="open" />
        </View>
        <Words variant="caption" tone="ink3">
          <Trans>An example. {name}'s own words will appear here instead.</Trans>
        </Words>
      </View>
    </View>
  );
}
