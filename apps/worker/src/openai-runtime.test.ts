import { createOpenAiAi } from "@vela/ai";
import { expect, it } from "vitest";

// vitest.config.ts intercepts the native outbound request. A global fetch spy would hide
// workerd's receiver requirement, which Node's fetch does not enforce.
it("uses native Worker fetch for OpenAI without losing its receiver", async () => {
  const result = await createOpenAiAi({
    apiKey: "synthetic-runtime-key",
    retryBaseMs: 0,
  }).flag({
    lang: "en",
    addressForm: "Mom",
    ask: null,
    answer: { kind: "text", text: "The synthetic garden is green." },
    recentSummaries: [],
  });

  expect(result).toMatchObject({
    ok: true,
    value: { flag: false },
    record: { ok: true, model: "gpt-5-2025-08-07", tokensIn: 20, tokensOut: 10 },
  });
});
