import { ExpoPushRequestError } from "@vela/adapters";
import { ChannelSendError } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { type PushMessage, pushFailureOf } from "./deps.ts";
import { createFakePush, fakeTicketId, pushFailureFor } from "./testing/fake-push.ts";
import { createHarness } from "./testing/harness.ts";

function token(label: string): string {
  return `${["Exponent", "PushToken"].join("")}[port-${label}]`;
}

function message(label: string): PushMessage {
  return { to: token(label), body: "Mia answered you.", channelId: "daily" };
}

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("pushFailureOf", () => {
  it("reads the failure an Expo request error carries", () => {
    const error = new ExpoPushRequestError({
      code: "unknown",
      misconfigured: true,
      reason: "UNAUTHORIZED",
      message: "expo push send: UNAUTHORIZED (401)",
    });

    expect(pushFailureOf(error)).toEqual({
      code: "unknown",
      misconfigured: true,
      reason: "UNAUTHORIZED",
      message: "expo push send: UNAUTHORIZED (401)",
    });
  });

  it("finds none on any other error", () => {
    expect(pushFailureOf(new ChannelSendError("unavailable", "down"))).toBeNull();
    expect(pushFailureOf(new Error("down"))).toBeNull();
    expect(pushFailureOf("down")).toBeNull();
    const odd = Object.assign(new ChannelSendError("unknown", "odd"), { failure: { code: 1 } });
    expect(pushFailureOf(odd)).toBeNull();
  });
});

/**
 * A harness boots its own PGlite, which under a full `pnpm test`, beside the other packages' suites,
 * takes longer than vitest's default 5 s; the harness's own suites give it 60 s in `beforeAll`.
 */
const HARNESS_TIMEOUT_MS = 60_000;

describe("the fake push port", () => {
  it("records what it is sent and answers one ticket per message, numbered", async () => {
    const push = createFakePush();

    const results = await push.send([message("a"), message("b")]);

    expect(results).toEqual([
      { status: "ok", id: fakeTicketId(1) },
      { status: "ok", id: fakeTicketId(2) },
    ]);
    expect(push.sent).toEqual([message("a"), message("b")]);
    expect(push.sends).toEqual([[message("a"), message("b")]]);
    expect(push.tickets.get(fakeTicketId(2))).toEqual(message("b"));
  });

  it("answers DeviceNotRegistered for a phone that is gone, mapped as the Expo client maps it", async () => {
    const push = createFakePush();
    push.unregister(token("gone"));
    push.refuseTicketsTo(token("keyless"), "InvalidCredentials");

    const results = await push.send([message("gone"), message("keyless"), message("fine")]);

    expect(results).toEqual([
      { status: "error", failure: pushFailureFor("DeviceNotRegistered") },
      { status: "error", failure: pushFailureFor("InvalidCredentials") },
      { status: "ok", id: fakeTicketId(1) },
    ]);
    expect(pushFailureFor("DeviceNotRegistered")).toMatchObject({
      code: "blocked",
      misconfigured: false,
    });
    expect(pushFailureFor("InvalidCredentials")).toMatchObject({
      code: "unknown",
      misconfigured: true,
    });
  });

  it("fails whole sends as asked, accepting nothing, then sends again", async () => {
    const push = createFakePush();
    push.failNextSends(1, { status: 401, code: "UNAUTHORIZED" });

    const error = await thrown(push.send([message("a")]));

    expect(error).toBeInstanceOf(ChannelSendError);
    expect(pushFailureOf(error)).toMatchObject({ misconfigured: true, reason: "UNAUTHORIZED" });
    expect(push.tickets.size).toBe(0);
    expect(await push.send([message("a")])).toEqual([{ status: "ok", id: fakeTicketId(1) }]);
    expect(push.sent).toHaveLength(2);
  });

  it("answers receipts: ok for its own tickets, what it was told, and nothing for one not ready", async () => {
    const push = createFakePush();
    await push.send([message("a"), message("b"), message("c")]);
    push.receiptFor(fakeTicketId(2), {
      status: "error",
      failure: pushFailureFor("DeviceNotRegistered"),
    });
    push.receiptFor(fakeTicketId(3), null);

    const receipts = await push.getReceipts([
      fakeTicketId(1),
      fakeTicketId(2),
      fakeTicketId(3),
      fakeTicketId(9),
    ]);

    expect(receipts).toEqual({
      [fakeTicketId(1)]: { status: "ok" },
      [fakeTicketId(2)]: { status: "error", failure: pushFailureFor("DeviceNotRegistered") },
    });
    expect(push.receiptRequests).toEqual([
      [fakeTicketId(1), fakeTicketId(2), fakeTicketId(3), fakeTicketId(9)],
    ]);

    push.failNextReceipts(1, { status: 503 });
    expect(pushFailureOf(await thrown(push.getReceipts([fakeTicketId(1)])))).toMatchObject({
      code: "unavailable",
      reason: "http_503",
    });
  });

  it("starts over on reset, as the harness does between tests", {
    timeout: HARNESS_TIMEOUT_MS,
  }, async () => {
    const h = await createHarness();
    try {
      await h.push.send([message("a")]);
      h.push.unregister(token("b"));
      expect(h.deps.push).toBe(h.push);

      await h.reset();

      expect(h.push.sent).toEqual([]);
      expect(await h.push.send([message("b")])).toEqual([{ status: "ok", id: fakeTicketId(1) }]);
    } finally {
      await h.close();
    }
  });

  it("is no port at all in a harness made with push off, as PUSH_SEND off leaves services", {
    timeout: HARNESS_TIMEOUT_MS,
  }, async () => {
    const h = await createHarness({ push: "off" });
    try {
      expect(h.deps.push).toBeNull();
      await h.reset();
      expect(h.deps.push).toBeNull();
    } finally {
      await h.close();
    }
  });
});
