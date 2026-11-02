import type {
  ApiQuestionProfile,
  DraftPersonalQuestion,
  QuestionProfileSettings,
} from "@vela/contracts";

export function profileSettingsOf(input: DraftPersonalQuestion): QuestionProfileSettings {
  return {
    language: input.language === "zh-TW" ? "zh-TW" : "en",
    address_form: input.address_form,
    writing_examples: [...input.writing_examples],
    context: {
      connection: input.context.connection,
      talking_rhythm: input.context.talking_rhythm,
      avoid_topics: [...input.context.avoid_topics],
      never_say: [...input.context.never_say],
    },
  };
}

/** Only an active saved setup can seed drafting. Reads never extend its lifetime. */
export function currentQuestionProfile(view: ApiQuestionProfile | undefined, now = Date.now()) {
  return view?.profile && Date.parse(view.profile.expires_at) > now ? view.profile : null;
}

export function profileLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}
