import { describe, expect, it } from "vitest";
import { createDeepgramStt, createFakeStt } from "./stt.ts";
import { createRecordingFetch, jsonResponse, type Reply } from "./testing.ts";

const audio = new Uint8Array([1, 2, 3, 4, 5]).buffer;

/** A pre-recorded response in the shape of Deepgram's reference example. */
function deepgramResponse(fields: {
  transcript: string;
  confidence: number;
  duration?: number;
  detectedLanguage?: string;
}): Response {
  return jsonResponse({
    metadata: {
      request_id: "a847f427-4ad5-4d67-9b95-db801e58251c",
      sha256: "154e291ecfa8be6ab8343560bcc109008fa7853eb5372533e8efdefc9b504c33",
      created: "2026-09-13T08:12:00.000Z",
      duration: fields.duration ?? 30,
      channels: 1,
      models: ["30089e05-99d1-4376-b32e-c263170674af"],
      model_info: {
        "30089e05-99d1-4376-b32e-c263170674af": {
          arch: "nova-3",
          name: "general-nova-3",
          version: "2026-07-01",
        },
      },
    },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: fields.transcript,
              confidence: fields.confidence,
              words: [{ word: "今天", start: 0.08, end: 0.32, confidence: 0.99 }],
            },
          ],
          ...(fields.detectedLanguage === undefined
            ? {}
            : { detected_language: fields.detectedLanguage, language_confidence: 0.9 }),
        },
      ],
    },
  });
}

function sttWith(replies: Reply[]) {
  const recorder = createRecordingFetch(replies);
  const stt = createDeepgramStt({ apiKey: "dg-key", fetch: recorder.fetch });
  return { stt, requests: recorder.requests };
}

