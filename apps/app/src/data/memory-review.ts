import type { FamilyMemoryKind } from "@vela/contracts";

export interface ReviewMemory {
  id: string;
  authorId: string;
  authorName: string;
  kind: FamilyMemoryKind;
  quote: string;
  dateLabel: string;
  expiryLabel: string;
  sourceQuestion: string;
  sourceAnswer: string;
  /** Opaque source revision from the future transport, never inferred from display text. */
  revision: string;
  state: "suggested" | "kept";
}
export type MemoryAction = "keep" | "dismiss" | "remove";
export const MEMORY_KEEP_TEXT_VERSION = "memory.keep@1";
export interface MemoryReviewPort {
  list(signal: AbortSignal): Promise<ReviewMemory[]>;
  mutate(
    request: {
      id: string;
      revision: string;
      action: MemoryAction;
      key: string;
      consentVersion: string | null;
    },
    signal: AbortSignal,
  ): Promise<
    { kind: "kept"; item: ReviewMemory } | { kind: "removed" | "unavailable"; id: string }
  >;
}
export interface MemoryReviewState {
  phase: "loading" | "ready" | "read_error";
  items: ReviewMemory[];
  selectedId: string | null;
  pane: "list" | "source" | "keep" | "remove";
  pending: MemoryAction | null;
  actionFailed: boolean;
  notice: "kept" | "dismissed" | "removed" | "unavailable" | null;
}
const empty = (): MemoryReviewState => ({
  phase: "loading",
  items: [],
  selectedId: null,
  pane: "list",
  pending: null,
  actionFailed: false,
  notice: null,
});

/** Session-scoped controller. A real transport must enforce ownership, source revision and consent. */
export class MemoryReviewController {
  private state = empty();
  private listeners = new Set<() => void>();
  private active = true;
  private generation = 0;
  private request: AbortController | null = null;
  private keys = new Map<string, string>();
  readonly viewerId: string;
  private readonly port: MemoryReviewPort;
  private readonly nextKey: () => string;

  constructor(viewerId: string, port: MemoryReviewPort, nextKey: () => string) {
    this.viewerId = viewerId;
    this.port = port;
    this.nextKey = nextKey;
  }

  snapshot = (): MemoryReviewState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private change(patch: Partial<MemoryReviewState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.request = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("memory_request_timeout"));
          }, 15_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (this.request === controller) this.request = null;
    }
  }
  async load(): Promise<void> {
    if (!this.active || this.state.pending !== null) return;
    const generation = ++this.generation;
    this.request?.abort();
    // Never show stale words while refreshing permission/source eligibility.
    this.change({ ...empty() });
    try {
      const items = await this.bounded((signal) => this.port.list(signal));
      if (this.active && generation === this.generation) this.change({ phase: "ready", items });
    } catch {
      if (this.active && generation === this.generation)
        this.change({ phase: "read_error", items: [] });
    }
  }
  selected(): ReviewMemory | undefined {
    return this.state.items.find((item) => item.id === this.state.selectedId);
  }
  open(id: string, pane: "source" | "keep" | "remove"): void {
    if (!this.active || this.state.pending !== null) return;
    const item = this.state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (pane !== "source" && item.authorId !== this.viewerId) return;
    if (pane === "keep" && item.state !== "suggested") return;
    if (pane === "remove" && item.state !== "kept") return;
    this.change({ selectedId: id, pane, actionFailed: false, notice: null });
  }
  cancel(): void {
    if (this.state.pending === null)
      this.change({ pane: "list", selectedId: null, actionFailed: false });
  }
  async act(action: MemoryAction, id: string): Promise<void> {
    if (!this.active || this.state.pending !== null) return;
    const item = this.state.items.find((candidate) => candidate.id === id);
    if (!item || item.authorId !== this.viewerId) return;
    if (
      action === "keep" &&
      (item.state !== "suggested" || this.state.pane !== "keep" || this.state.selectedId !== id)
    )
      return;
    if (
      action === "remove" &&
      (item.state !== "kept" || this.state.pane !== "remove" || this.state.selectedId !== id)
    )
      return;
    if (action === "dismiss" && item.state !== "suggested") return;
    const identity = JSON.stringify([id, item.revision, action]);
    let key = this.keys.get(identity);
    if (key === undefined) {
      key = this.nextKey();
      this.keys.set(identity, key);
    }
    const generation = this.generation;
    this.change({ pending: action, actionFailed: false, notice: null });
    try {
      const result = await this.bounded((signal) =>
        this.port.mutate(
          {
            id,
            revision: item.revision,
            action,
            key,
            consentVersion: action === "keep" ? MEMORY_KEEP_TEXT_VERSION : null,
          },
          signal,
        ),
      );
      if (!this.active || generation !== this.generation) return;
      if (result.kind === "kept") {
        if (
          action !== "keep" ||
          result.item.id !== id ||
          result.item.authorId !== item.authorId ||
          result.item.revision !== item.revision ||
          result.item.quote !== item.quote ||
          result.item.state !== "kept"
        ) {
          throw new Error("memory_response_mismatch");
        }
        this.change({
          items: this.state.items.map((candidate) =>
            candidate.id === id ? result.item : candidate,
          ),
          notice: "kept",
        });
      } else {
        if (result.id !== id || (result.kind === "removed" && action === "keep"))
          throw new Error("memory_response_mismatch");
        this.change({
          items: this.state.items.filter((candidate) => candidate.id !== id),
          notice:
            result.kind === "unavailable"
              ? "unavailable"
              : action === "dismiss"
                ? "dismissed"
                : "removed",
        });
      }
      this.change({ pending: null, pane: "list", selectedId: null });
    } catch {
      if (this.active && generation === this.generation)
        this.change({ pending: null, actionFailed: true });
    }
  }
  dispose(): void {
    this.generation++;
    this.request?.abort();
    this.keys.clear();
    this.state = empty();
    this.active = false;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}
