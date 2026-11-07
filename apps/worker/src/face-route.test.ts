import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import { createFaceUrl } from "./face-route.ts";
import { createWorker } from "./pilot-worker.ts";
import { createFakePilotRuntime, lineOnEnv, namesOf, TEST_LINE, testEnv } from "./testing/fakes.ts";

const MEI = "美".codePointAt(0) ?? 0;

async function fetchFace(url: string, env: PilotEnv = lineOnEnv()): Promise<Response> {
  const fake = createFakePilotRuntime();
  const ctx = createExecutionContext();
  const response = await createWorker(fake.runtime).fetch(new Request(url), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(fake.built(), "the face route builds no deps").toBe(0);
  expect(namesOf(fake.calls)).toEqual([]);
  return response;
}

describe("the face route", () => {
  it("serves a face it can draw as a PNG kept for a year, at the URL the adapter is given", async () => {
    const url = createFaceUrl(TEST_LINE.pilotOrigin)({ codePoint: MEI, colour: 1 });
    expect(url).toBe(`${TEST_LINE.pilotOrigin}/faces/v1/7f8e-1.png`);

    const response = await fetchFace(url ?? "");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.subarray(1, 4), (b) => String.fromCharCode(b)).join("")).toBe("PNG");
  });

  it("gives no URL for an initial it holds no outline for", () => {
    expect(createFaceUrl(TEST_LINE.pilotOrigin)({ codePoint: 0x20000, colour: 0 })).toBeUndefined();
  });

  it("answers 404 for a face it does not draw, and wherever LINE is off", async () => {
    for (const file of ["20000-0.png", "7f8e-7.png", "7F8E-1.png", "7f8e-1.jpg", "nothing"]) {
      expect((await fetchFace(`${TEST_LINE.pilotOrigin}/faces/v1/${file}`)).status, file).toBe(404);
    }
    expect(testEnv.LINE_CHANNEL).toBe("off");
    expect((await fetchFace(`${TEST_LINE.pilotOrigin}/faces/v1/7f8e-1.png`, testEnv)).status).toBe(
      404,
    );
  });
});
