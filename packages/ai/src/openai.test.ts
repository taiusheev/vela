import { describe, expect, it, vi } from "vitest";
import {
  createOpenAiAi,
  OPENAI_MODEL_FOR,
  OPENAI_REMINDERS,
  openAiPriceFor,
  responseSchema,
} from "./openai.ts";
import { PROMPTS, renderUserTurn } from "./prompts/index.ts";
import { createRecordingFetch, jsonResponse, type Reply } from "./testing.ts";
import {
  type ChipsInput,
  type FlagInput,
  type FlagResult,
  OUTPUT_SCHEMAS,
  type UnderstandInput,
  type Understanding,
} from "./types.ts";

const understandInput: UnderstandInput = {
  lang: "en",
  summaryLang: "en",
  addressForm: "Mom",
  today: "2026-10-06",
  todayWeekday: "Tuesday",
  ask: { askerName: "Mia", type: "question", text: "What did you cook today?" },
  answer: { kind: "text", text: "Soup, and I am at my sister's until Thursday." },
  recentSummaries: [],
  healthWordsConsent: false,
};

const understanding: Understanding = {
  summary: "Mom made soup and is staying with her sister until Thursday.",
  moodWords: ["content"],
  mentions: { people: ["sister"], places: [], plans: [], health: [], dates: ["Thursday"] },
  away: { from: "2026-10-06", until: "2026-10-08" },
  dated: [],
  language: "en",
};

const flagInput: FlagInput = {
  lang: "en",
  addressForm: "Mom",
  ask: { askerName: "Anna", type: "question", text: "How was your morning?" },
  answer: { kind: "text", text: "I fell in the kitchen and my hip hurts a lot." },
  recentSummaries: [],
};

const flagged: FlagResult = {
  flag: true,
  category: "health",
  severity: "urgent",
  evidenceQuote: "I fell in the kitchen",
};

const chipsInput: ChipsInput = {
  lang: "en",
  askerName: "Mia",
  question: "What did you cook today?",
  pastAnswers: ["Soup"],
};

function completion(
  output: unknown,
  overrides: { model?: string; finish?: string; refusal?: string | null; content?: string } = {},
): Response {
  return jsonResponse({
    model: overrides.model ?? "gpt-5-2025-08-07",
    choices: [
      {
        finish_reason: overrides.finish ?? "stop",
        message: {
          content: overrides.content ?? JSON.stringify(output),
          refusal: overrides.refusal ?? null,
        },
      },
    ],
    usage: {
      prompt_tokens: 1_000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 400 },
    },
  });
}

function clientWith(replies: readonly Reply[]) {
  const recorder = createRecordingFetch(replies);
  const ai = createOpenAiAi({ apiKey: "test-key", fetch: recorder.fetch, retryBaseMs: 0 });
  return { ai, requests: recorder.requests };
}