describe("createDeepgramStt", () => {
  it("transcribes in her language with nova-3, smart formatting, and the training opt-out", async () => {
    const { stt, requests } = sttWith([
      deepgramResponse({ transcript: "今天煮了排骨湯。", confidence: 0.93, duration: 30 }),
    ]);

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "zh-TW" });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(`${request?.url.origin}${request?.url.pathname}`).toBe(
      "https://api.deepgram.com/v1/listen",
    );
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      model: "nova-3",
      language: "zh-TW",
      smart_format: "true",
      mip_opt_out: "true",
    });
    expect(request?.headers.get("authorization")).toBe("Token dg-key");
    expect(request?.headers.get("content-type")).toBe("audio/ogg");
    expect([...(request?.bytes ?? [])]).toEqual([1, 2, 3, 4, 5]);

    // 30 seconds at $0.0043 per minute.
    expect(result).toEqual({
      ok: true,
      text: "今天煮了排骨湯。",
      language: "zh-TW",
      confidence: 0.93,
      record: {
        call: "transcribe",
        promptVersion: "deepgram-nova-3.v1",
        model: "nova-3",
        ok: true,
        tokensIn: 0,
        tokensOut: 0,
        tokensCached: 0,
        latencyMs: expect.any(Number),
        costUsd: 0.00215,
      },
    });
  });

  it("detects the language when there is no hint", async () => {
    const { stt, requests } = sttWith([
      deepgramResponse({ transcript: "Good morning.", confidence: 0.97, detectedLanguage: "en" }),
    ]);

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: null });

    const params = requests[0]?.url.searchParams;
    expect(params?.get("detect_language")).toBe("true");
    expect(params?.has("language")).toBe(false);
    expect(params?.get("mip_opt_out")).toBe("true");
    expect(result).toMatchObject({ ok: true, text: "Good morning.", language: "en" });
  });

  it("falls back to detection when her language transcribes with low confidence, keeping the better transcript", async () => {
    const { stt, requests } = sttWith([
      deepgramResponse({ transcript: "古德 猫宁", confidence: 0.31, duration: 12 }),
      deepgramResponse({
        transcript: "Good morning, Mia.",
        confidence: 0.94,
        duration: 12,
        detectedLanguage: "en",
      }),
    ]);

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "zh-TW" });

    expect(requests.map((request) => request.url.searchParams.get("detect_language"))).toEqual([
      null,
      "true",
    ]);
    expect(result).toMatchObject({
      ok: true,
      text: "Good morning, Mia.",
      language: "en",
      confidence: 0.94,
      record: { ok: true, costUsd: 0.00172 },
    });
  });

  it("keeps the transcript in her language when detection is no more confident", async () => {
    const { stt } = sttWith([
      deepgramResponse({ transcript: "嗯，還好。", confidence: 0.42 }),
      deepgramResponse({ transcript: "en hai hao", confidence: 0.2, detectedLanguage: "zh" }),
    ]);

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "zh-TW" });

    expect(result).toMatchObject({ ok: true, text: "嗯，還好。", language: "zh-TW" });
  });

  it("does not retry silence with detection", async () => {
    const { stt, requests } = sttWith([deepgramResponse({ transcript: "", confidence: 0 })]);

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "en" });

    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, text: "", language: "en" });
  });

  it("reports an HTTP error as a failure with empty text", async () => {
    const { stt, requests } = sttWith([
      jsonResponse(
        { err_code: "INVALID_AUTH", err_msg: "Invalid credentials.", request_id: "r" },
        401,
      ),
    ]);

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "en" });

    expect(requests).toHaveLength(1);
    expect(result).toEqual({
      ok: false,
      text: "",
      language: null,
      confidence: null,
      record: expect.objectContaining({ ok: false, error: "http_401", costUsd: 0 }),
    });
  });

  it("reports a network failure as a failure", async () => {
    const { stt } = sttWith([new TypeError("fetch failed")]);

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "en" });

    expect(result.ok).toBe(false);
    expect(result.record.error).toBe("network");
  });

  it("reports a body that is not a transcription as a failure", async () => {
    const { stt } = sttWith([
      jsonResponse({ request_id: "only-accepted" }),
      new Response("<html>gateway</html>", { status: 200 }),
    ]);

    const accepted = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "en" });
    const html = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "en" });

    expect(accepted).toMatchObject({ ok: false, record: { error: "invalid_response" } });
    expect(html).toMatchObject({ ok: false, record: { error: "invalid_response" } });
  });

  it("does not send empty audio", async () => {
    const { stt, requests } = sttWith([deepgramResponse({ transcript: "x", confidence: 1 })]);

    const result = await stt.transcribe({
      audio: new ArrayBuffer(0),
      mime: "audio/ogg",
      languageHint: "en",
    });

    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, text: "", record: { error: "empty_audio" } });
  });
});

describe("createFakeStt", () => {
  it("returns a deterministic transcript in the hinted language", async () => {
    const stt = createFakeStt();

    const result = await stt.transcribe({ audio, mime: "audio/ogg", languageHint: "zh-TW" });

    expect(result).toEqual({
      ok: true,
      text: "fake transcript",
      language: "zh-TW",
      confidence: 0.99,
      record: {
        call: "transcribe",
        promptVersion: "deepgram-nova-3.v1",
        model: "nova-3",
        ok: true,
        tokensIn: 0,
        tokensOut: 0,
        tokensCached: 0,
        latencyMs: 0,
        costUsd: 0,
      },
    });
  });

  it("honours overrides, including a failure", async () => {
    const custom = createFakeStt({ text: "我跌倒了", confidence: 0.5 });
    const failing = createFakeStt({ ok: false });

    expect(
      await custom.transcribe({ audio, mime: "audio/ogg", languageHint: "zh-TW" }),
    ).toMatchObject({ ok: true, text: "我跌倒了", confidence: 0.5 });
    expect(
      await failing.transcribe({ audio, mime: "audio/ogg", languageHint: "zh-TW" }),
    ).toMatchObject({
      ok: false,
      text: "",
      language: null,
      confidence: null,
      record: { ok: false, error: "fake_failure" },
    });
  });
});
