import { msg } from "@lingui/core/macro";
import {
  MEMORY_SHARE_EXPLANATION_EN,
  MEMORY_SHARE_VERSION,
  type MemorySharingView,
} from "@vela/contracts";
import type { MemorySharingCopy } from "../components/memory-sharing.tsx";
import { sharingI18n } from "../i18n/memory-sharing.ts";
import type { MemorySharingPort } from "./memory-sharing.ts";

export const DEMO_MEMORY_AUTHOR = "00000000-0000-4000-8000-000000000001";
export const DEMO_MEMORY_READER = "00000000-0000-4000-8000-000000000002";
export const DEMO_MEMORY_ID = "00000000-0000-4000-8000-000000000010";
export const memorySharingCopy: MemorySharingCopy = {
  title: sharingI18n._(msg`Share this memory`),
  introduction: sharingI18n._(
    msg`Keeping a memory does not share it. You choose who can read these words.`,
  ),
  private: sharingI18n._(msg`Private · only you`),
  sharedWith: sharingI18n._(msg`Shared with`),
  confirmAudience: sharingI18n._(msg`Share with these people`),
  choose: sharingI18n._(msg`Choose people`),
  review: sharingI18n._(msg`Review sharing`),
  confirmTitle: sharingI18n._(msg`Share these words?`),
  confirm: sharingI18n._(msg`Share with these people`),
  back: sharingI18n._(msg`Back to people`),
  stop: sharingI18n._(msg`Stop sharing`),
  stopExplanation: sharingI18n._(
    msg`Stopping sharing removes access in Vela. Words someone already read or copied cannot be recalled.`,
  ),
  noPeople: sharingI18n._(
    msg`There is no one available to share with yet. This memory stays private.`,
  ),
  loading: sharingI18n._(msg`Opening sharing details…`),
  unavailable: sharingI18n._(
    msg`This memory or sharing choice is no longer available. Check the latest details before trying again.`,
  ),
  readError: sharingI18n._(
    msg`We couldn’t load the sharing details. Sharing may still be on. Try stopping sharing below, or check again.`,
  ),
  actionError: sharingI18n._(
    msg`We couldn’t confirm the change. Try again, or go back and check the latest sharing details.`,
  ),
  expired: sharingI18n._(
    msg`Please review the people again before sharing. There is no rush to decide.`,
  ),
  retry: sharingI18n._(msg`Check again`),
  pending: sharingI18n._(msg`One moment…`),
  updated: sharingI18n._(msg`These are the latest sharing details.`),
};

/** In-memory synthetic examples only. No network, device storage or real consent record. */
export function createMemorySharingDemo() {
  let view: MemorySharingView = {
    memory_id: DEMO_MEMORY_ID,
    author_id: DEMO_MEMORY_AUTHOR,
    quote: sharingI18n._(msg`I still laugh about the picnic with the dancing umbrella.`),
    revision: "00000000-0000-4000-8000-000000000020",
    audience_complete: true,
    recipients: [
      { member_id: DEMO_MEMORY_READER, display_name: "Alex", shared: false },
      { member_id: "00000000-0000-4000-8000-000000000003", display_name: "Mira", shared: false },
    ],
  };
  let fail = false;
  let sequence = 100;
  let presentation: { id: string; ids: string[]; revision: string } | null = null;
  let unavailable = false;
  const clone = <T>(value: T): T => structuredClone(value);
  const maybeFail = () => {
    if (fail) {
      fail = false;
      throw new Error("synthetic_failure");
    }
  };
  const port: MemorySharingPort = {
    async read() {
      maybeFail();
      return unavailable ? null : clone(view);
    },
    async prepare(input) {
      maybeFail();
      if (unavailable || input.memory_id !== view.memory_id)
        throw new Error("synthetic_unavailable");
      presentation = {
        id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        ids: [...input.recipient_ids],
        revision: view.revision,
      };
      return {
        presentation_id: presentation.id,
        memory_id: view.memory_id,
        quote: view.quote,
        lang: "en",
        recipients: clone(
          view.recipients
            .filter((r) => input.recipient_ids.includes(r.member_id))
            .map(({ member_id, display_name }) => ({ member_id, display_name })),
        ),
        confirmation_version: MEMORY_SHARE_VERSION,
        explanation: MEMORY_SHARE_EXPLANATION_EN,
        presentation_sha256: "a".repeat(64),
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      };
    },
    async confirm(input) {
      maybeFail();
      if (
        unavailable ||
        !presentation ||
        input.presentation_id !== presentation.id ||
        presentation.revision !== view.revision
      )
        throw new Error("synthetic_unavailable");
      const ids = presentation.ids;
      view = {
        ...view,
        recipients: view.recipients.map((r) => ({ ...r, shared: ids.includes(r.member_id) })),
      };
      presentation = null;
    },
    async stop() {
      maybeFail();
      presentation = null;
      view = {
        ...view,
        revision: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        recipients: view.recipients.map((r) => ({ ...r, shared: false })),
      };
    },
  };
  return {
    port,
    failNext() {
      fail = true;
    },
    removeSource() {
      unavailable = true;
    },
    readerQuote() {
      return !unavailable &&
        view.recipients.some((r) => r.member_id === DEMO_MEMORY_READER && r.shared)
        ? view.quote
        : null;
    },
  };
}
