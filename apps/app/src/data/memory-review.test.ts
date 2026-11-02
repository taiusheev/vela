import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_KEEP_TEXT_VERSION,
  MemoryReviewController,
  type MemoryReviewPort,
  type ReviewMemory,
} from "./memory-review.ts";

const item: ReviewMemory = {
  id: "synthetic-memory",
  authorId: "parent",
  authorName: "Example parent",
  kind: "humour",
  quote: "The cat stole my chair.",
  dateLabel: "21 October",
  expiryLabel: "Available until 20 November.",
  sourceQuestion: "What made you laugh?",
  sourceAnswer: "The cat stole my chair.",
  revision: "revision-1",
  state: "suggested",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<MemoryReviewPort> = {}, viewer = "parent") {
  const mutate = vi.fn<MemoryReviewPort["mutate"]>(async (request) =>
    request.action === "keep"
      ? { kind: "kept", item: { ...item, state: "kept" } }
      : { kind: "removed", id: request.id },
  );
  const port: MemoryReviewPort = { list: async () => [{ ...item }], mutate, ...overrides };
  let key = 0;
  const controller = new MemoryReviewController(viewer, port, () => `synthetic-key:${++key}`);
  return { controller, port, mutate };
}
afterEach(() => vi.useRealTimers());

describe("memory review decisions", () => {
  it("requires the author's explicit confirmation pane before keeping", async () => {
    const { controller, mutate } = setup();
    await controller.load();
    await controller.act("keep", item.id);
    expect(mutate).not.toHaveBeenCalled();
    controller.open(item.id, "keep");
    controller.cancel();
    await controller.act("keep", item.id);
    expect(mutate).not.toHaveBeenCalled();
    controller.open(item.id, "keep");
    await controller.act("keep", item.id);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      id: item.id,
      revision: item.revision,
      action: "keep",
      consentVersion: MEMORY_KEEP_TEXT_VERSION,
    });
    expect(controller.snapshot().notice).toBe("kept");
  });

  it("leaves words visible and unkept until a save is confirmed, and prevents duplicate taps", async () => {
    const pending = deferred<Awaited<ReturnType<MemoryReviewPort["mutate"]>>>();
    const mutate = vi.fn<MemoryReviewPort["mutate"]>(() => pending.promise);
    const { controller } = setup({ mutate });
    await controller.load();
    controller.open(item.id, "keep");
    const saving = controller.act("keep", item.id);
    await controller.act("keep", item.id);
    controller.cancel();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().pane).toBe("keep");
    expect(controller.snapshot().items[0]?.state).toBe("suggested");
    pending.resolve({ kind: "kept", item: { ...item, state: "kept" } });
    await saving;
    expect(controller.snapshot().items[0]?.state).toBe("kept");
  });

  it("preserves the decision and retries with the same key after a failed save", async () => {
    const { controller, mutate } = setup();
    mutate.mockRejectedValueOnce(new Error("Synthetic private query details"));
    await controller.load();
    controller.open(item.id, "keep");
    await controller.act("keep", item.id);
    expect(controller.snapshot()).toMatchObject({
      pane: "keep",
      pending: null,
      actionFailed: true,
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("private query");
    await controller.act("keep", item.id);
    expect(mutate.mock.calls[0]?.[0].key).toBe(mutate.mock.calls[1]?.[0].key);
    expect(controller.snapshot().notice).toBe("kept");
  });

  it("never lets a family member keep, dismiss or remove another person's words", async () => {
    const { controller, mutate } = setup({}, "child");
    await controller.load();
    controller.open(item.id, "source");
    expect(controller.snapshot().pane).toBe("source");
    controller.open(item.id, "keep");
    for (const action of ["keep", "dismiss", "remove"] as const)
      await controller.act(action, item.id);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows changed/withdrawn sources as unavailable and never claims a save", async () => {
    const { controller } = setup({ mutate: async () => ({ kind: "unavailable", id: item.id }) });
    await controller.load();
    controller.open(item.id, "keep");
    await controller.act("keep", item.id);
    expect(controller.snapshot()).toMatchObject({ items: [], pane: "list", notice: "unavailable" });
  });

  it("requires a second decision before removing a kept memory", async () => {
    const { controller, mutate } = setup({ list: async () => [{ ...item, state: "kept" }] });
    await controller.load();
    await controller.act("remove", item.id);
    expect(mutate).not.toHaveBeenCalled();
    controller.open(item.id, "remove");
    await controller.act("remove", item.id);
    expect(controller.snapshot()).toMatchObject({ items: [], notice: "removed" });
    expect(mutate.mock.calls[0]?.[0].consentVersion).toBeNull();
  });

  it("does not turn a failed dismissal into an empty list", async () => {
    const { controller, mutate } = setup();
    mutate.mockRejectedValueOnce(new Error("offline"));
    await controller.load();
    await controller.act("dismiss", item.id);
    expect(controller.snapshot().items).toHaveLength(1);
    expect(controller.snapshot().actionFailed).toBe(true);
    await controller.act("dismiss", item.id);
    expect(controller.snapshot().items).toEqual([]);
    expect(controller.snapshot().notice).toBe("dismissed");
  });

  it.each([
    { ...item, quote: "Other words", state: "kept" as const },
    { ...item, authorId: "another-person", state: "kept" as const },
    { ...item, revision: "another-revision", state: "kept" as const },
  ])("rejects a save response that changed identity, source or words", async (changed) => {
    const { controller } = setup({ mutate: async () => ({ kind: "kept", item: changed }) });
    await controller.load();
    controller.open(item.id, "keep");
    await controller.act("keep", item.id);
    expect(controller.snapshot().actionFailed).toBe(true);
    expect(controller.snapshot().items[0]).toEqual(item);
  });

  it("clears stale words while refreshing and offers recovery after a failed read", async () => {
    const read = deferred<ReviewMemory[]>();
    const list = vi
      .fn<MemoryReviewPort["list"]>()
      .mockResolvedValueOnce([item])
      .mockImplementationOnce(() => read.promise);
    const { controller } = setup({ list });
    await controller.load();
    const refresh = controller.load();
    expect(controller.snapshot()).toMatchObject({ phase: "loading", items: [] });
    read.reject(new Error("offline"));
    await refresh;
    expect(controller.snapshot()).toMatchObject({ phase: "read_error", items: [] });
    list.mockResolvedValueOnce([item]);
    await controller.load();
    expect(controller.snapshot().phase).toBe("ready");
  });

  it("ignores a late response from an old read", async () => {
    const old = deferred<ReviewMemory[]>();
    const list = vi
      .fn<MemoryReviewPort["list"]>()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce([]);
    const { controller } = setup({ list });
    const stale = controller.load();
    await controller.load();
    old.resolve([item]);
    await stale;
    expect(controller.snapshot().items).toEqual([]);
  });

  it("clears words on account changes and ignores a late save result", async () => {
    const pending = deferred<Awaited<ReturnType<MemoryReviewPort["mutate"]>>>();
    const { controller } = setup({ mutate: () => pending.promise });
    await controller.load();
    controller.open(item.id, "keep");
    const saving = controller.act("keep", item.id);
    controller.dispose();
    pending.resolve({ kind: "kept", item: { ...item, state: "kept" } });
    await saving;
    expect(controller.snapshot().items).toEqual([]);
    expect(controller.snapshot().notice).toBeNull();
  });

  it("bounds a stalled save, retains the decision and allows an idempotent retry", async () => {
    vi.useFakeTimers();
    const { controller, mutate } = setup();
    await controller.load();
    mutate.mockImplementationOnce(() => new Promise(() => {}));
    controller.open(item.id, "keep");
    const saving = controller.act("keep", item.id);
    await vi.advanceTimersByTimeAsync(15_000);
    await saving;
    expect(controller.snapshot()).toMatchObject({
      actionFailed: true,
      pending: null,
      pane: "keep",
    });
    expect(mutate.mock.calls[0]?.[1].aborted).toBe(true);
    await controller.act("keep", item.id);
    expect(mutate.mock.calls[0]?.[0].key).toBe(mutate.mock.calls[1]?.[0].key);
    expect(controller.snapshot().notice).toBe("kept");
  });
});
