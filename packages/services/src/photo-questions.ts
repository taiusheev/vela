/**
 * Vela's drafts of a question about a photo going into the family's photo box (ADR-61). The person
 * adding the photo asks for them; Vela shows the model the photo, their line about it and a few of
 * their own past asks, and offers back up to three questions in her language for them to pick,
 * change or ignore. Nothing is stored or sent: the question her morning asks is the one they save
 * with the photo (`photo_box.question`), signed with their name.
 */
import { PHOTO_QUESTION_MIMES, type PhotoQuestionInput } from "@vela/ai";
import { type ApiPhotoQuestionDrafts, DraftPhotoQuestions } from "@vela/contracts";
import {
  FORBIDDEN_ZH_TW,
  GENDERED_PRONOUNS,
  HEALTH_CHECK,
  SURVEILLANCE_WORDS,
} from "@vela/copy/rules";
import { aiCalls, exchanges, media, members, photoBox } from "@vela/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { isKeptLightMember } from "./group.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A photo larger than this is not sent to the model: the app uploads photos well under it. */
export const PHOTO_QUESTION_MAX_BYTES = 5 * 1024 * 1024;

/** How many of the caller's own past asks to her the model learns their way of asking from. */
const EXAMPLES = 3;

/** Wording a drafted question must never hold: a check on her, a surveillance word, a gender. */
const DRAFT_GUARDS: readonly RegExp[] = [
  HEALTH_CHECK.en,
  HEALTH_CHECK["zh-TW"],
  SURVEILLANCE_WORDS,
  GENDERED_PRONOUNS,
  FORBIDDEN_ZH_TW,
];

const NONE: ApiPhotoQuestionDrafts = { questions: [] };

/**
 * Drafts for `POST /v1/families/:familyId/photo-box/question-drafts`: for a live member of the
 * family, about an image they uploaded themselves or a box photo they may change; else 404. With
 * the switch off, no parent to ask, a photo too large or of a type the model cannot read, or a
 * failed call, the answer is no drafts, and they write their own.
 */
export async function draftPhotoQuestions(
  deps: Pick<Deps, "db" | "clock" | "ai" | "media" | "logger"> & {
    config: Pick<Deps["config"], "photoQuestionAi">;
  },
  identity: SessionIdentity,
  familyId: string,
  rawInput: unknown,
): Promise<ApiPhotoQuestionDrafts> {
  const parsed = DraftPhotoQuestions.safeParse(rawInput);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const input = parsed.data;
  if (!UUID.test(familyId)) throw new VelaError("not_found", "Family not found");
  const found = await authorizeFamilyAccess(deps.db, identity, familyId);
  if (found.kind !== "granted") throw new VelaError("not_found", "Family not found");
  const { access } = found;
  const mediaId = input.media_id.toLowerCase();
  const [file] = await deps.db
    .select({ file: media, boxAdder: photoBox.addedBy, inBox: photoBox.id })
    .from(media)
    .leftJoin(photoBox, eq(photoBox.mediaId, media.id))
    .where(and(eq(media.id, mediaId), eq(media.familyId, access.familyId)))
    .limit(1);
  const mayDraft =
    file !== undefined &&
    file.file.kind === "image" &&
    file.file.storageKey !== null &&
    (file.inBox === null
      ? file.file.uploadedBy === access.memberId && file.file.channel === null
      : access.role === "organiser" || file.boxAdder === access.memberId);
  if (!mayDraft || file === undefined) throw new VelaError("not_found", "Photo not found");
  if (deps.config.photoQuestionAi !== true || deps.media === null) return NONE;

  const parent = (
    await deps.db
      .select()
      .from(members)
      .where(
        and(
          eq(members.familyId, access.familyId),
          inArray(members.status, ["active", "paused"]),
          isNull(members.leftAt),
        ),
      )
      .orderBy(asc(members.createdAt), asc(members.id))
  ).find(isKeptLightMember);
  if (parent === undefined || parent.id === access.memberId) return NONE;

  const storageKey = file.file.storageKey;
  if (storageKey === null) return NONE;
  const stored = await deps.media.get(storageKey);
  if (stored === null) return NONE;
  const mime = PHOTO_QUESTION_MIMES.find((candidate) => candidate === stored.mime);
  if (mime === undefined || stored.body.byteLength > PHOTO_QUESTION_MAX_BYTES) {
    deps.logger.info("photo_question_skipped", {
      familyId: access.familyId,
      reason: mime === undefined ? "type" : "size",
    });
    return NONE;
  }

  const [asker] = await deps.db
    .select({ name: members.displayName })
    .from(members)
    .where(eq(members.id, access.memberId));
  const examples = await deps.db
    .select({ text: exchanges.text })
    .from(exchanges)
    .where(
      and(
        eq(exchanges.askerId, access.memberId),
        eq(exchanges.recipientId, parent.id),
        eq(exchanges.draftedByVela, false),
        isNotNull(exchanges.text),
      ),
    )
    .orderBy(desc(exchanges.createdAt))
    .limit(EXAMPLES);
  const brief: PhotoQuestionInput = {
    lang: parent.language,
    askerName: asker?.name ?? "",
    addressForm: parent.displayName,
    era: input.era,
    caption: input.caption ?? null,
    askerExamples: examples.flatMap((row) => (row.text === null ? [] : [row.text])),
    image: { mime, base64: toBase64(stored.body) },
  };
  if (brief.askerName.trim().length === 0) return NONE;
  const outcome = await deps.ai.photoQuestion(brief);
  if (outcome.record !== null) {
    const record = outcome.record;
    await deps.db.insert(aiCalls).values({
      familyId: access.familyId,
      memberId: access.memberId,
      call: record.call,
      promptVersion: record.promptVersion,
      model: record.model,
      inputRef: {},
      output: {},
      ok: record.ok,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      tokensCached: record.tokensCached,
      latencyMs: record.latencyMs,
      costUsd: record.costUsd,
      at: deps.clock.now(),
    });
  }
  if (!outcome.ok) return NONE;
  return { questions: acceptedQuestions(outcome.value.questions, input.caption ?? null) };
}

/**
 * The drafts worth offering: one question each, none that repeats the caller's line, none a check
 * on her or holding a word Vela never uses, and no two the same.
 */
export function acceptedQuestions(
  questions: readonly string[],
  caption: string | null,
): string[] {
  const kept: string[] = [];
  const line = caption === null ? null : comparable(caption);
  for (const raw of questions) {
    const question = raw.trim();
    if (question.length === 0 || question.length > 200) continue;
    if ((question.match(/[?？]/gu)?.length ?? 0) !== 1) continue;
    if (DRAFT_GUARDS.some((guard) => guard.test(question))) continue;
    if (line !== null && line.length >= 4 && comparable(question).includes(line)) continue;
    if (kept.some((other) => comparable(other) === comparable(question))) continue;
    kept.push(question);
  }
  return kept.slice(0, 3);
}

function comparable(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]/gu, "");
}

/** Bytes as base64, in chunks, since a whole photo spread into one call overflows the stack. */
function toBase64(body: ArrayBuffer): string {
  const bytes = new Uint8Array(body);
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
