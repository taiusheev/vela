import { describe, expect, it } from "vitest";
import { createLineAdapter } from "./adapter.ts";
import {
  createRecordingFetch,
  lineApi,
  lineApiFixture,
  type Responder,
  routeOf,
  TEST_CHANNEL_ACCESS_TOKEN,
  TEST_CHANNEL_SECRET,
} from "./testing.ts";

const READ_AT = new Date("2026-09-27T03:00:00.000Z");
const QUOTA = "GET /v2/bot/message/quota";
const CONSUMPTION = "GET /v2/bot/message/quota/consumption";

function setup(responder: Responder) {
  const recording = createRecordingFetch(responder);
  const adapter = createLineAdapter({
    channelSecret: TEST_CHANNEL_SECRET,
    channelAccessToken: TEST_CHANNEL_ACCESS_TOKEN,
    fetch: recording.fetch,
    now: () => READ_AT,
  });
  return { adapter, requests: recording.requests };
}

describe("adapter.quota", () => {
  it("reads this month's limit and use, dated by the adapter's clock", async () => {
    const { adapter, requests } = setup(
      lineApi({
        [QUOTA]: () => lineApiFixture("api-quota-limited.json"),
        [CONSUMPTION]: () => lineApiFixture("api-quota-consumption.json"),
      }),
    );

    await expect(adapter.quota?.()).resolves.toStrictEqual({
      limit: 3000,
      used: 1287,
      readAt: "2026-09-27T03:00:00.000Z",
    });
    expect(requests.map(routeOf)).toStrictEqual([QUOTA, CONSUMPTION]);
  });

  it("reads a plan without a limit as a null limit", async () => {
    const { adapter } = setup(
      lineApi({
        [QUOTA]: () => lineApiFixture("api-quota-none.json"),
        [CONSUMPTION]: () => lineApiFixture("api-quota-consumption.json"),
      }),
    );

    await expect(adapter.quota?.()).resolves.toMatchObject({ limit: null, used: 1287 });
  });

  it("throws a failed reading as the call's error", async () => {
    const { adapter } = setup(
      lineApi({
        [QUOTA]: () => lineApiFixture("api-quota-limited.json"),
        [CONSUMPTION]: () => lineApiFixture("api-error-500.json"),
      }),
    );

    await expect(adapter.quota?.()).rejects.toMatchObject({
      code: "unavailable",
      message: "line quota consumption failed: 500 Internal server error",
    });
  });
});
