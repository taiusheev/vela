import {
  MEMORY_SHARE_VERSION,
  type MemoryShareChoice,
  MemorySharePreview,
  MemorySharingView,
} from "@vela/contracts";

/** Server authorization, eligibility, audience completeness and single-use confirmation remain
 * mandatory; this controller is not authority to save or reveal a quote. */
export interface MemorySharingPort {
  read(signal: AbortSignal): Promise<unknown>;
  prepare(
    input: { memory_id: string; recipient_ids: string[]; key: string },
    signal: AbortSignal,
  ): Promise<unknown>;
  confirm(input: MemoryShareChoice & { key: string }, signal: AbortSignal): Promise<void>;
  stop(input: { memory_id: string; key: string }, signal: AbortSignal): Promise<void>;
}
/** A consumed/missing presentation or conflicting confirmation needs a NEW review and keys. */
export class MemorySharingRefreshRequired extends Error {
  constructor() {
    super("sharing_review_required");
    this.name = "MemorySharingRefreshRequired";
  }
}
export interface MemorySharingState {
  phase: "loading" | "ready" | "read_error" | "unavailable";
  view: MemorySharingView | null;
  selected: string[];
  preview: MemorySharePreview | null;
  pending: "prepare" | "confirm" | "stop" | null;
  error: "action" | "expired" | null;
  notice: "updated" | null;
}
const empty = (): MemorySharingState => ({
  phase: "loading",
  view: null,
  selected: [],
  preview: null,
  pending: null,
  error: null,
  notice: null,
});

