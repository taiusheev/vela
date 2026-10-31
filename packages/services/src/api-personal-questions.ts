import type { Ai, SuggestInput } from "@vela/ai";
import { ApiPersonalQuestionDraft, DraftPersonalQuestion } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { aiCalls } from "@vela/db";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { canBeAsked } from "./askable.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { pilotFamilyAllowed, pilotSpeaks } from "./pilot-admission.ts";
import { familyHasEnded, memberById } from "./repo.ts";

const normalized = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
/** Conservative literal guard, NOT a semantic guarantee; all outputs still require human review. */
export function crossesDraftBoundary(text: string, blocked: readonly string[]): boolean {
  const value = normalized(text);
  return blocked.some((term) => value.includes(normalized(term)));
}

const FALSE_ATTENTION =
  /\b(i(?:'ve| have)? (?:read|saw|listened to|remember)|i(?:'ll| will) (?:call|visit)|i miss you|i was thinking of you)\b|我(?:已經|剛剛|剛|有)?(?:看過|看了|讀了|聽了|想你|想妳|記得)|我(?:今晚|明天|等一下|待會).{0,8}(?:打|來看)/iu;

/** Request-only context; neither notes nor output are persisted, scheduled, or sent to a parent. */
export async function draftApiPersonalQuestion(
  deps: Pick<Deps, "db" | "clock"> & { ai: Ai; config: Pick<Deps["config"], "pilotAdmission"> },
  identity: SessionIdentity,
  familyId: string,
  rawInput: unknown,
): Promise<ApiPersonalQuestionDraft> {
  const parsed = DraftPersonalQuestion.safeParse(rawInput);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const input = parsed.data;
  const family = familyId.toLowerCase();
  const recipientId = input.recipient_id.toLowerCase();
  async function authorized() {
    const access = await authorizeFamilyAccess(deps.db, identity, family);
    if (access.kind !== "granted") throw new VelaError("not_found", "Family not found");
    const parent = await memberById(deps.db, recipientId);
    const child = await memberById(deps.db, access.access.memberId);
    if (
      !parent ||
      !child ||
      child.status !== "active" ||
      child.id === parent.id ||
      !canBeAsked(parent, family) ||
      (await familyHasEnded(deps.db, family)) ||
      !(await pilotFamilyAllowed(deps.db, deps.config.pilotAdmission, family)) ||
      !pilotSpeaks(deps.config.pilotAdmission, input.language)
    )
      throw new VelaError("not_found", "Member not found");
    return { parent, child };
  }
  const { parent, child } = await authorized();
  if (input.context.connection === "quiet") return { state: "not_drafted", reason: "quiet" };
  const blocked = [...input.context.avoid_topics, ...input.context.never_say];
  if (crossesDraftBoundary(input.context.intent, blocked))
    return { state: "not_drafted", reason: "boundary" };
  const brief: SuggestInput = {
    lang: input.language,
    holderName: child.displayName,
    recipientAddress: input.address_form,
    forDate: addDays(localDateOf(deps.clock.now(), parent.tz), 1),
    rotationType: "question",
    recentMentions: [],
    familyDates: [],
    holderLastAsk: null,
    holderWritingExamples: input.writing_examples,
    personalization: input.context,
  };
  const outcome = await deps.ai.suggest(brief);
  // An in-flight request cannot return family content after departure, deletion, pause or withdrawal.
  await authorized();
  if (outcome.record !== null) {
    const record = outcome.record;
    await deps.db.insert(aiCalls).values({
      familyId: family,
      memberId: child.id,
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
  if (!outcome.ok) return { state: "not_drafted", reason: "unavailable" };
  const text = outcome.value.text.trim();
  if (
    !text ||
    text.includes("VELA_NO_DRAFT") ||
    outcome.value.type !== "question" ||
    crossesDraftBoundary(text, blocked) ||
    FALSE_ATTENTION.test(text) ||
    (text.match(/[?？]/gu)?.length ?? 0) > 1
  )
    return { state: "not_drafted", reason: "needs_rewording" };
  return ApiPersonalQuestionDraft.parse({ state: "review", text, language: input.language });
}