describe("createOpenAiAi request shape", () => {
  it("sends the call's routed model, its prompt, schema, effort, and asks OpenAI not to store it", async () => {
    const { ai, requests } = clientWith([completion(understanding)]);

    const outcome = await ai.understand(understandInput);

    expect(outcome).toMatchObject({ ok: true, value: understanding });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url.href).toBe("https://api.openai.com/v1/chat/completions");
    expect(request?.headers.get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(request?.text ?? "");
    expect(body.model).toBe(OPENAI_MODEL_FOR.understand);
    expect(body.store).toBe(false);
    expect(body.reasoning_effort).toBe("low");
    expect(body.messages).toEqual([
      {
        role: "developer",
        content: `${PROMPTS.understand.system}\n\nReminders (they repeat rules above; follow them exactly):\n${OPENAI_REMINDERS.understand}`,
      },
      { role: "user", content: renderUserTurn(understandInput) },
    ]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("understand");
    expect(body.response_format.json_schema.schema.type).toBe("object");
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it("turns every call's output schema into an object JSON Schema", () => {
    for (const [call, schema] of Object.entries(OUTPUT_SCHEMAS)) {
      const json = responseSchema(schema);
      expect(json.type, call).toBe("object");
      expect(json.$schema, call).toBeUndefined();
    }
  });

  it("leaves the flag check's prompt exactly as Claude gets it, with no reminder", async () => {
    const { ai, requests } = clientWith([
      completion({ flag: false, category: null, severity: null, evidenceQuote: null }),
    ]);

    const outcome = await ai.flag(flagInput);

    expect(JSON.parse(requests[0]?.text ?? "").messages[0].content).toBe(PROMPTS.flag.system);
    expect(outcome.record.promptVersion).toBe(PROMPTS.flag.version);
  });

  it("routes the flag check to the stronger model and drafting to the small one", () => {
    expect(OPENAI_MODEL_FOR.flag).toBe("gpt-5");
    expect(OPENAI_MODEL_FOR.chips).toBe("gpt-5-mini");
  });
});

describe("createOpenAiAi usage and cost", () => {
  it("records the served model, every input token, the cached share, and the cost", async () => {
    const { ai } = clientWith([completion(understanding)]);

    const outcome = await ai.understand(understandInput);

    // gpt-5: 600 uncached × $1.25 + 400 cached × $0.125 + 200 out × $10, per million.
    expect(outcome.record).toMatchObject({
      call: "understand",
      promptVersion: `${PROMPTS.understand.version}+openai.1`,
      model: "gpt-5-2025-08-07",
      ok: true,
      tokensIn: 1_000,
      tokensOut: 200,
      tokensCached: 400,
      costUsd: 0.0028,
    });
  });

  it("prices a dated snapshot by its family and an unknown id at the routed model", () => {
    expect(openAiPriceFor("gpt-5-mini-2025-08-07", "gpt-5").input).toBe(0.25);
    expect(openAiPriceFor("gpt-5-2025-08-07", "gpt-5-mini").input).toBe(1.25);
    expect(openAiPriceFor("something-new", "gpt-5-mini").input).toBe(0.25);
  });
});

describe("createOpenAiAi results", () => {
  it("drops a flag quote that is not an exact excerpt of her answer but keeps the flag", async () => {
    const { ai } = clientWith([completion({ ...flagged, evidenceQuote: "She hurt her hip" })]);

    const outcome = await ai.flag(flagInput);

    expect(outcome).toMatchObject({ ok: true, value: { ...flagged, evidenceQuote: null } });
  });

  it("holds an away to her answer's date, as with Claude", async () => {
    const { ai } = clientWith([
      completion({ ...understanding, away: { from: "2026-10-01", until: "2026-10-08" } }),
    ]);

    const outcome = await ai.understand(understandInput);

    expect(outcome.value.away).toEqual({ from: "2026-10-06", until: "2026-10-08" });
  });
});

describe("createOpenAiAi failures", () => {
  it("treats a refusal as a failure before reading any content", async () => {
    const { ai } = clientWith([completion(flagged, { refusal: "I can't help with that." })]);

    const outcome = await ai.flag(flagInput);

    expect(outcome).toMatchObject({ ok: false, error: "refusal", record: { ok: false } });
    expect(outcome.value).toEqual({
      flag: false,
      category: null,
      severity: null,
      evidenceQuote: null,
    });
  });

  it("treats a response cut off at the token limit as truncated", async () => {
    const { ai } = clientWith([completion(understanding, { finish: "length" })]);

    const outcome = await ai.understand(understandInput);

    expect(outcome).toMatchObject({ ok: false, error: "truncated" });
  });

  it("treats a content filter stop as a failure", async () => {
    const { ai } = clientWith([completion(understanding, { finish: "content_filter" })]);

    expect(await ai.understand(understandInput)).toMatchObject({
      ok: false,
      error: "stop_content_filter",
    });
  });

  it("treats output that is not JSON or fails the schema as schema_invalid", async () => {
    const notJson = clientWith([completion(null, { content: "Sure! Here you go" })]);
    expect(await notJson.ai.understand(understandInput)).toMatchObject({
      ok: false,
      error: "schema_invalid",
    });
    const wrongShape = clientWith([completion({ summary: 42 })]);
    expect(await wrongShape.ai.understand(understandInput)).toMatchObject({
      ok: false,
      error: "schema_invalid",
    });
  });

  it("retries 5xx twice, then returns the safe default and an unbilled record", async () => {
    const { ai, requests } = clientWith([jsonResponse({ error: { message: "boom" } }, 500)]);

    const outcome = await ai.understand(understandInput);

    expect(requests).toHaveLength(3);
    expect(outcome).toMatchObject({
      ok: false,
      error: "http_500",
      value: { summary: "answered", away: null },
      record: { model: "gpt-5", ok: false, tokensIn: 0, costUsd: 0 },
    });
  });

  it("does not retry a 401: a wrong key is reported at once", async () => {
    const { ai, requests } = clientWith([jsonResponse({ error: { message: "bad key" } }, 401)]);

    const outcome = await ai.chips(chipsInput);

    expect(requests).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: false, error: "http_401" });
  });

  it("recovers when a retry succeeds after a 429", async () => {
    const { ai, requests } = clientWith([
      jsonResponse({ error: { message: "slow down" } }, 429),
      completion(understanding),
    ]);

    const outcome = await ai.understand(understandInput);

    expect(requests).toHaveLength(2);
    expect(outcome.ok).toBe(true);
  });

  it("reports a network failure", async () => {
    const { ai } = clientWith([new TypeError("fetch failed")]);

    expect(await ai.chips(chipsInput)).toMatchObject({ ok: false, error: "network" });
  });

  it("returns the safe default with a timeout code when the provider never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let attempts = 0;
      const hanging: typeof fetch = (_resource, init) => {
        attempts += 1;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      };
      const ai = createOpenAiAi({ apiKey: "test-key", fetch: hanging, retryBaseMs: 0 });

      const pending = ai.chips(chipsInput);
      await vi.advanceTimersByTimeAsync(3 * 30_000 + 1_000);
      const outcome = await pending;

      expect(attempts).toBe(3);
      expect(outcome).toMatchObject({
        ok: false,
        error: "timeout",
        value: { chips: ["Good", "Not yet", "Tell you later"] },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid input as a programming error without calling the provider", async () => {
    const { ai, requests } = clientWith([completion(understanding)]);

    await expect(
      ai.understand({ ...understandInput, today: "not a date" } as UnderstandInput),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});
