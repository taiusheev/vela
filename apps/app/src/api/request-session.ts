/** Network work belongs to the session that started it, including response-body reads. */
export class RequestInterrupted extends Error {
  readonly reason: "session" | "timeout" | "cancelled";
  constructor(reason: "session" | "timeout" | "cancelled") {
    super(
      reason === "timeout" ? "The request timed out. Try again." : "The request was cancelled.",
    );
    this.name = reason === "timeout" ? "TimeoutError" : "AbortError";
    this.reason = reason;
  }
}

export function assertRequestActive(signal: AbortSignal): void {
  if (signal.aborted) throw new RequestInterrupted("cancelled");
}

export class SessionRequests {
  private scope: string | undefined;
  private generation = 0;
  private closed = false;
  private pending = new Set<AbortController>();
  private credentials = new Set<string>();

  activate(scope: string): void {
    if (this.scope === scope && !this.closed) return;
    this.cancel();
    this.scope = scope;
    this.closed = false;
  }

  end(scope: string): void {
    if (this.scope !== scope) return;
    this.closed = true;
    this.cancel();
  }

  /** A failed sign-out may reopen its own scope, but cannot replace a newer account. */
  resume(scope: string): boolean {
    if (this.scope !== scope) return false;
    this.activate(scope);
    return true;
  }

  assertScope(scope: string): void {
    if (this.closed || this.scope !== scope) throw new RequestInterrupted("session");
  }

  assertEndingScope(scope: string): void {
    if (this.scope !== scope || !this.closed) throw new RequestInterrupted("session");
  }

  assertToken(token: string | null): void {
    if (
      this.closed ||
      (this.scope !== undefined && token !== null && !this.credentials.has(token))
    ) {
      throw new RequestInterrupted("session");
    }
  }

  async credential(scope: string, read: () => Promise<string | null>): Promise<string | null> {
    this.assertScope(scope);
    const generation = this.generation;
    return this.run(async (signal) => {
      const token = await read();
      assertRequestActive(signal);
      if (generation !== this.generation) throw new RequestInterrupted("session");
      this.assertScope(scope);
      if (token !== null) {
        this.credentials.add(token);
        // Keep session tokens only in bounded memory. An evicted caller obtains a fresh token.
        if (this.credentials.size > 32) {
          const oldest = this.credentials.values().next().value;
          if (oldest !== undefined) this.credentials.delete(oldest);
        }
      }
      return token;
    });
  }

  async authenticated<T>(
    token: string | null,
    operation: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
  ): Promise<T> {
    this.assertToken(token);
    return this.run(operation, external);
  }

  async runInScope<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    this.assertScope(scope);
    return this.run(async () => {
      const result = await operation();
      this.assertScope(scope);
      return result;
    });
  }

  private cancel(): void {
    this.generation += 1;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    this.credentials.clear();
  }

  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.closed) throw new RequestInterrupted("session");
    if (external?.aborted) throw new RequestInterrupted("cancelled");
    const generation = this.generation;
    const controller = new AbortController();
    this.pending.add(controller);
    let reason: "session" | "timeout" | "cancelled" = "session";
    const cancelExternal = () => {
      reason = "cancelled";
      controller.abort();
    };
    external?.addEventListener("abort", cancelExternal, { once: true });
    if (external?.aborted) cancelExternal();
    const timer = setTimeout(() => {
      reason = "timeout";
      controller.abort();
    }, timeoutMs);
    let rejectCancellation: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancellation = () => reject(new RequestInterrupted(reason));
      controller.signal.addEventListener("abort", rejectCancellation, { once: true });
      if (controller.signal.aborted) rejectCancellation();
    });
    try {
      assertRequestActive(controller.signal);
      const result = await Promise.race([operation(controller.signal), cancelled]);
      if (generation !== this.generation) throw new RequestInterrupted("session");
      assertRequestActive(controller.signal);
      return result;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", cancelExternal);
      if (rejectCancellation !== undefined) {
        controller.signal.removeEventListener("abort", rejectCancellation);
      }
      this.pending.delete(controller);
    }
  }
}

export const sessionRequests = new SessionRequests();
