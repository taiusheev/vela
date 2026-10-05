/**
 * An unsend (LINE, 05-line-flows §4, D6): someone withdrew a message Vela stored, her answer or a
 * family reply. Vela deletes what it kept of it: the stored file (with its proof of deletion), the
 * words and transcript, and their translations. The answer row stays, and with it her light and
 * the exchange's state: her answer was still a sign she is there. What Vela already posted to the
 * family's group stays too, since a bot cannot delete there. Asks made by quoting are not yet
 * matched.
 */
import type { InboundEvent } from "@vela/contracts";
import { answers, media, replies, translations } from "@vela/db";
import { and, eq, sql } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { deleteMedia } from "./jobs.ts";

export async function handleUnsent(deps: Deps, event: InboundEvent): Promise<void> {
  if (event.messageId === undefined) return;
  const externalId = `${event.conversation.externalId}:${event.messageId}`;
  const now = deps.clock.now();
  const [answer] = await deps.db
    .select()
    .from(answers)
    .where(and(eq(answers.channel, event.channel), eq(answers.externalId, externalId)))
    .limit(1);
  const [reply] = await deps.db
    .select()
    .from(replies)
    .where(and(eq(replies.channel, event.channel), eq(replies.externalId, externalId)))
    .limit(1);
  if (answer === undefined && reply === undefined) {
    deps.logger.info("unsend_unknown", { conversation: event.conversation.kind });
    return;
  }
  for (const mediaId of [answer?.mediaId, reply?.mediaId]) {
    if (mediaId === null || mediaId === undefined) continue;
    const [file] = await deps.db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (file !== undefined) await deleteMedia(deps, file, "unsent");
  }
  await deps.db.transaction(async (tx) => {
    if (answer !== undefined) {
      await tx
        .update(answers)
        .set({
          payload: sql`${answers.payload} - array['text', 'choice']`,
          transcript: null,
          summary: null,
          mentions: {},
          moodWords: [],
        })
        .where(eq(answers.id, answer.id));
      await tx
        .delete(translations)
        .where(and(eq(translations.objectType, "answer"), eq(translations.objectId, answer.id)));
    }
    if (reply !== undefined) {
      await tx.update(replies).set({ text: null }).where(eq(replies.id, reply.id));
      await tx
        .delete(translations)
        .where(and(eq(translations.objectType, "reply"), eq(translations.objectId, reply.id)));
    }
    const owner = answer ?? reply;
    if (owner !== undefined) {
      await recordEvent(
        tx,
        {
          name: "message_unsent",
          memberId: owner.memberId,
          exchangeId: owner.exchangeId,
          props: { kind: answer !== undefined ? "answer" : "reply" },
        },
        now,
      );
    }
  });
}
