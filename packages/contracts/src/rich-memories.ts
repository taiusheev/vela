import { z } from "zod";

export const FAMILY_MEMORY_KINDS = [
  "preference",
  "story",
  "humour",
  "person",
  "moment",
  "follow_up",
] as const;
export const FamilyMemoryKind = z.enum(FAMILY_MEMORY_KINDS);
export type FamilyMemoryKind = z.infer<typeof FamilyMemoryKind>;

/** Candidate, not a permanently kept memory. All words remain tied to the live source. */
export const ApiMemoryCandidate = z.strictObject({
  id: z.uuid(),
  member_id: z.uuid(),
  source_answer_id: z.uuid(),
  kind: FamilyMemoryKind,
  quote: z.string().min(1).max(2000),
  lang: z.string().min(1).max(35),
  occurred_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export type ApiMemoryCandidate = z.infer<typeof ApiMemoryCandidate>;

export const MemoryCandidateSelection = z
  .strictObject({
    source_answer_id: z.uuid(),
    kind: FamilyMemoryKind,
    start: z.number().int().min(0),
    end: z.number().int().positive(),
  })
  .refine((value) => value.end > value.start && value.end - value.start <= 2000);
export type MemoryCandidateSelection = z.infer<typeof MemoryCandidateSelection>;

export const MemoryCandidatePage = z.strictObject({
  items: z.array(ApiMemoryCandidate).max(50),
  /** Last scanned ID, including ineligible rows, so filtering cannot cause a pagination loop. */
  next_cursor: z.uuid().nullable(),
});
export type MemoryCandidatePage = z.infer<typeof MemoryCandidatePage>;

/** Proposed confirmation text; not an activated notice or consent-acceptance route. */
export const MEMORY_KEEP_VERSION = "memory.keep@2";
export const MEMORY_KEEP_EXPLANATION_EN =
  "Only these words will stay in your private memories after the conversation’s 30 days. Keeping does not share them with family. You can remove this memory later.";
export const MemoryKeepChoice = z.strictObject({
  candidate_id: z.uuid(),
  confirmation_version: z.literal(MEMORY_KEEP_VERSION),
  confirmation_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const ApiKeptMemory = z.strictObject({
  id: z.uuid(),
  member_id: z.uuid(),
  source_answer_id: z.uuid(),
  kind: FamilyMemoryKind,
  quote: z.string().min(1).max(2000),
  lang: z.string().min(1).max(35),
  occurred_at: z.iso.datetime(),
  kept_at: z.iso.datetime(),
  source_available: z.boolean(),
});
export type ApiKeptMemory = z.infer<typeof ApiKeptMemory>;
export const KeptMemoryPage = z.strictObject({
  items: z.array(ApiKeptMemory).max(50),
  next_cursor: z.uuid().nullable(),
});
export type KeptMemoryPage = z.infer<typeof KeptMemoryPage>;

/** A named recipient gets the chosen quote, never a grant to its original conversation. */
export const ApiSharedKeptMemory = ApiKeptMemory.omit({
  source_answer_id: true,
  source_available: true,
});
export type ApiSharedKeptMemory = z.infer<typeof ApiSharedKeptMemory>;
export const SharedKeptMemoryPage = z.strictObject({
  items: z.array(ApiSharedKeptMemory).max(50),
  next_cursor: z.uuid().nullable(),
});
export type SharedKeptMemoryPage = z.infer<typeof SharedKeptMemoryPage>;

/** Proposed named-sharing confirmation, not an activated consent route or access grant. */
export const MEMORY_SHARE_VERSION = "memory.share@1";
export const MEMORY_SHARE_EXPLANATION_EN =
  "Share only these words with the people named below. People who join later will not see this memory. You can stop sharing later, but someone may already have read or copied it.";
export const MemoryShareRecipient = z.strictObject({
  member_id: z.uuid(),
  display_name: z.string().trim().min(1).max(120),
});
export const MemorySharePreview = z.strictObject({
  presentation_id: z.uuid(),
  memory_id: z.uuid(),
  quote: z.string().min(1).max(2000),
  lang: z.string().min(1).max(35),
  recipients: z.array(MemoryShareRecipient).min(1).max(50),
  confirmation_version: z.literal(MEMORY_SHARE_VERSION),
  explanation: z.literal(MEMORY_SHARE_EXPLANATION_EN),
  presentation_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  expires_at: z.iso.datetime(),
});
export type MemorySharePreview = z.infer<typeof MemorySharePreview>;
export const MemoryShareChoice = z.strictObject({
  presentation_id: z.uuid(),
  presentation_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  confirmation_version: z.literal(MEMORY_SHARE_VERSION),
});
export type MemoryShareChoice = z.infer<typeof MemoryShareChoice>;

/** Owner view supplied by a future authenticated transport. It must include the complete current
 * audience; never treat an incomplete recipient page as the complete set to replace. */
export const MemorySharingView = z.strictObject({
  memory_id: z.uuid(),
  author_id: z.uuid(),
  quote: z.string().min(1).max(2000),
  revision: z.uuid(),
  audience_complete: z.literal(true),
  recipients: z.array(MemoryShareRecipient.extend({ shared: z.boolean() })).max(50),
});
export type MemorySharingView = z.infer<typeof MemorySharingView>;
