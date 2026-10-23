/**
 * Memories in the parent's own chat (Telegram or LINE), for a parent who answers there and has no
 * app (founder's request of 23 Oct 2026): Vela asks her once whether it may suggest memories
 * (consent.rich_memories@2, the approved wording), offers each suggestion with Keep, Share with
 * {organiser} and Leave out (memory.keep@2, memory.share@1), and "memories off" turns it off and
 * clears them. Everything here is her own tap in her own private chat; an organiser can never
 * answer for her. Off unless `richMemories` and `memoryDiscovery` are both on.
 */

import type { InboundEvent } from "@vela/contracts";
import { MEMORY_SHARE_VERSION } from "@vela/contracts";
import { type MessageKey, t } from "@vela/copy";
import type { ButtonAction } from "@vela/core";
import { encodeButton, outboundKey } from "@vela/core";
import {
  answers,
  consents,
  type Family,
  type Member,
  members,
  memoryCandidates,
  memoryKeeps,
  memoryShares,
  outbound,
} from "@vela/db";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { arrivalChannelOf } from "./arrivals.ts";
import { inviterOf } from "./consent.ts";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { enqueueOutbound } from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import { keepMemoryFromChat } from "./memory-keeps.ts";
import { chatConsentEvidence } from "./proofs.ts";
import { channelLinkOfMember, familyById, isMessenger, memberByChannelUser } from "./repo.ts";
import { RICH_MEMORY_CONSENT_VERSION } from "./rich-memories.ts";

export type MemoryPermissionAction = Extract<ButtonAction, { type: "memory_permission" }>;
export type MemoryOfferAction = Extract<ButtonAction, { type: "memory_offer" }>;

/** Waits after her answer's own replies, so the question never comes before them. */
const QUESTION_DELAY_SECONDS = 30;
const OFFER_DELAY_SECONDS = 20;
const active = ["active", "paused"] as const;

function on(deps: Pick<Deps, "config">): boolean {
  return deps.config.richMemories === true && deps.config.memoryDiscovery === true;
}

/** Her messenger link, when her mornings go to a messenger she can still be reached on. */
async function herChat(deps: Pick<Deps, "db">, member: Member) {
  const channel = arrivalChannelOf(member);
  if (!isMessenger(channel)) return null;
  const link = await channelLinkOfMember(deps.db, member.id, channel);
  return link === null || link.blockedAt !== null ? null : link;
}

/**
 * Asks her once, in her chat, after an answer of hers was understood: only while she has never
 * answered the memory question, and keyed by her member so it is sent at most once.
 */
export async function askMemoryQuestion(deps: Deps, member: Member, family: Family): Promise<void> {
  if (!on(deps) || member.status !== "active") return;
  try {
    const [asked] = await deps.db
      .select({ id: consents.id })
      .from(consents)
      .where(and(eq(consents.memberId, member.id), eq(consents.kind, "rich_memories")))
      .limit(1);
    if (asked !== undefined) return;
    const link = await herChat(deps, member);
    if (link === null) return;
    const lang = member.language;
    const action = (accept: boolean) =>
      encodeButton({ type: "memory_permission", memberId: member.id, accept });
    await enqueueOutbound(deps, deps.db, {
      kind: "consent",
      idempotencyKey: outboundKey("consent", {
        conversationId: link.externalId,
        suffix: `memory_question:${member.id}`,
      }),
      memberId: member.id,
      channel: link.channel,
      conversationId: link.externalId,
      lang,
      text: t(lang, "memory.question"),
      buttons: [
        [
          { id: action(true), label: t(lang, "memory.allow") },
          { id: action(false), label: t(lang, "memory.not_now") },
        ],
      ],
      ref: { purpose: "consent", memberId: member.id },
      delaySeconds: QUESTION_DELAY_SECONDS,
    });
    deps.logger.info("memory_question_queued", { familyId: family.id });
  } catch (error) {
    deps.logger.error("memory_question_error", { error: errorLabel(error) });
  }
}

/** The message id her tap is about: the tap's own, or (LINE postbacks) the carrier's outbound row. */
async function carrierOf(
  deps: Pick<Deps, "db">,
  event: InboundEvent,
  memberId: string,
  marker: string,
): Promise<string | undefined> {
  if (event.messageId !== undefined) return event.messageId;
  const rows = await deps.db
    .select({ key: outbound.idempotencyKey, externalId: outbound.externalId })
    .from(outbound)
    .where(
      and(
        eq(outbound.memberId, memberId),
        eq(outbound.conversationId, event.conversation.externalId),
      ),
    )
    .orderBy(desc(outbound.queuedAt));
  return (
    rows.find((row) => row.key.includes(encodeURIComponent(marker)) && row.externalId !== null)
      ?.externalId ?? undefined
  );
}

