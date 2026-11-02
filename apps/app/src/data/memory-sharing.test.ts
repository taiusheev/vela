import {
  MEMORY_SHARE_EXPLANATION_EN,
  MEMORY_SHARE_VERSION,
  type MemorySharingView,
} from "@vela/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemorySharingController,
  type MemorySharingPort,
  MemorySharingRefreshRequired,
} from "./memory-sharing.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const controllers: MemorySharingController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Synthetic deferred not initialized");
  };
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup(viewer = id(1), memory = id(10)) {
  const clock = { value: Date.parse("2026-10-22T00:00:00Z") };
  const view: MemorySharingView = {
    memory_id: id(10),
    author_id: id(1),
    quote: "The cat stole my picnic chair.",
    revision: id(11),
    audience_complete: true,
    recipients: [
      { member_id: id(2), display_name: "Alex", shared: false },
      { member_id: id(3), display_name: "Mira", shared: false },
    ],
  };
  let selected: string[] = [];
  const preview = () => ({
    presentation_id: id(20),
    memory_id: view.memory_id,
    quote: view.quote,
    lang: "en",
    recipients: view.recipients
      .filter((r) => selected.includes(r.member_id))
      .map(({ member_id, display_name }) => ({ member_id, display_name })),
    confirmation_version: MEMORY_SHARE_VERSION,
    explanation: MEMORY_SHARE_EXPLANATION_EN,
    presentation_sha256: "a".repeat(64),
    expires_at: new Date(clock.value + 300_000).toISOString(),
  });
  const read = vi.fn(async () => structuredClone(view) as unknown);
  const prepare = vi.fn<MemorySharingPort["prepare"]>(async (input) => {
    selected = input.recipient_ids;
    return preview();
  });
  const confirm = vi.fn<MemorySharingPort["confirm"]>(async () => {
    for (const r of view.recipients) r.shared = selected.includes(r.member_id);
  });
  const stop = vi.fn<MemorySharingPort["stop"]>(async () => {
    for (const r of view.recipients) r.shared = false;
    view.revision = id(12);
  });
  let sequence = 0;
  const controller = new MemorySharingController(
    viewer,
    memory,
    { read, prepare, confirm, stop },
    () => `synthetic-sharing-${++sequence}`,
    () => clock.value,
  );
  controllers.push(controller);
  return { controller, view, clock, read, prepare, confirm, stop, preview };
}

