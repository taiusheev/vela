import { z } from "zod";

/** Proposed private-test wording. Runtime activation requires founder wording approval. */
export const SUPPORT_PERMISSION_VERSION = "weekly.support.review@1";
export const SUPPORT_NOTICE_VERSION = "weekly-support-private-test@1";
export const SUPPORT_PERMISSION_TEXT =
  "Vela can help the people named below prepare a weekly report from ordinary messages you share after you agree. The report shows your exact words, interests and optional offers of company or practical help. A family organiser reviews each offer. Health and other sensitive messages are excluded. This is not a health assessment. No messages are sent automatically and no words go to an AI for this report. Only you and the named people can read it. New family members do not get access. Report references expire within 30 days of the original message; this does not keep messages longer. You can decline or stop at any time without losing chat. Stopping hides the report and clears its references. You can read the report yourself.";
export const SUPPORT_PERMISSION_SHA256 =
  "6a3779941bec1ccac0d94155d5fd1c11e3bbd03f9e9d12f4d7b2acbd96b12387";
export const SUPPORT_TEMPLATE_VERSION = "weekly.support.templates@1";
export const SupportKind = z.enum(["shared_interest", "company", "practical_help"]);
export type SupportKind = z.infer<typeof SupportKind>;
export const SupportNoInput = z.object({}).strict();
export const SupportPrepared = z.object({ id: z.uuid() });
export const SupportPermissionChoice = z
  .object({ presentation_id: z.uuid(), answer: z.enum(["yes", "no"]) })
  .strict();
export const SupportReviewChoice = z
  .object({
    source_id: z.uuid(),
    source_digest: z.string().regex(/^[a-f0-9]{64}$/),
    kind: SupportKind,
    ordinary_confirmed: z.literal(true),
    valid_until: z.iso.datetime(),
  })
  .strict();
export const SupportRemoveChoice = z.object({ source_id: z.uuid() }).strict();
export const SupportWriteResult = z.object({ saved: z.literal(true) });
export const SupportReader = z.object({ id: z.uuid(), name: z.string() });
export const SupportPresentation = z.object({
  id: z.uuid(),
  version: z.literal(SUPPORT_PERMISSION_VERSION),
  notice_version: z.literal(SUPPORT_NOTICE_VERSION),
  text: z.literal(SUPPORT_PERMISSION_TEXT),
  readers: z.array(SupportReader).max(12),
  expires_at: z.iso.datetime(),
});
const Source = z.object({
  id: z.uuid(),
  exchange_id: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  quote: z.string().max(1000),
  occurred_at: z.iso.datetime(),
  occurred_on: z.string(),
});
export const SupportReport = z.object({
  member_id: z.uuid(),
  name: z.string(),
  owner: z.boolean(),
  can_review: z.boolean(),
  permission: z.enum(["none", "yes", "no", "withdrawn", "not_shared"]),
  readers: z.array(SupportReader).max(12),
  week_start: z.string(),
  week_end: z.string(),
  suggestions: z
    .array(
      z.object({
        source: Source,
        kind: SupportKind,
        reviewed_at: z.iso.datetime(),
        reviewed_by: z.string(),
        template_version: z.literal(SUPPORT_TEMPLATE_VERSION),
        expires_at: z.iso.datetime(),
      }),
    )
    .max(3),
  sources: z.array(Source).max(50),
});
export type SupportReport = z.infer<typeof SupportReport>;
export type SupportPresentation = z.infer<typeof SupportPresentation>;
