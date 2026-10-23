import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiKeptMemory,
  ApiMemoryCandidate,
  ApiSharedKeptMemory,
  MemoryPermissionPreview,
  MemoryPermissionState,
} from "@vela/contracts";
import { useRef, useState } from "react";
import {
  ApiError,
  answerMemoryPermission,
  apiConfigured,
  dismissMemorySuggestion,
  fetchKeptMemories,
  fetchMemoryPermission,
  fetchMemorySuggestions,
  fetchSharedMemories,
  keepMemory,
  openMemoryPermission,
  removeKeptMemory,
  withdrawMemories,
} from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "./live-state.ts";
import { MEMORIES_DEMO } from "./my-memories-demo.ts";

/** Everything the "Your memories" screen reads and does, live or (demo builds only) synthetic. */
export interface MyMemoriesPort {
  permission(): Promise<MemoryPermissionState | null>;
  openQuestion(key: string): Promise<MemoryPermissionPreview>;
  answer(shown: MemoryPermissionPreview, answer: "yes" | "no", key: string): Promise<void>;
  withdraw(key: string): Promise<void>;
  suggestions(): Promise<ApiMemoryCandidate[]>;
  dismiss(id: string, key: string): Promise<void>;
  keep(id: string, key: string): Promise<void>;
  kept(): Promise<ApiKeptMemory[]>;
  /** Memories others named the reader to read, newest last as the server pages them. */
  shared(): Promise<ApiSharedKeptMemory[]>;
  remove(id: string, key: string): Promise<void>;
}

/** A 404 means the server does not offer Memories here (switched off), not that something broke. */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function livePort(familyId: string, token: () => Promise<string | null>): MyMemoriesPort {
  return {
    permission: async () => orNull(async () => fetchMemoryPermission(familyId, await token())),
    openQuestion: async (key) => openMemoryPermission(familyId, key, await token()),
    answer: async (shown, answer, key) => {
      await answerMemoryPermission(familyId, shown, answer, key, await token());
    },
    withdraw: async (key) => {
      await withdrawMemories(familyId, key, await token());
    },
    suggestions: async () => (await fetchMemorySuggestions(familyId, await token())).items,
    dismiss: async (id, key) => {
      await dismissMemorySuggestion(familyId, id, key, await token());
    },
    keep: async (id, key) => {
      await keepMemory(familyId, id, key, await token());
    },
    kept: async () => (await fetchKeptMemories(familyId, await token())).items,
    shared: async () => (await fetchSharedMemories(familyId, await token())).items,
    remove: async (id, key) => {
      await removeKeptMemory(familyId, id, key, await token());
    },
  };
}

export type MemoryWrite = "question" | "answer" | "keep" | "dismiss" | "remove" | "withdraw";

