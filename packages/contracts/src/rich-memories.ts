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
/** SHA-256 of MEMORY_KEEP_EXPLANATION_EN, so the app can echo it without hashing (test pins it). */
export const MEMORY_KEEP_EXPLANATION_SHA256 =
  "2b8f0ea4f89e3f04e34213a712eca929932de83b14bea66af93c1123e8ab3923";
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

/** Optional HTTP boundary; not enabled by existing Worker configuration. */
export const MemoryShareRecipients = z.strictObject({
  recipient_ids: z
    .array(z.uuid().transform((id) => id.toLowerCase()))
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type MemoryShareRecipients = z.infer<typeof MemoryShareRecipients>;
export const MemorySharePrepared = z.strictObject({ id: z.uuid() });
export type MemorySharePrepared = z.infer<typeof MemorySharePrepared>;
export const MemoryShareSaved = z.strictObject({ shared: z.literal(true), id: z.uuid() });
export type MemoryShareSaved = z.infer<typeof MemoryShareSaved>;
export const MemoryShareStop = z.strictObject({});
export const MemoryShareStopped = z.strictObject({ stopped: z.literal(true) });
export type MemoryShareStopped = z.infer<typeof MemoryShareStopped>;

/** Proposed memory-suggestion question (consent.rich_memories@2). Not shown to anyone until the
 * notice naming this purpose is approved and the RICH_MEMORIES switch is turned on. */
export const MEMORY_PERMISSION_VERSION = "consent.rich_memories@2";
/** The notice version this question points to; it does not exist as a live notice yet. */
export const MEMORY_PERMISSION_NOTICE_VERSION = "privacy-notice.v7";
export const MEMORY_PERMISSION_TEXT_EN =
  "Would you like Vela to suggest memories from your answers? Vela can use AI to suggest little things worth remembering: things you enjoy, stories, jokes, people, moments and plans. Only new answers you send after agreeing are used. Health and other sensitive words are never used; if Vela is unsure, it leaves those words out. Only you can read these suggestions. They disappear with your answer, normally after 30 days, unless you choose to keep exact words. Keeping words does not share them; sharing is a separate choice that shows who will read them. This is optional: saying no does not change your ordinary chats, and saying yes does not start a trial or charge anyone. You can turn this off later and clear your memories.";
export const MemoryPermissionState = z.strictObject({
  /** none: never asked or answered; yes/no: latest answer; withdrawn: turned off and cleared. */
  state: z.enum(["none", "yes", "no", "withdrawn"]),
  /** True when the latest yes is for an older wording and the person must be asked again. */
  outdated: z.boolean(),
});
export type MemoryPermissionState = z.infer<typeof MemoryPermissionState>;
export const MemoryPermissionPrepare = z.strictObject({ lang: z.literal("en") });
export const MemoryPermissionPrepared = z.strictObject({ id: z.uuid() });
export type MemoryPermissionPrepared = z.infer<typeof MemoryPermissionPrepared>;
export const MemoryPermissionPreview = z.strictObject({
  presentation_id: z.uuid(),
  text_version: z.literal(MEMORY_PERMISSION_VERSION),
  notice_version: z.literal(MEMORY_PERMISSION_NOTICE_VERSION),
  lang: z.literal("en"),
  text: z.literal(MEMORY_PERMISSION_TEXT_EN),
  text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  expires_at: z.iso.datetime(),
});
export type MemoryPermissionPreview = z.infer<typeof MemoryPermissionPreview>;
export const MemoryPermissionChoice = z.strictObject({
  presentation_id: z.uuid(),
  answer: z.enum(["yes", "no"]),
  text_version: z.literal(MEMORY_PERMISSION_VERSION),
  text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type MemoryPermissionChoice = z.infer<typeof MemoryPermissionChoice>;
export const MemoryPermissionAnswered = z.strictObject({ answer: z.enum(["yes", "no"]) });
export type MemoryPermissionAnswered = z.infer<typeof MemoryPermissionAnswered>;

/** Optional author-only memory routes; not enabled by existing Worker configuration. */
export const MemoryNoInput = z.strictObject({});
export const MemoryDismissed = z.strictObject({ dismissed: z.literal(true) });
export const MemoryKept = z.strictObject({ kept: z.literal(true), id: z.uuid() });
export type MemoryKept = z.infer<typeof MemoryKept>;
export const MemoryRemoved = z.strictObject({ removed: z.literal(true) });
export const MemoryWithdrawn = z.strictObject({ withdrawn: z.literal(true) });
