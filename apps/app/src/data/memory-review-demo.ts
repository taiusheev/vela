import { msg } from "@lingui/core/macro";
import type { MemoryReviewCopy } from "../components/memory-review.tsx";
import { reviewI18n } from "../i18n/memory-review.ts";
import {
  MEMORY_KEEP_TEXT_VERSION,
  type MemoryReviewPort,
  type ReviewMemory,
} from "./memory-review.ts";

/** Synthetic preview only. This module is never an API fallback. No storage or network calls. */
export function memoryReviewExample(): ReviewMemory {
  return {
    id: "example-flowers",
    authorId: "example-parent",
    authorName: reviewI18n._(msg`Mom`),
    kind: "preference",
    quote: reviewI18n._(msg`Yellow flowers always make the kitchen feel like summer.`),
    dateLabel: reviewI18n._(msg`21 October`),
    expiryLabel: reviewI18n._(msg`Available until 20 November.`),
    sourceQuestion: reviewI18n._(msg`Mia asked: What made you smile this morning?`),
    sourceAnswer: reviewI18n._(
      msg`I put the flowers by the window. Yellow flowers always make the kitchen feel like summer. The cat has already tried to eat one.`,
    ),
    revision: "example-1",
    state: "suggested",
  };
}
function story(): ReviewMemory {
  return {
    ...memoryReviewExample(),
    id: "example-story",
    kind: "story",
    state: "kept",
    quote: reviewI18n._(
      msg`Your grandfather asked me to dance, and stepped on my shoe before the music even started.`,
    ),
    dateLabel: reviewI18n._(msg`12 October`),
    expiryLabel: "",
    sourceQuestion: reviewI18n._(msg`Mia asked: How did you meet Grandpa?`),
    sourceAnswer: reviewI18n._(
      msg`Your grandfather asked me to dance, and stepped on my shoe before the music even started. I laughed so much that he asked for a second chance.`,
    ),
  };
}

export function memoryReviewCopy(): MemoryReviewCopy {
  return {
    you: reviewI18n._(msg`You`),
    title: reviewI18n._(msg`Your memories`),
    introduction: reviewI18n._(
      msg`The things you love. The stories you tell. You decide what stays with the family.`,
    ),
    toReview: reviewI18n._(msg`To review`),
    kept: reviewI18n._(msg`Kept memories`),
    categories: {
      preference: reviewI18n._(msg`Something you love`),
      story: reviewI18n._(msg`A story to pass on`),
      humour: reviewI18n._(msg`Something that made you laugh`),
      person: reviewI18n._(msg`Someone who matters`),
      moment: reviewI18n._(msg`A moment to remember`),
      follow_up: reviewI18n._(msg`Something to come back to`),
    },
    source: reviewI18n._(msg`Read the conversation`),
    keep: reviewI18n._(msg`Keep these words`),
    dismiss: reviewI18n._(msg`Leave this one`),
    remove: reviewI18n._(msg`Remove from memories`),
    back: reviewI18n._(msg`Back`),
    keepTitle: reviewI18n._(msg`Keep this with the family?`),
    keepExplanation: reviewI18n._(
      msg`Only these words will stay in family memories after the conversation’s 30 days. Everyone in your Vela family can read them. You can remove this memory later.`,
    ),
    keepConfirm: reviewI18n._(msg`Yes, keep these words`),
    removeTitle: reviewI18n._(msg`Remove this memory?`),
    removeExplanation: reviewI18n._(
      msg`These words will leave the family’s saved memories. Removing a memory does not delete copies someone has already downloaded.`,
    ),
    removeConfirm: reviewI18n._(msg`Remove this memory`),
    parentDecides: (name) => reviewI18n._(msg`${name} decides whether to keep these words.`),
    emptyReview: reviewI18n._(msg`Nothing waiting to review. New suggestions will appear here.`),
    emptyKept: reviewI18n._(
      msg`Your kept memories will be here. Start with a story, a joke, or something you love.`,
    ),
    loading: reviewI18n._(msg`Opening your memories…`),
    readFailed: reviewI18n._(msg`Your memories could not be reached. Try opening them again.`),
    actionFailed: reviewI18n._(msg`That change could not be confirmed. Try the action again.`),
    retry: reviewI18n._(msg`Try again`),
    pending: reviewI18n._(msg`Confirming…`),
    notices: {
      kept: reviewI18n._(msg`Kept with the family. You can find it under Kept memories.`),
      dismissed: reviewI18n._(msg`Left out of memories. The original conversation is unchanged.`),
      removed: reviewI18n._(msg`Removed from family memories.`),
      unavailable: reviewI18n._(
        msg`The source changed or is no longer available. Nothing new was kept.`,
      ),
    },
  };
}

export function createMemoryReviewDemo() {
  let items = [memoryReviewExample(), story()];
  let failNext = false;
  let unavailableNext = false;
  const receipts = new Map<string, Awaited<ReturnType<MemoryReviewPort["mutate"]>>>();
  const port: MemoryReviewPort = {
    list: async (signal) => {
      if (signal.aborted) throw new Error("aborted");
      return items.map((item) => ({ ...item }));
    },
    mutate: async (request, signal) => {
      if (signal.aborted) throw new Error("aborted");
      if (failNext) {
        failNext = false;
        throw new Error("synthetic failure");
      }
      const receipt = receipts.get(request.key);
      if (receipt) return receipt;
      const item = items.find((item) => item.id === request.id);
      if (unavailableNext || !item || item.revision !== request.revision) {
        unavailableNext = false;
        items = items.filter((item) => item.id !== request.id);
        return { kind: "unavailable", id: request.id };
      }
      const result: Awaited<ReturnType<MemoryReviewPort["mutate"]>> =
        request.action === "keep"
          ? { kind: "kept", item: { ...item, state: "kept" } }
          : { kind: "removed", id: request.id };
      if (request.action === "keep" && request.consentVersion !== MEMORY_KEEP_TEXT_VERSION)
        throw new Error("Missing example keep choice");
      items =
        result.kind === "kept"
          ? items.map((item) => (item.id === result.item.id ? result.item : item))
          : items.filter((item) => item.id !== request.id);
      receipts.set(request.key, result);
      return result;
    },
  };
  return {
    port,
    failNext: () => {
      failNext = true;
    },
    unavailableNext: () => {
      unavailableNext = true;
    },
  };
}
