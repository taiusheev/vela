import { z } from "zod";
import { Lang } from "./domain.ts";

const Note = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((text) => text.isWellFormed() && !text.includes("\u0000"));

/** Explicit, temporary choices for ONE reviewed draft. Never inferred relationship attributes. */
export const QuestionPersonalization = z.strictObject({
  intent: Note(120),
  connection: z.enum(["everyday", "practical", "reconnecting", "unsure", "quiet"]),
  talking_rhythm: z.enum(["often", "sometimes", "rarely", "unsure"]),
  avoid_topics: z.array(Note(40).min(1)).max(5),
  never_say: z.array(Note(60).min(1)).max(3),
});
export type QuestionPersonalization = z.infer<typeof QuestionPersonalization>;

export const QUESTION_PROFILE_NOTICE_VERSION = "question-profile.1";
export const QUESTION_PROFILE_RETENTION_DAYS = 30;
/** Explicit choices only. The intent of a particular question is deliberately never retained. */
export const QuestionProfileSettings = z.strictObject({
  language: z.enum(["en", "zh-TW"]),
  address_form: Note(40).min(1),
  context: QuestionPersonalization.omit({ intent: true }),
  writing_examples: z.array(Note(180).min(1)).max(2),
});
export type QuestionProfileSettings = z.infer<typeof QuestionProfileSettings>;

export const SaveQuestionProfile = z.strictObject({
  expected_revision: z.uuid().nullable(),
  notice_version: z.literal(QUESTION_PROFILE_NOTICE_VERSION),
  settings: QuestionProfileSettings,
});
export type SaveQuestionProfile = z.infer<typeof SaveQuestionProfile>;
export const ForgetQuestionProfile = z.strictObject({});
export const ApiQuestionProfile = z.strictObject({
  /** A cleared profile retains a short-lived, content-free revision to reject stale saves. */
  revision: z.uuid().nullable(),
  saving_available: z.boolean(),
  profile: z
    .strictObject({
      settings: QuestionProfileSettings,
      saved_at: z.iso.datetime(),
      expires_at: z.iso.datetime(),
      notice_version: z.literal(QUESTION_PROFILE_NOTICE_VERSION),
    })
    .nullable(),
});
export type ApiQuestionProfile = z.infer<typeof ApiQuestionProfile>;
export const ApiQuestionProfileSaved = z.strictObject({
  saved: z.literal(true),
  revision: z.uuid(),
  expires_at: z.iso.datetime(),
});
export type ApiQuestionProfileSaved = z.infer<typeof ApiQuestionProfileSaved>;
export const ApiQuestionProfileForgotten = z.strictObject({ forgotten: z.literal(true) });

export const DraftPersonalQuestion = z
  .strictObject({
    recipient_id: z.uuid(),
    language: Lang,
    address_form: Note(40).min(1),
    context: QuestionPersonalization,
    /** Only the caller's own selected messages to THIS parent; wording evidence, never facts. */
    writing_examples: z.array(Note(180).min(1)).max(2),
    /** A loaded saved setup's revision, including when locally edited for this request. */
    profile_revision: z.uuid().optional(),
  })
  .refine((input) => input.context.connection === "quiet" || input.context.intent.length > 0, {
    path: ["context", "intent"],
    message: "Choose what you genuinely want to ask",
  });
export type DraftPersonalQuestion = z.infer<typeof DraftPersonalQuestion>;

export const ApiPersonalQuestionDraft = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("review"),
    text: z.string().min(1).max(200),
    language: Lang,
    profile_revision: z.uuid().optional(),
  }),
  z.strictObject({
    state: z.literal("not_drafted"),
    reason: z.enum(["quiet", "boundary", "unavailable", "needs_rewording"]),
  }),
]);
export type ApiPersonalQuestionDraft = z.infer<typeof ApiPersonalQuestionDraft>;
