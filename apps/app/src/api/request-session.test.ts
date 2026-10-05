import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRequests } from "./request-session.ts";

afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("session-owned requests", () => {
  it("refuses an already returned credential if its caller resumes after an account switch", async () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    const token = await requests.credential("first:session", async () => "synthetic-first-token");
    requests.activate("second:session");
    const operation = vi.fn(async () => "must not send");
    await expect(requests.authenticated(token, operation)).rejects.toMatchObject({
      reason: "session",
    });
    expect(operation).not.toHaveBeenCalled();
    const current = await requests.credential(
      "second:session",
      async () => "synthetic-second-token",
    );
    await expect(requests.authenticated(current, async () => "current account")).resolves.toBe(
      "current account",
    );
  });

  it("does not register a cancelled credential read after the same scope reopens", async () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    const response = deferred<string>();
    const pending = requests.credential("first:session", () => response.promise);
    const refused = expect(pending).rejects.toMatchObject({ reason: "session" });
    requests.end("first:session");
    requests.resume("first:session");
    response.resolve("synthetic-cancelled-token");
    await refused;
    await expect(
      requests.authenticated("synthetic-cancelled-token", async () => "must not send"),
    ).rejects.toMatchObject({ reason: "session" });
  });

  it("refuses a delayed provider sign-out after another identity becomes active", () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    requests.end("first:session");
    expect(() => requests.assertEndingScope("first:session")).not.toThrow();
    requests.activate("second:session");
    expect(() => requests.assertEndingScope("first:session")).toThrow("cancelled");
    expect(() => requests.assertScope("first:session")).toThrow("cancelled");
    expect(() => requests.assertScope("second:session")).not.toThrow();
  });
  it("aborts outstanding work and refuses a late response when the account changes", async () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    const response = deferred<string>();
    let requestSignal: AbortSignal | undefined;
    const pending = requests.run((signal) => {
      requestSignal = signal;
      return response.promise;
    });
    const refused = expect(pending).rejects.toMatchObject({ reason: "session" });
    requests.activate("second:session");
    expect(requestSignal?.aborted).toBe(true);
    response.resolve("previous family's answer");
    await refused;
    await expect(requests.run(async () => "current family")).resolves.toBe("current family");
  });

  it("ends work immediately at sign-out and prevents new requests until reactivation", async () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    const pending = requests.run(() => new Promise<never>(() => {}));
    const refused = expect(pending).rejects.toMatchObject({ reason: "session" });
    requests.end("first:session");
    await refused;
    const operation = vi.fn(async () => "should not start");
    await expect(requests.run(operation)).rejects.toMatchObject({ reason: "session" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("ignores cleanup and a failed sign-out belonging to an older account", async () => {
    const requests = new SessionRequests();
    requests.activate("second:session");
    requests.end("first:session");
    expect(requests.resume("first:session")).toBe(false);
    await expect(requests.runInScope("second:session", async () => "current")).resolves.toBe(
      "current",
    );
  });

  it("allows effect replay and a failed sign-out to reopen the same scope without old work", async () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    requests.end("first:session");
    expect(requests.resume("first:session")).toBe(true);
    await expect(requests.run(async () => "new attempt")).resolves.toBe("new attempt");
  });

  it("rejects a delayed credential read from a departed session", async () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    const credential = deferred<string>();
    const pending = requests.runInScope("first:session", () => credential.promise);
    const refused = expect(pending).rejects.toMatchObject({ reason: "session" });
    requests.activate("second:session");
    credential.resolve("synthetic old credential");
    await refused;
    const read = vi.fn(async () => "should not read");
    await expect(requests.runInScope("first:session", read)).rejects.toMatchObject({
      reason: "session",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("times out even when the transport does not acknowledge cancellation", async () => {
    vi.useFakeTimers();
    const requests = new SessionRequests();
    let signal: AbortSignal | undefined;
    const pending = requests.run((current) => {
      signal = current;
      return new Promise<never>(() => {});
    });
    const refused = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
      reason: "timeout",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await refused;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("respects caller cancellation and never starts a pre-cancelled request", async () => {
    const requests = new SessionRequests();
    const external = new AbortController();
    const pending = requests.run(() => new Promise<never>(() => {}), external.signal);
    const refused = expect(pending).rejects.toMatchObject({ reason: "cancelled" });
    external.abort();
    await refused;
    const operation = vi.fn(async () => "should not start");
    await expect(requests.run(operation, external.signal)).rejects.toMatchObject({
      reason: "cancelled",
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it("does not cancel work on ordinary rerenders of the same session", async () => {
    const requests = new SessionRequests();
    requests.activate("first:session");
    const response = deferred<string>();
    const pending = requests.run(() => response.promise);
    requests.activate("first:session");
    response.resolve("answer");
    await expect(pending).resolves.toBe("answer");
  });
});
