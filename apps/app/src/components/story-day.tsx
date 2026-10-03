import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { apiConfigured, askConflict, composeAsk } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { dayName } from "../data/format.ts";
import { nextPrompt, nextSunday } from "../data/story.ts";
import { useBook } from "../data/useBook.ts";
import { useToday } from "../data/useToday.ts";
import { space } from "../theme/tokens.ts";
import { Card, Eyebrow, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/**
 * Story day (spec §10, A10) on the Sunday tab: a story question from Vela's bank, never one already
 * kept in the book, which a member of the family chooses for her coming Sunday — "Another question"
 * offers the next — and a way into the family book. Her answer is kept in the book unless she says
 * not to. The question is the family's choice, never Vela's own (spec: Vela authors nothing but the
 * fallback hello).
 */
export function StoryDay() {
  const { t, i18n } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const { today, familyId } = useToday();
  const book = useBook(familyId);
  const [skip, setSkip] = useState(0);
  const [sent, setSent] = useState(false);
  const keyFor = useIdempotencyKey("story");
  const her = today.lights[0];
  const lang = i18n.locale === "zh-TW" ? "zh-TW" : "en";
  const asked = new Set(book.entries.flatMap((entry) => entry.question?.trim() ?? []));
  const prompt = nextPrompt(asked, skip, lang);
  const sunday = nextSunday(new Date());
  const day = dayName(sunday);
  const name = her?.displayName ?? t`Mom`;

  const compose = useMutation({
    mutationFn: async (text: string) => {
      const ask = {
        recipient_id: her?.memberId ?? "",
        type: "story" as const,
        text,
        when: "date" as const,
        date: sunday,
      };
      return composeAsk(familyId ?? "", keyFor(ask), ask, await account.token());
    },
    onSuccess: async () => {
      setSent(true);
      await queries.invalidateQueries({ queryKey: ["today"] });
    },
  });
  const taken = compose.isError ? askConflict(compose.error) : null;
  const holder = taken?.taken_by;

  return (
    <Card>
      <Eyebrow>
        <Trans>Story day · {day}</Trans>
      </Eyebrow>
      {sent ? (
        <Words variant="body" tone="ink2">
          <Trans>
            On Sunday {name} is asked for this story. What she tells goes into the family book.
          </Trans>
        </Words>
      ) : prompt === undefined ? null : (
        <>
          <Words variant="voice">{prompt.text[lang]}</Words>
          <Words variant="caption" tone="ink3">
            <Trans>Her answer is kept in the family book, unless she says not to.</Trans>
          </Words>
          {taken === null ? null : (
            <Words variant="body" tone="ink2">
              <Trans>{holder} already has that Sunday.</Trans>
            </Words>
          )}
          {compose.isError && taken === null ? (
            <Words variant="body" tone="ink2">
              <Trans>That could not be sent just now. Try again in a moment.</Trans>
            </Words>
          ) : null}
          <View style={{ gap: space.s }}>
            <PrimaryButton
              label={compose.isPending ? t`Sending…` : t`Ask it on Sunday`}
              disabled={compose.isPending || !apiConfigured() || her === undefined}
              onPress={() => compose.mutate(prompt.text[lang])}
            />
            <SecondaryButton label={t`Another question`} onPress={() => setSkip((n) => n + 1)} />
          </View>
        </>
      )}
      <SecondaryButton label={t`Read the family book`} onPress={() => router.push("/book")} />
    </Card>
  );
}