/** Her own tap, in her own private chat, from the member the payload names. */
async function sender(deps: Deps, event: InboundEvent, memberId: string) {
  const found = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (
    found === null ||
    found.member.id !== memberId ||
    event.conversation.kind !== "private" ||
    found.family.deletedAt !== null
  )
    return null;
  return found;
}

async function close(deps: Deps, event: InboundEvent, text: string, keep: string): Promise<void> {
  if (event.messageId === undefined) return;
  await deps.channels
    .get(event.channel)
    .closeButtons(
      event.conversation.externalId,
      event.messageId,
      `${text}\n\n${keep}`,
      text.length,
    );
}

/**
 * Her yes or "not now" to the memory question, recorded once, under her member lock, as a
 * `rich_memories` consent with the evidence of the exact message she tapped. A tap after she
 * turned memories off ("memories off") records nothing: an old question cannot switch them back on.
 */
export async function handleMemoryPermissionButton(
  deps: Deps,
  event: InboundEvent,
  action: MemoryPermissionAction,
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  if (!on(deps)) return;
  const found = await sender(deps, event, action.memberId);
  if (found === null) {
    deps.logger.info("memory_permission_ignored", { reason: "sender" });
    return;
  }
  const lang = found.member.language;
  const now = deps.clock.now();
  const messageId = await carrierOf(
    deps,
    event,
    found.member.id,
    `memory_question:${found.member.id}`,
  );
  const recorded = await deps.db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, action.memberId))
      .for("update");
    if (member === undefined || member.status !== "active" || member.leftAt !== null) return false;
    const [earlier] = await tx
      .select({ id: consents.id })
      .from(consents)
      .where(and(eq(consents.memberId, member.id), eq(consents.kind, "rich_memories")))
      .limit(1);
    if (earlier !== undefined) return false;
    await tx.insert(consents).values({
      memberId: member.id,
      subjectRef: `member:${member.id}`,
      kind: "rich_memories",
      answer: action.accept ? "yes" : "no",
      textVersion: RICH_MEMORY_CONSENT_VERSION,
      lang,
      channel: event.channel,
      givenAt: now,
      evidence: await chatConsentEvidence({
        chatId: event.conversation.externalId,
        messageId,
        lang,
        key: "memory.question",
        params: {},
      }),
    });
    return true;
  });
  if (recorded) {
    await close(
      deps,
      event,
      t(lang, "memory.question"),
      t(lang, action.accept ? "memory.allow" : "memory.not_now"),
    );
    await enqueueOutbound(deps, deps.db, {
      kind: "consent",
      idempotencyKey: outboundKey("consent", {
        conversationId: event.conversation.externalId,
        suffix: `memory_answer:${found.member.id}`,
      }),
      memberId: found.member.id,
      channel: event.channel,
      conversationId: event.conversation.externalId,
      lang,
      text: t(lang, action.accept ? "memory.allowed" : "memory.declined"),
    });
  }
  deps.logger.info("memory_permission_button", {
    familyId: found.family.id,
    accept: action.accept,
    recorded,
  });
}

/** Who she can share with from her chat: whoever invited her, active in her family, with the app. */
async function shareRecipient(deps: Pick<Deps, "db">, member: Member): Promise<Member | null> {
  const inviter = await inviterOf(deps.db, member);
  return inviter !== null &&
    inviter.familyId === member.familyId &&
    inviter.id !== member.id &&
    inviter.leftAt === null &&
    inviter.userId !== null &&
    active.includes(inviter.status as (typeof active)[number])
    ? inviter
    : null;
}

/**
 * Offers one new suggestion in her chat, with the keep explanation (and the share explanation when
 * she has someone to share with) in the message itself, so her tap is her informed choice.
 */
export async function offerMemory(
  deps: Deps,
  member: Member,
  candidateId: string,
  quote: string,
): Promise<void> {
  if (!on(deps)) return;
  try {
    const link = await herChat(deps, member);
    const family = await familyById(deps.db, member.familyId);
    if (link === null || family === null) return;
    const lang = member.language;
    const recipient = await shareRecipient(deps, member);
    const organiser = recipient?.displayName ?? "";
    const button = (choice: MemoryOfferAction["choice"], key: MessageKey) => [
      {
        id: encodeButton({ type: "memory_offer", candidateId, choice }),
        label: key === "memory.share" ? t(lang, key, { organiser }) : t(lang, key),
      },
    ];
    await enqueueOutbound(deps, deps.db, {
      kind: "consent",
      idempotencyKey: outboundKey("consent", {
        conversationId: link.externalId,
        suffix: `memory_offer:${candidateId}`,
      }),
      memberId: member.id,
      channel: link.channel,
      conversationId: link.externalId,
      lang,
      text:
        recipient === null
          ? t(lang, "memory.offer", { quote })
          : t(lang, "memory.offer_share", { quote, organiser }),
      buttons: [
        button("keep", "memory.keep"),
        ...(recipient === null ? [] : [button("share", "memory.share")]),
        button("leave", "memory.leave"),
      ],
      ref: { purpose: "consent", memberId: member.id },
      delaySeconds: OFFER_DELAY_SECONDS,
    });
  } catch (error) {
    deps.logger.error("memory_offer_error", { error: errorLabel(error) });
  }
}

