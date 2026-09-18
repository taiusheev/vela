import { SAFE_DEFAULTS } from "./defaults.ts";
import {
  type Ai,
  type AiCallName,
  type AiCallTypes,
  type AiOffOutcome,
  INPUT_SCHEMAS,
} from "./types.ts";

type OffMethod<K extends AiCallName> = (
  input: AiCallTypes[K]["input"],
) => Promise<AiOffOutcome<AiCallTypes[K]["output"]>>;

/**
 * The `Ai` a Worker runs while `AI_PROVIDER` is "off" (decision X, 2026-09-18): no provider is
 * called, and nothing is sent to one. Every call resolves with its safe default and no record, so
 * services take the path they take when a call fails, without logging a call or counting a failure.
 * Like every `Ai`, it parses each input first, so an input the real client would reject rejects here
 * too, and a test with AI off cannot pass on input the real client refuses.
 */
export function createOffAi(): Ai {
  function off<K extends AiCallName>(call: K): OffMethod<K> {
    return async (rawInput) => {
      const input = INPUT_SCHEMAS[call].parse(rawInput);
      return { ok: false, value: SAFE_DEFAULTS[call](input), record: null };
    };
  }

  return {
    understand: off("understand"),
    flag: off("flag"),
    chips: off("chips"),
    suggest: off("suggest"),
    translate: off("translate"),
    readback: off("readback"),
    hello: off("hello"),
    weeklyRead: off("weekly_read"),
  };
}