describe("session-scoped memory sharing", () => {
  it("does not label a newer refresh expired when an older conflict-refresh finishes late", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    await h.controller.prepare();
    h.confirm.mockRejectedValueOnce(new MemorySharingRefreshRequired());
    const held = deferred<unknown>();
    const entered = deferred<void>();
    h.read.mockImplementationOnce(async () => {
      entered.resolve();
      return held.promise;
    });
    const conflict = h.controller.confirm();
    await entered.promise;
    await h.controller.load();
    held.resolve(h.view);
    await conflict;
    expect(h.controller.snapshot().phase).toBe("ready");
    expect(h.controller.snapshot().error).toBeNull();
  });
  it("reloads and rotates the preparation key after a missing or consumed presentation", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    h.prepare.mockRejectedValueOnce(new MemorySharingRefreshRequired());
    await h.controller.prepare();
    expect(h.controller.snapshot().preview).toBeNull();
    expect(h.controller.snapshot().selected).toEqual([]);
    expect(h.controller.snapshot().error).toBe("expired");
    h.controller.toggle(id(2));
    await h.controller.prepare();
    expect(h.prepare.mock.calls[0]?.[0].key).not.toBe(h.prepare.mock.calls[1]?.[0].key);
  });
  it("requires a new named review after stale confirmation instead of retrying the old proof", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    await h.controller.prepare();
    h.confirm.mockRejectedValueOnce(new MemorySharingRefreshRequired());
    await h.controller.confirm();
    expect(h.controller.snapshot().preview).toBeNull();
    expect(h.controller.snapshot().error).toBe("expired");
    await h.controller.confirm();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    h.controller.toggle(id(3));
    await h.controller.prepare();
    await h.controller.confirm();
    expect(h.confirm.mock.calls[0]?.[0].key).not.toBe(h.confirm.mock.calls[1]?.[0].key);
    expect(h.controller.snapshot().selected).toEqual([id(3)]);
  });
  it("hides old words and preserves independent revocation if stale-proof refresh fails", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    await h.controller.prepare();
    h.confirm.mockRejectedValueOnce(new MemorySharingRefreshRequired());
    h.read.mockRejectedValueOnce(new Error("synthetic-refresh-failure"));
    await h.controller.confirm();
    expect(h.controller.snapshot().phase).toBe("read_error");
    expect(h.controller.snapshot().view).toBeNull();
    expect(h.controller.snapshot().preview).toBeNull();
    expect(h.controller.canStop()).toBe(true);
    expect(h.controller.snapshot().notice).toBeNull();
  });
  it("can stop sharing after the very first detail read fails, without exposing old words", async () => {
    const h = setup();
    for (const recipient of h.view.recipients) recipient.shared = true;
    h.read.mockRejectedValueOnce(new Error("synthetic_read_failure"));
    await h.controller.load();
    expect(h.controller.snapshot().phase).toBe("read_error");
    expect(h.controller.snapshot().view).toBeNull();
    expect(h.controller.canStop()).toBe(true);
    await h.controller.stop();
    expect(h.stop.mock.calls[0]?.[0]).toEqual({ memory_id: id(10), key: "synthetic-sharing-1" });
    expect(h.controller.snapshot().view?.recipients.some((r) => r.shared)).toBe(false);
    expect(h.controller.snapshot().notice).toBe("updated");
  });
  it("can revoke while details stay unavailable without claiming a successful refresh", async () => {
    const h = setup();
    for (const recipient of h.view.recipients) recipient.shared = true;
    h.read.mockResolvedValue(null);
    await h.controller.load();
    await h.controller.stop();
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.view.recipients.some((r) => r.shared)).toBe(false);
    expect(h.controller.snapshot().phase).toBe("unavailable");
    expect(h.controller.snapshot().view).toBeNull();
    expect(h.controller.snapshot().notice).toBeNull();
  });
  it("keeps a fallback stop visible during a request, ignores duplicate taps and reuses failed keys", async () => {
    const h = setup();
    h.read.mockRejectedValueOnce(new Error("synthetic_read_failure"));
    await h.controller.load();
    h.stop.mockRejectedValueOnce(new Error("synthetic_stop_failure"));
    await h.controller.stop();
    expect(h.controller.snapshot().error).toBe("action");
    const held = deferred<void>();
    h.stop.mockImplementationOnce(() => held.promise);
    const retry = h.controller.stop();
    expect(h.controller.canStop()).toBe(true);
    await h.controller.stop();
    expect(h.stop).toHaveBeenCalledTimes(2);
    expect(h.stop.mock.calls[0]?.[0]).toEqual(h.stop.mock.calls[1]?.[0]);
    held.resolve();
    await retry;
  });
  it("never displays a different memory returned by the server or retargets revocation to it", async () => {
    const h = setup();
    h.view.memory_id = id(99);
    await h.controller.load();
    expect(h.controller.snapshot().phase).toBe("unavailable");
    expect(h.controller.snapshot().view).toBeNull();
    await h.controller.prepare();
    expect(h.prepare).not.toHaveBeenCalled();
    await h.controller.stop();
    expect(h.stop.mock.calls[0]?.[0].memory_id).toBe(id(10));
  });
  it.each([
    ["invalid", id(10)],
    [id(1), "invalid"],
  ])("makes no requests for malformed scope %s/%s", async (viewer, memory) => {
    const h = setup(viewer, memory);
    await h.controller.load();
    expect(h.controller.canStop()).toBe(false);
    await h.controller.stop();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });
  it("never revokes from a disposed failed-read session", async () => {
    const h = setup();
    h.read.mockRejectedValueOnce(new Error("synthetic_read_failure"));
    await h.controller.load();
    h.controller.dispose();
    expect(h.controller.canStop()).toBe(false);
    await h.controller.stop();
    expect(h.stop).not.toHaveBeenCalled();
  });
  it("ignores a fallback stop response that arrives after account disposal", async () => {
    const h = setup();
    h.read.mockRejectedValueOnce(new Error("synthetic_read_failure"));
    await h.controller.load();
    const held = deferred<void>();
    h.stop.mockImplementationOnce(() => held.promise);
    const pending = h.controller.stop();
    h.controller.dispose();
    held.resolve();
    await pending;
    expect(h.controller.snapshot().view).toBeNull();
    expect(h.controller.snapshot().notice).toBeNull();
    expect(h.controller.canStop()).toBe(false);
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it("starts private, selects no one automatically and cannot confirm without a fresh preview", async () => {
    const h = setup();
    await h.controller.load();
    expect(h.controller.snapshot().selected).toEqual([]);
    await h.controller.prepare();
    await h.controller.confirm();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
    h.controller.toggle(id(99));
    expect(h.controller.snapshot().selected).toEqual([]);
  });
  it("prepares only chosen IDs, shows exact server words/names, and re-reads after confirmation", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    await h.controller.prepare();
    expect(h.prepare.mock.calls[0]?.[0].recipient_ids).toEqual([id(2)]);
    expect(h.controller.snapshot().preview?.recipients.map((r) => r.display_name)).toEqual([
      "Alex",
    ]);
    expect(h.controller.snapshot().view?.recipients.some((r) => r.shared)).toBe(false);
    await h.controller.confirm();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(
      h.controller
        .snapshot()
        .view?.recipients.filter((r) => r.shared)
        .map((r) => r.member_id),
    ).toEqual([id(2)]);
    expect(h.confirm.mock.calls[0]?.[0]).toEqual({
      presentation_id: id(20),
      presentation_sha256: "a".repeat(64),
      confirmation_version: MEMORY_SHARE_VERSION,
      key: "synthetic-sharing-2",
    });
  });
  it("does not change sharing when confirmation is cancelled", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    await h.controller.prepare();
    h.controller.cancel();
    await h.controller.confirm();
    expect(h.controller.snapshot().preview).toBeNull();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.view.recipients.some((r) => r.shared)).toBe(false);
  });
  it("ignores duplicate taps and changed selections during an in-flight preparation", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    const held = deferred<unknown>();
    h.prepare.mockImplementationOnce(() => held.promise);
    const first = h.controller.prepare();
    await h.controller.prepare();
    h.controller.toggle(id(3));
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.controller.snapshot().selected).toEqual([id(2)]);
    held.resolve({ ...h.preview(), recipients: [{ member_id: id(2), display_name: "Alex" }] });
    await first;
    expect(h.controller.snapshot().preview).not.toBeNull();
  });
  it("retries failed preparation and confirmation with stable keys", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    h.prepare.mockRejectedValueOnce(new Error("synthetic offline"));
    await h.controller.prepare();
    await h.controller.prepare();
    expect(h.prepare.mock.calls[0]?.[0].key).toBe(h.prepare.mock.calls[1]?.[0].key);
    h.confirm.mockRejectedValueOnce(new Error("synthetic offline"));
    await h.controller.confirm();
    expect(h.controller.snapshot().error).toBe("action");
    await h.controller.confirm();
    expect(h.confirm.mock.calls[0]?.[0]).toEqual(h.confirm.mock.calls[1]?.[0]);
    expect(h.controller.snapshot().notice).toBe("updated");
  });
  it.each(["quote", "audience", "names", "memory", "version"])(
    "rejects changed %s in a prepared response",
    async (field) => {
      const h = setup();
      await h.controller.load();
      h.controller.toggle(id(2));
      h.prepare.mockImplementationOnce(async () => {
        const base = { ...h.preview(), recipients: [{ member_id: id(2), display_name: "Alex" }] };
        return field === "quote"
          ? { ...base, quote: "Unchosen words" }
          : field === "audience"
            ? {
                ...base,
                recipients: [...base.recipients, { member_id: id(3), display_name: "Mira" }],
              }
            : field === "names"
              ? { ...base, recipients: [{ member_id: id(2), display_name: "Someone else" }] }
              : field === "memory"
                ? { ...base, memory_id: id(99) }
                : { ...base, confirmation_version: "memory.share@0" };
      });
      await h.controller.prepare();
      await h.controller.confirm();
      expect(h.controller.snapshot().phase).toBe("unavailable");
      expect(h.controller.snapshot().view).toBeNull();
      expect(h.confirm).not.toHaveBeenCalled();
    },
  );
  it("renews an expired confirmation without reusing the expired prepare key", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    await h.controller.prepare();
    h.clock.value += 300_000;
    await h.controller.confirm();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.controller.snapshot().preview).toBeNull();
    expect(h.controller.snapshot().error).toBe("expired");
    await h.controller.prepare();
    expect(h.prepare.mock.calls[1]?.[0].key).not.toBe(h.prepare.mock.calls[0]?.[0].key);
    expect(h.controller.snapshot().preview).not.toBeNull();
  });
  it("rejects an already expired server presentation and permits a fresh request", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    h.prepare.mockImplementationOnce(async () => ({
      ...h.preview(),
      recipients: [{ member_id: id(2), display_name: "Alex" }],
      expires_at: new Date(h.clock.value).toISOString(),
    }));
    await h.controller.prepare();
    expect(h.controller.snapshot().error).toBe("expired");
    await h.controller.prepare();
    expect(h.prepare.mock.calls[1]?.[0].key).not.toBe(h.prepare.mock.calls[0]?.[0].key);
  });
  it("stops sharing without removing the private quote, and refreshes the actual result", async () => {
    const h = setup();
    const first = h.view.recipients[0];
    if (!first) throw new Error("Missing synthetic recipient");
    first.shared = true;
    await h.controller.load();
    h.stop.mockRejectedValueOnce(new Error("synthetic offline"));
    await h.controller.stop();
    expect(h.controller.snapshot().view?.recipients[0]?.shared).toBe(true);
    await h.controller.stop();
    expect(h.stop.mock.calls[0]?.[0].key).toBe(h.stop.mock.calls[1]?.[0].key);
    expect(h.controller.snapshot().view?.recipients.some((r) => r.shared)).toBe(false);
    expect(h.controller.snapshot().view?.quote).toBe(h.view.quote);
  });
  it("does not claim sharing succeeded when the post-save read fails", async () => {
    const h = setup();
    await h.controller.load();
    h.controller.toggle(id(2));
    await h.controller.prepare();
    h.read.mockRejectedValueOnce(new Error("synthetic offline"));
    await h.controller.confirm();
    expect(h.controller.snapshot().phase).toBe("read_error");
    expect(h.controller.snapshot().view).toBeNull();
    expect(h.controller.snapshot().notice).toBeNull();
  });
  it.each(["other author", "incomplete audience", "duplicate options", "missing memory"])(
    "hides words for %s reads",
    async (field) => {
      const h = setup();
      h.read.mockResolvedValueOnce(
        field === "other author"
          ? { ...h.view, author_id: id(99) }
          : field === "incomplete audience"
            ? { ...h.view, audience_complete: false }
            : field === "duplicate options"
              ? { ...h.view, recipients: [h.view.recipients[0], h.view.recipients[0]] }
              : null,
      );
      await h.controller.load();
      expect(h.controller.snapshot().view).toBeNull();
      expect(h.controller.snapshot().phase).toBe("unavailable");
    },
  );
  it("clears words immediately on refresh and ignores old responses after account disposal", async () => {
    const h = setup();
    await h.controller.load();
    const held = deferred<unknown>();
    h.read.mockImplementationOnce(() => held.promise);
    const refresh = h.controller.load();
    expect(h.controller.snapshot().view).toBeNull();
    h.controller.dispose();
    held.resolve(h.view);
    await refresh;
    expect(h.controller.snapshot().view).toBeNull();
    const other = setup(id(99));
    await other.controller.load();
    expect(other.controller.snapshot().view).toBeNull();
  });
  it("recovers from a stalled request without accepting its later result", async () => {
    vi.useFakeTimers();
    const h = setup();
    const held = deferred<unknown>();
    h.read.mockImplementationOnce(() => held.promise);
    const pending = h.controller.load();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(h.controller.snapshot().phase).toBe("read_error");
    await h.controller.load();
    held.resolve(null);
    await Promise.resolve();
    expect(h.controller.snapshot().phase).toBe("ready");
  });
});