export class MemorySharingController {
  private state = empty();
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private generation = 0;
  private active = true;
  private prepareKey: string | null = null;
  private confirmKey: string | null = null;
  private stopKey: string | null = null;
  readonly viewerId: string;
  readonly memoryId: string;
  private readonly validScope: boolean;
  private readonly port: MemorySharingPort;
  private readonly nextKey: () => string;
  private readonly now: () => number;
  constructor(
    viewerId: string,
    memoryId: string,
    port: MemorySharingPort,
    nextKey: () => string,
    now: () => number = Date.now,
  ) {
    this.viewerId = viewerId;
    this.memoryId = memoryId;
    this.validScope =
      MemorySharingView.shape.memory_id.safeParse(memoryId).success &&
      MemorySharingView.shape.author_id.safeParse(viewerId).success;
    this.port = port;
    this.nextKey = nextKey;
    this.now = now;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private change(patch: Partial<MemorySharingState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private clearKeys() {
    this.prepareKey = null;
    this.confirmKey = null;
    this.stopKey = null;
  }
  private async bounded<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const request = new AbortController();
    this.request = request;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(request.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            request.abort();
            reject(new Error("sharing_request_timeout"));
          }, 15_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (this.request === request) this.request = null;
    }
  }
  async load() {
    if (!this.active) return;
    const generation = ++this.generation;
    this.request?.abort();
    this.clearKeys();
    this.change(empty());
    if (!this.validScope) {
      this.change({ phase: "unavailable" });
      return;
    }
    try {
      const value = await this.bounded((signal) => this.port.read(signal));
      if (!this.active || this.generation !== generation) return;
      const parsed = MemorySharingView.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.author_id !== this.viewerId ||
        parsed.data.memory_id !== this.memoryId ||
        new Set(parsed.data.recipients.map((r) => r.member_id)).size !==
          parsed.data.recipients.length
      ) {
        this.change({ ...empty(), phase: "unavailable" });
        return;
      }
      this.change({
        phase: "ready",
        view: parsed.data,
        selected: parsed.data.recipients.filter((r) => r.shared).map((r) => r.member_id),
      });
    } catch {
      if (this.active && this.generation === generation)
        this.change({ ...empty(), phase: "read_error" });
    }
  }
  toggle(id: string) {
    const { view, pending, preview } = this.state;
    if (
      !this.active ||
      !view ||
      pending !== null ||
      preview !== null ||
      !view.recipients.some((r) => r.member_id === id)
    )
      return;
    this.prepareKey = null;
    this.confirmKey = null;
    this.change({
      selected: this.state.selected.includes(id)
        ? this.state.selected.filter((value) => value !== id)
        : [...this.state.selected, id],
      error: null,
      notice: null,
    });
  }
  cancel() {
    if (this.state.pending !== null) return;
    this.prepareKey = null;
    this.confirmKey = null;
    this.change({ preview: null, error: null });
  }
  async prepare() {
    const { view, selected, pending } = this.state;
    if (
      !this.active ||
      !view ||
      this.state.phase !== "ready" ||
      pending !== null ||
      selected.length === 0 ||
      this.state.preview
    )
      return;
    const generation = this.generation;
    this.prepareKey ??= this.nextKey();
    this.change({ pending: "prepare", error: null, notice: null });
    try {
      const raw = await this.bounded((signal) =>
        this.port.prepare(
          {
            memory_id: view.memory_id,
            recipient_ids: [...selected].sort(),
            key: this.prepareKey ?? "",
          },
          signal,
        ),
      );
      if (!this.active || generation !== this.generation) return;
      const parsed = MemorySharePreview.safeParse(raw);
      const valid =
        parsed.success &&
        parsed.data.memory_id === view.memory_id &&
        parsed.data.quote === view.quote &&
        parsed.data.recipients.length === selected.length &&
        new Set(parsed.data.recipients.map((r) => r.member_id)).size === selected.length &&
        parsed.data.recipients.every(
          (r) =>
            selected.includes(r.member_id) &&
            view.recipients.some(
              (option) =>
                option.member_id === r.member_id && option.display_name === r.display_name,
            ),
        );
      if (!valid || !parsed.success) {
        this.clearKeys();
        this.change({ ...empty(), phase: "unavailable" });
        return;
      }
      if (Date.parse(parsed.data.expires_at) <= this.now()) {
        this.prepareKey = null;
        this.change({ pending: null, error: "expired" });
        return;
      }
      this.change({ pending: null, preview: parsed.data });
    } catch (error) {
      if (error instanceof MemorySharingRefreshRequired) {
        if (!this.active || generation !== this.generation) return;
        await this.load();
        if (this.active && this.generation === generation + 1 && this.state.phase === "ready")
          this.change({ error: "expired" });
        return;
      }
      if (this.active && generation === this.generation)
        this.change({ pending: null, error: "action" });
    }
  }
  async confirm() {
    const { preview, pending } = this.state;
    if (!this.active || !preview || pending !== null) return;
    if (Date.parse(preview.expires_at) <= this.now()) {
      this.cancel();
      this.change({ error: "expired" });
      return;
    }
    const generation = this.generation;
    this.confirmKey ??= this.nextKey();
    this.change({ pending: "confirm", error: null });
    try {
      await this.bounded((signal) =>
        this.port.confirm(
          {
            presentation_id: preview.presentation_id,
            presentation_sha256: preview.presentation_sha256,
            confirmation_version: MEMORY_SHARE_VERSION,
            key: this.confirmKey ?? "",
          },
          signal,
        ),
      );
      if (!this.active || generation !== this.generation) return;
      await this.load();
      if (this.active && this.state.phase === "ready") this.change({ notice: "updated" });
    } catch (error) {
      if (error instanceof MemorySharingRefreshRequired) {
        if (!this.active || generation !== this.generation) return;
        await this.load();
        if (this.active && this.generation === generation + 1 && this.state.phase === "ready")
          this.change({ error: "expired" });
        return;
      }
      if (this.active && generation === this.generation)
        this.change({ pending: null, error: "action" });
    }
  }
  /** An explicit target allows free revocation even when details fail. This is a locator,
   * never authorization: the server must reauthenticate the current author on every write. */
  canStop = () =>
    this.active &&
    this.validScope &&
    this.state.phase !== "loading" &&
    !this.state.preview &&
    (!this.state.view || this.state.view.recipients.some((r) => r.shared));
  async stop() {
    if (!this.canStop() || this.state.pending !== null) return;
    const generation = this.generation;
    this.stopKey ??= this.nextKey();
    this.change({ pending: "stop", error: null });
    try {
      await this.bounded((signal) =>
        this.port.stop({ memory_id: this.memoryId, key: this.stopKey ?? "" }, signal),
      );
      if (!this.active || generation !== this.generation) return;
      await this.load();
      if (this.active && this.state.phase === "ready") this.change({ notice: "updated" });
    } catch {
      if (this.active && generation === this.generation)
        this.change({ pending: null, error: "action" });
    }
  }
  dispose() {
    this.generation++;
    this.request?.abort();
    this.clearKeys();
    this.state = empty();
    this.active = false;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}
