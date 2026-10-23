import { t } from "@lingui/core/macro";
import {
  type ApiKeptMemory,
  type ApiMemoryCandidate,
  MEMORY_PERMISSION_NOTICE_VERSION,
  MEMORY_PERMISSION_TEXT_EN,
  MEMORY_PERMISSION_VERSION,
  type MemoryPermissionState,
} from "@vela/contracts";
import type { MyMemoriesPort } from "./useMyMemories.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Read when the demo starts, so the words follow the app language. */
const suggested = (): ApiMemoryCandidate[] => [
  {
    id: id(11),
    member_id: id(1),
    source_answer_id: id(21),
    kind: "preference",
    quote: t`Yellow chrysanthemums on the balcony make the whole morning feel warm.`,
    lang: "en",
    occurred_at: "2026-10-20T00:30:00.000Z",
    expires_at: "2026-11-19T00:30:00.000Z",
  },
  {
    id: id(12),
    member_id: id(1),
    source_answer_id: id(22),
    kind: "story",
    quote: t`We rode the night train to the sea and ate pears from a paper bag.`,
    lang: "en",
    occurred_at: "2026-10-18T00:30:00.000Z",
    expires_at: "2026-11-17T00:30:00.000Z",
  },
];

/**
 * Demo builds only (no API, no accounts): synthetic words that make no request and store nothing.
 * The question carries the real reviewed text, so the demo shows exactly what a person would read.
 */
export function MEMORIES_DEMO(): MyMemoriesPort {
  let state: MemoryPermissionState = { state: "none", outdated: false };
  let suggestions = suggested();
  let kept: ApiKeptMemory[] = [];
  return {
    permission: async () => state,
    openQuestion: async () => ({
      presentation_id: id(31),
      text_version: MEMORY_PERMISSION_VERSION,
      notice_version: MEMORY_PERMISSION_NOTICE_VERSION,
      lang: "en",
      text: MEMORY_PERMISSION_TEXT_EN,
      text_sha256: "0".repeat(64),
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    }),
    answer: async (_shown, answer) => {
      state = { state: answer, outdated: false };
    },
    withdraw: async () => {
      state = { state: "withdrawn", outdated: false };
      suggestions = [];
      kept = [];
    },
    suggestions: async () => (state.state === "yes" ? suggestions : []),
    dismiss: async (memory) => {
      suggestions = suggestions.filter((item) => item.id !== memory);
    },
    keep: async (memory) => {
      const item = suggestions.find((candidate) => candidate.id === memory);
      if (item === undefined) return;
      suggestions = suggestions.filter((candidate) => candidate.id !== memory);
      kept = [
        {
          id: id(40 + kept.length),
          member_id: item.member_id,
          source_answer_id: item.source_answer_id,
          kind: item.kind,
          quote: item.quote,
          lang: item.lang,
          occurred_at: item.occurred_at,
          kept_at: new Date().toISOString(),
          source_available: true,
        },
        ...kept,
      ];
    },
    kept: async () => kept,
    // Mom shared one memory with the reader from her chat.
    shared: async () => [
      {
        id: id(51),
        member_id: "m1",
        kind: "story",
        quote: t`Your grandfather sang to the tomatoes every morning, and they grew the sweetest.`,
        lang: "en",
        occurred_at: "2026-10-19T00:30:00.000Z",
        kept_at: "2026-10-19T01:00:00.000Z",
      },
    ],
    remove: async (memory) => {
      kept = kept.filter((item) => item.id !== memory);
    },
  };
}
