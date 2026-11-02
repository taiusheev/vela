import {
  MEMORY_SHARE_EXPLANATION_EN,
  MEMORY_SHARE_VERSION,
  type MemoryShareChoice,
} from "@vela/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySharingController, MemorySharingRefreshRequired } from "../data/memory-sharing.ts";
import { createMemorySharingHttpPort } from "./memory-sharing.ts";
import { SessionRequests } from "./request-session.ts";

const id = (n: number) => `abcdefab-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://synthetic.example";
const quote = "The umbrella danced away.";
const view = () => ({
  memory_id: id(10),
  author_id: id(1),
  quote,
  revision: id(11),
  audience_complete: true,
  recipients: [{ member_id: id(2), display_name: "Alex", shared: false }],
});
const preview = () => ({
  presentation_id: id(20),
  memory_id: id(10),
  quote,
  lang: "en",
  recipients: [{ member_id: id(2), display_name: "Alex" }],
  confirmation_version: MEMORY_SHARE_VERSION,
  explanation: MEMORY_SHARE_EXPLANATION_EN,
  presentation_sha256: "a".repeat(64),
  expires_at: "2099-10-22T00:05:00Z",
});
const choice = (): MemoryShareChoice & { key: string } => ({
  presentation_id: id(20),
  presentation_sha256: "a".repeat(64),
  confirmation_version: MEMORY_SHARE_VERSION,
  key: "synthetic-confirm-key",
});
const preparation = () => ({
  memory_id: id(10),
  recipient_ids: [id(2)],
  key: "synthetic-prepare-key",
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const signal = () => new AbortController().signal;
const owners: SessionRequests[] = [];
afterEach(() => {
  for (const owner of owners.splice(0)) owner.end("synthetic:session");
  vi.useRealTimers();
});
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const requests = new SessionRequests();
  owners.push(requests);
  requests.activate("synthetic:session");
  const fetcher = vi.fn<typeof fetch>(async () => json(view()));
  const getToken = vi.fn(async (): Promise<string | null> => "synthetic-token");
  const options = {
    origin,
    sessionScope: "synthetic:session",
    familyId: id(5),
    authorId: id(1),
    memoryId: id(10),
    requests,
    fetcher,
    getToken,
  };
  const port = createMemorySharingHttpPort(options);
  return { port, options, fetcher, requests, getToken };
}
async function review(h: ReturnType<typeof setup>) {
  h.fetcher.mockResolvedValueOnce(json({ id: id(20) })).mockResolvedValueOnce(json(preview()));
  await h.port.prepare(preparation(), signal());
  h.fetcher.mockClear();
}

describe("unwired session-owned memory-sharing HTTP port", () => {
  it("does no work on construction and sends a private authenticated no-store read", async () => {
    const h = setup();
    expect(h.fetcher).not.toHaveBeenCalled();
    await expect(h.port.read(signal())).resolves.toEqual(view());
    expect(h.fetcher).toHaveBeenCalledExactlyOnceWith(
      `${origin}/v1/families/${id(5)}/memories/${id(10)}/sharing`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers: { accept: "application/json", authorization: "Bearer synthetic-token" },
      }),
    );
  });
  it.each([
    "https://other.example/path",
    "https://name:secret@synthetic.example",
    "https://synthetic.example?secret=x",
    "https://synthetic.example#x",
    "http://synthetic.example",
    "invalid",
  ])("refuses an unsafe origin %s before credentials/network", (origin) => {
    const h = setup();
    expect(() => createMemorySharingHttpPort({ ...h.options, origin })).toThrow(
      "sharing_configuration_invalid",
    );
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each(["familyId", "authorId", "memoryId", "sessionScope"] as const)(
    "rejects malformed %s",
    (field) => {
      const h = setup();
      expect(() => createMemorySharingHttpPort({ ...h.options, [field]: "" })).toThrow(
        "sharing_configuration_invalid",
      );
    },
  );
  it("copies its immutable target rather than retaining a mutable options object", async () => {
    const h = setup();
    h.options.familyId = id(99);
    h.options.memoryId = id(99);
    h.options.sessionScope = "other";
    await h.port.read(signal());
    expect(h.fetcher.mock.calls[0]?.[0]).toContain(`/families/${id(5)}/memories/${id(10)}/`);
  });
  it("canonicalizes route UUIDs and selected recipient IDs", async () => {
    const h = setup();
    const port = createMemorySharingHttpPort({
      ...h.options,
      familyId: id(5).toUpperCase(),
      authorId: id(1).toUpperCase(),
      memoryId: id(10).toUpperCase(),
    });
    h.fetcher.mockResolvedValueOnce(json({ id: id(20) })).mockResolvedValueOnce(json(preview()));
    await port.prepare({ ...preparation(), recipient_ids: [id(2).toUpperCase()] }, signal());
    expect(h.fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ recipient_ids: [id(2)] }));
  });
  it("prepares only IDs then reads the exact preview separately without a write key", async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(json({ id: id(20) })).mockResolvedValueOnce(json(preview()));
    await expect(h.port.prepare(preparation(), signal())).resolves.toEqual(preview());
    expect(h.fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ recipient_ids: [id(2)] }),
      headers: { "idempotency-key": preparation().key },
    });
    expect(h.fetcher.mock.calls[1]?.[0]).toBe(
      `${origin}/v1/families/${id(5)}/memory-sharing-presentations/${id(20)}`,
    );
    expect(h.fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty("idempotency-key");
    expect(h.getToken).toHaveBeenCalledTimes(2);
  });
  it.each([
    { recipient_ids: [] },
    { recipient_ids: [id(2), id(2).toUpperCase()] },
    { recipient_ids: ["invalid"] },
  ])("rejects invalid audiences before sending %j", async ({ recipient_ids }) => {
    const h = setup();
    await expect(h.port.prepare({ ...preparation(), recipient_ids }, signal())).rejects.toThrow();
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("sends only the exact confirmation proof and verifies the content-free receipt target", async () => {
    const h = setup();
    await review(h);
    h.fetcher.mockResolvedValueOnce(json({ shared: true, id: id(10) }));
    await h.port.confirm(choice(), signal());
    const { key: _, ...body } = choice();
    expect(h.fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(body),
      headers: { "idempotency-key": choice().key },
    });
    h.fetcher.mockResolvedValueOnce(json({ shared: true, id: id(99) }));
    await expect(h.port.confirm(choice(), signal())).rejects.toThrow("sharing_response_invalid");
  });
  it("stops with an empty body even if the detail route is missing", async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({ stopped: true }));
    await expect(h.port.read(signal())).resolves.toBeNull();
    await h.port.stop({ memory_id: id(10), key: "synthetic-stop-key" }, signal());
    expect(h.fetcher.mock.calls[1]?.[0]).toContain(`/memories/${id(10)}/sharing/stop`);
    expect(h.fetcher.mock.calls[1]?.[1]).toMatchObject({
      body: "{}",
      headers: { "idempotency-key": "synthetic-stop-key" },
    });
  });
  it.each(["prepare", "stop"] as const)("refuses retargeted %s before sending", async (action) => {
    const h = setup();
    await expect(h.port[action]({ ...preparation(), memory_id: id(99) }, signal())).rejects.toThrow(
      "sharing_target_invalid",
    );
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("refuses missing/invalid action keys without sending", async () => {
    const h = setup();
    await expect(h.port.stop({ memory_id: id(10), key: "" }, signal())).rejects.toThrow(
      "sharing_key_invalid",
    );
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { ...view(), author_id: id(99) },
    { ...view(), memory_id: id(99) },
    { ...view(), audience_complete: false },
    { ...view(), source_answer_id: id(99) },
    {
      ...view(),
      recipients: [
        view().recipients[0],
        { ...view().recipients[0], member_id: id(2).toUpperCase() },
      ],
    },
  ])("rejects wrong-target/incomplete/extra-field/duplicate author responses", async (value) => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(json(value));
    await expect(h.port.read(signal())).rejects.toThrow("sharing_response_invalid");
  });
  it.each([
    { ...preview(), presentation_id: id(99) },
    { ...preview(), memory_id: id(99) },
    { ...preview(), recipients: [{ member_id: id(99), display_name: "Mira" }] },
    { ...preview(), recipients: [preview().recipients[0], preview().recipients[0]] },
  ])("rejects a preview for another presentation/memory/audience", async (value) => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(json({ id: id(20) })).mockResolvedValueOnce(json(value));
    await expect(h.port.prepare(preparation(), signal())).rejects.toThrow(
      "sharing_response_invalid",
    );
  });
  it.each([404, 409])("requires new review after prepare status %s", async (status) => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(json({ error: { private: quote } }, status));
    await expect(h.port.prepare(preparation(), signal())).rejects.toBeInstanceOf(
      MemorySharingRefreshRequired,
    );
  });
  it("requires fresh review after an unavailable separate preview", async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(json({ id: id(20) })).mockResolvedValueOnce(json({}, 404));
    await expect(h.port.prepare(preparation(), signal())).rejects.toBeInstanceOf(
      MemorySharingRefreshRequired,
    );
  });
  it("does not retry stale confirmation or surface server error details", async () => {
    const h = setup();
    await review(h);
    const response = json({ error: { code: quote } }, 409);
    const readBody = vi.spyOn(response, "json");
    h.fetcher.mockResolvedValueOnce(response);
    await expect(h.port.confirm(choice(), signal())).rejects.toThrow("sharing_review_required");
    expect(readBody).not.toHaveBeenCalled();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it("cannot confirm an unreviewed or retargeted proof even for the same signed-in author", async () => {
    const h = setup();
    h.fetcher.mockResolvedValue(json({ shared: true, id: id(10) }));
    await expect(h.port.confirm(choice(), signal())).rejects.toThrow("sharing_review_required");
    expect(h.fetcher).not.toHaveBeenCalled();
    h.fetcher.mockImplementation(async () => json(view()));
    await review(h);
    await expect(
      h.port.confirm({ ...choice(), presentation_id: id(99) }, signal()),
    ).rejects.toThrow("sharing_review_required");
    await expect(
      h.port.confirm({ ...choice(), presentation_sha256: "b".repeat(64) }, signal()),
    ).rejects.toThrow("sharing_review_required");
    expect(h.fetcher).not.toHaveBeenCalled();
    await h.port.read(signal());
    h.fetcher.mockClear();
    await expect(h.port.confirm(choice(), signal())).rejects.toThrow("sharing_review_required");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("preserves the same proof and key after an ambiguous network failure for explicit retry", async () => {
    const h = setup();
    await review(h);
    h.fetcher
      .mockRejectedValueOnce(new Error(quote))
      .mockResolvedValueOnce(json({ shared: true, id: id(10) }));
    await expect(h.port.confirm(choice(), signal())).rejects.toThrow("sharing_network_failed");
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await h.port.confirm(choice(), signal());
    expect(h.fetcher.mock.calls[0]?.[0]).toEqual(h.fetcher.mock.calls[1]?.[0]);
    expect(h.fetcher.mock.calls[0]?.[1]?.body).toEqual(h.fetcher.mock.calls[1]?.[1]?.body);
    expect(h.fetcher.mock.calls[0]?.[1]?.headers).toEqual(h.fetcher.mock.calls[1]?.[1]?.headers);
  });
  it("refuses a followed redirect even if a fetch implementation ignores redirect:error", async () => {
    const h = setup();
    const response = json(view());
    Object.defineProperty(response, "redirected", { value: true });
    h.fetcher.mockResolvedValueOnce(response);
    await expect(h.port.read(signal())).rejects.toThrow("sharing_response_invalid");
  });
  it.each([401, 403, 429, 503])(
    "fails closed for status %s without parsing private error bodies",
    async (status) => {
      const h = setup();
      const response = json({ error: { code: quote } }, status);
      const readBody = vi.spyOn(response, "json");
      h.fetcher.mockResolvedValueOnce(response);
      await expect(h.port.read(signal())).rejects.toThrow(`sharing_request_${status}`);
      expect(readBody).not.toHaveBeenCalled();
    },
  );
  it("refuses null credentials and old session scopes before network", async () => {
    const h = setup();
    h.getToken.mockResolvedValueOnce(null);
    await expect(h.port.read(signal())).rejects.toThrow("sharing_authentication_required");
    h.requests.activate("other:session");
    await expect(h.port.read(signal())).rejects.toMatchObject({ reason: "session" });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("cancels a credential wait without sending its eventual token", async () => {
    const h = setup();
    const credential = deferred<string>();
    h.getToken.mockReturnValueOnce(credential.promise);
    const abort = new AbortController();
    const pending = h.port.read(abort.signal);
    const refused = expect(pending).rejects.toMatchObject({ reason: "cancelled" });
    abort.abort();
    await refused;
    credential.resolve("synthetic-late-token");
    await Promise.resolve();
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("never returns a body completed after an account change", async () => {
    const h = setup();
    const body = deferred<unknown>();
    const entered = deferred<void>();
    const response = json({});
    response.json = async () => {
      entered.resolve();
      return body.promise;
    };
    h.fetcher.mockResolvedValueOnce(response);
    const pending = h.port.read(signal());
    const refused = expect(pending).rejects.toMatchObject({ reason: "session" });
    await entered.promise;
    h.requests.activate("other:session");
    await refused;
    body.resolve(view());
  });
  it("does not fetch a prepared quote after switching accounts between POST and GET", async () => {
    const h = setup();
    const response = json({ id: id(20) });
    response.json = async () => {
      h.requests.activate("other:session");
      return { id: id(20) };
    };
    h.fetcher.mockResolvedValueOnce(response);
    await expect(h.port.prepare(preparation(), signal())).rejects.toMatchObject({
      reason: "session",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it("times out a stalled fetch even when the transport ignores abort", async () => {
    vi.useFakeTimers();
    const h = setup();
    h.fetcher.mockImplementationOnce(() => new Promise(() => {}));
    const pending = h.port.read(signal());
    const refused = expect(pending).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(15_000);
    await refused;
  });
  it.each([
    new Response("not json"),
    new Response("broken", { headers: { "content-type": "application/json" } }),
  ])("rejects malformed success bodies safely", async (response) => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(response);
    await expect(h.port.read(signal())).rejects.toThrow("sharing_response_invalid");
  });
  it("drives controller review, confirmation and independent stop through HTTP-shaped responses", async () => {
    const h = setup();
    let shared = false;
    h.fetcher.mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.endsWith("/sharing/stop")) {
        shared = false;
        return json({ stopped: true });
      }
      if (path.endsWith("/memory-sharing/confirm")) {
        shared = true;
        return json({ shared: true, id: id(10) });
      }
      if (path.endsWith("/presentations")) return json({ id: id(20) });
      if (path.includes("/memory-sharing-presentations/")) return json(preview());
      expect(init?.method).toBe("GET");
      const state = view();
      if (state.recipients[0]) state.recipients[0].shared = shared;
      return json(state);
    });
    const controller = new MemorySharingController(
      id(1),
      id(10),
      h.port,
      () => "synthetic-action-key",
    );
    try {
      await controller.load();
      controller.toggle(id(2));
      await controller.prepare();
      expect(controller.snapshot().preview?.quote).toBe(quote);
      await controller.confirm();
      expect(controller.snapshot().view?.recipients[0]?.shared).toBe(true);
      h.fetcher.mockRejectedValueOnce(new Error("synthetic-read-failure"));
      await controller.load();
      expect(controller.snapshot().view).toBeNull();
      expect(controller.canStop()).toBe(true);
      await controller.stop();
      expect(shared).toBe(false);
      expect(controller.snapshot().notice).toBe("updated");
    } finally {
      controller.dispose();
    }
  });
});
