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

export const DraftPersonalQuestion = z
  .strictObject({
    recipient_id: z.uuid(),
    language: Lang,
    address_form: Note(40).min(1),
    context: QuestionPersonalization,
    /** Only the caller's own selected messages to THIS parent; wording evidence, never facts. */
    writing_examples: z.array(Note(180).min(1)).max(2),
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
  }),
  z.strictObject({
    state: z.literal("not_drafted"),
    reason: z.enum(["quiet", "boundary", "unavailable", "needs_rewording"]),
  }),
]);
export type ApiPersonalQuestionDraft = z.infer<typeof ApiPersonalQuestionDraft>;