export interface MyMemoriesView {
  /** False where the server does not offer Memories: the screen and its entry stay hidden. */
  available: boolean;
  loading: boolean;
  trouble: boolean;
  state: MemoryPermissionState | null;
  /** The question's exact words, once asked for; cleared after an answer. */
  question: MemoryPermissionPreview | null;
  suggestions: ApiMemoryCandidate[];
  kept: ApiKeptMemory[];
  /** What others shared with the reader by name; readable whatever the reader's own choice is. */
  shared: ApiSharedKeptMemory[];
  pending: MemoryWrite | null;
  failed: MemoryWrite | null;
  /** The question expired or changed (409): it must be asked for again. */
  stale: boolean;
  refresh(): void;
  openQuestion(): void;
  closeQuestion(): void;
  answer(answer: "yes" | "no"): Promise<boolean>;
  keep(id: string): Promise<boolean>;
  dismiss(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  withdraw(): Promise<boolean>;
}

/**
 * The signed-in person's own memories (privacy-notice v7): their yes or no, the suggestions only
 * they see, the words they kept, and "turn off and clear". Every write keeps one idempotency key
 * per decision, so a retry after a failure finishes the same write.
 */
export function useMyMemories(familyId: string | undefined): MyMemoriesView {
  const account = useAccount();
  const queries = useQueryClient();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());
  const live = apiConfigured() && account.signedIn && familyId !== undefined;
  const demoPort = useRef<MyMemoriesPort | null>(null);
  if (demo && demoPort.current === null) demoPort.current = MEMORIES_DEMO();
  const port: MyMemoriesPort | null = demo
    ? demoPort.current
    : live
      ? livePort(familyId ?? "", account.token)
      : null;
  const scope = ["my-memories", demo ? "demo" : familyId] as const;
  const keyFor = {
    question: useIdempotencyKey("memory-question"),
    answer: useIdempotencyKey("memory-answer"),
    keep: useIdempotencyKey("memory-keep"),
    dismiss: useIdempotencyKey("memory-dismiss"),
    remove: useIdempotencyKey("memory-remove"),
    withdraw: useIdempotencyKey("memory-withdraw"),
  };
  const permission = useQuery({
    queryKey: [...scope, "permission"],
    enabled: port !== null,
    refetchOnWindowFocus: "always",
    queryFn: () => port?.permission() ?? Promise.resolve(null),
  });
  const on = permission.data?.state === "yes" && permission.data.outdated === false;
  const suggestions = useQuery({
    queryKey: [...scope, "suggestions"],
    enabled: port !== null && on,
    queryFn: () => port?.suggestions() ?? Promise.resolve([]),
  });
  // Kept memories stay readable even when suggestions are off: they are only removed by the person.
  const kept = useQuery({
    queryKey: [...scope, "kept"],
    enabled: port !== null && permission.data != null,
    queryFn: () => port?.kept() ?? Promise.resolve([]),
  });
  // What a parent shared from her chat: the reader's own memory choice has nothing to do with it.
  const shared = useQuery({
    queryKey: [...scope, "shared"],
    enabled: port !== null && permission.data != null,
    queryFn: () => port?.shared() ?? Promise.resolve([]),
  });
  const [question, setQuestion] = useState<MemoryPermissionPreview | null>(null);
  const [failed, setFailed] = useState<MemoryWrite | null>(null);
  const [stale, setStale] = useState(false);
  const write = useMutation({
    mutationFn: async (run: { kind: MemoryWrite; act: () => Promise<void> }) => run.act(),
  });
  const reload = () => queries.invalidateQueries({ queryKey: scope });
  const run = async (kind: MemoryWrite, act: () => Promise<void>): Promise<boolean> => {
    if (port === null || write.isPending) return false;
    setFailed(null);
    try {
      await write.mutateAsync({ kind, act });
      await reload();
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        // The choice is no longer current (expired, already used, source gone): read again.
        setStale(kind === "answer");
        if (kind === "answer") setQuestion(null);
        await reload();
        return false;
      }
      setFailed(kind);
      return false;
    }
  };
  return {
    available: port !== null && permission.data != null,
    loading: port !== null && permission.isPending,
    trouble: permission.isError || suggestions.isError || kept.isError,
    state: permission.data ?? null,
    question,
    suggestions: on ? (suggestions.data ?? []) : [],
    kept: kept.data ?? [],
    shared: shared.data ?? [],
    pending: write.isPending ? (write.variables?.kind ?? null) : null,
    failed,
    stale,
    refresh: () => void reload(),
    openQuestion: () => {
      setStale(false);
      void run("question", async () => {
        if (port === null) return;
        setQuestion(await port.openQuestion(keyFor.question({ at: Date.now() })));
      });
    },
    closeQuestion: () => setQuestion(null),
    answer: async (answer) => {
      const shown = question;
      if (shown === null || port === null) return false;
      const done = await run("answer", () =>
        port.answer(shown, answer, keyFor.answer({ id: shown.presentation_id, answer })),
      );
      if (done) setQuestion(null);
      return done;
    },
    keep: (id) => run("keep", async () => port?.keep(id, keyFor.keep({ id }))),
    dismiss: (id) => run("dismiss", async () => port?.dismiss(id, keyFor.dismiss({ id }))),
    remove: (id) => run("remove", async () => port?.remove(id, keyFor.remove({ id }))),
    withdraw: () => run("withdraw", async () => port?.withdraw(keyFor.withdraw({}))),
  };
}