/** A grant for the one person named on her Share button, with no quote or name copy. */
async function shareWith(
  deps: Deps,
  keepId: string,
  recipient: Member,
  evidenceSha: string,
): Promise<boolean> {
  return deps.db.transaction(async (tx) => {
    const [kept] = await tx
      .select()
      .from(memoryKeeps)
      .where(and(eq(memoryKeeps.id, keepId), isNull(memoryKeeps.removedAt)))
      .for("update");
    const [reader] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.id, recipient.id),
          isNull(members.leftAt),
          inArray(members.status, active),
          isNotNull(members.userId),
        ),
      )
      .for("share");
    if (!kept || !reader || reader.familyId !== kept.familyId || reader.userId === null)
      return false;
    await tx
      .insert(memoryShares)
      .values({
        keepId: kept.id,
        recipientMemberId: reader.id,
        recipientUserId: reader.userId,
        recipientMembershipRevision: reader.memoryMembershipRevision,
        sharingRevision: kept.sharingRevision,
        presentationId: null,
        confirmationVersion: MEMORY_SHARE_VERSION,
        fingerprint: await sha256Hex(
          JSON.stringify([
            MEMORY_SHARE_VERSION,
            kept.id,
            reader.id,
            kept.sharingRevision,
            evidenceSha,
          ]),
        ),
        grantedAt: deps.clock.now(),
      })
      .onConflictDoNothing();
    return true;
  });
}

/** Her Keep, Share or Leave out on one suggestion. Every check is repeated under lock. */
export async function handleMemoryOfferButton(
  deps: Deps,
  event: InboundEvent,
  action: MemoryOfferAction,
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const [candidate] = await deps.db
    .select()
    .from(memoryCandidates)
    .where(eq(memoryCandidates.id, action.candidateId));
  if (candidate === undefined) return;
  const found = await sender(deps, event, candidate.memberId);
  if (found === null) {
    deps.logger.info("memory_offer_ignored", { reason: "sender" });
    return;
  }
  const { member, family } = found;
  const lang = member.language;
  const [source] = await deps.db
    .select()
    .from(answers)
    .where(eq(answers.id, candidate.sourceAnswerId));
  const recipient = await shareRecipient(deps, member);
  const organiser = recipient?.displayName ?? "";
  const quote = source === undefined ? "" : (sourceQuote(source, candidate) ?? "");
  const key: MessageKey = recipient === null ? "memory.offer" : "memory.offer_share";
  const shown = t(lang, key, recipient === null ? { quote } : { quote, organiser });

  if (action.choice === "leave") {
    await deps.db
      .update(memoryCandidates)
      .set({ dismissedAt: deps.clock.now() })
      .where(and(eq(memoryCandidates.id, candidate.id), isNull(memoryCandidates.dismissedAt)));
    await close(deps, event, shown, t(lang, "memory.left"));
    return;
  }
  const evidence = await chatConsentEvidence({
    chatId: event.conversation.externalId,
    messageId: await carrierOf(deps, event, member.id, `memory_offer:${candidate.id}`),
    lang,
    key,
    params: recipient === null ? { quote } : { quote, organiser },
  });
  const keptId = await keepMemoryFromChat(deps, member.id, candidate.id, {
    channel: event.channel,
    evidence,
  });
  if (keptId === null) {
    await close(deps, event, shown, t(lang, "memory.unavailable"));
    return;
  }
  const shared =
    action.choice === "share" && recipient !== null
      ? await shareWith(deps, keptId, recipient, evidence.text_sha256)
      : false;
  await close(
    deps,
    event,
    shown,
    shared ? t(lang, "memory.kept_shared", { organiser }) : t(lang, "memory.kept"),
  );
  deps.logger.info("memory_offer_button", { familyId: family.id, choice: action.choice, shared });
}

/** The exact words a candidate points at in her source, or null when they are gone. */
function sourceQuote(
  answer: typeof answers.$inferSelect,
  candidate: typeof memoryCandidates.$inferSelect,
): string | null {
  const text =
    answer.kind === "voice"
      ? answer.transcript
      : typeof answer.payload.text === "string"
        ? answer.payload.text
        : null;
  return text === null ? null : text.slice(candidate.start, candidate.end);
}
