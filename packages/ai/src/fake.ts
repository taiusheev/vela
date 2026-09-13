import { genericChips } from "./defaults.ts";
import { MODEL_FOR } from "./models.ts";
import { PROMPTS } from "./prompts/index.ts";
import type {
  Ai,
  AiCallName,
  AiCallRecord,
  AiCallTypes,
  AiOutcome,
  ReplyItem,
  UnderstandInput,
} from "./types.ts";

export interface FakeAiCall {
  readonly call: AiCallName;
  readonly input: unknown;
}

/** An `Ai` for tests that also lists every call it received, overridden or not, in order. */
export interface FakeAi extends Ai {
  readonly calls: readonly FakeAiCall[];
}

type Method<K extends AiCallName> = (
  input: AiCallTypes[K]["input"],
) => Promise<AiOutcome<AiCallTypes[K]["output"]>>;

/**
 * A deterministic `Ai`: the same input always yields the same successful outcome, derived from the
 * input so tests can see what flowed through. Overrides replace whole methods, for example to make
 * `flag` raise a flag or `understand` fail.
 */
export function createFakeAi(overrides: Partial<Ai> = {}): FakeAi {
  const calls: FakeAiCall[] = [];

  function method<K extends AiCallName>(
    call: K,
    override: Method<K> | undefined,
    fallback: (input: AiCallTypes[K]["input"]) => AiCallTypes[K]["output"],
  ): Method<K> {
    return (input) => {
      calls.push({ call, input });
      if (override !== undefined) {
        return override(input);
      }
      return Promise.resolve({ ok: true, value: fallback(input), record: fakeRecord(call) });
    };
  }

  return {
    calls,
    understand: method("understand", overrides.understand, (input) => ({
      summary: fakeSummary(input),
      moodWords: [],
      mentions: { people: [], places: [], plans: [], health: [], dates: [] },
      away: null,
      language: input.lang,
    })),
    flag: method("flag", overrides.flag, () => ({
      flag: false,
      category: null,
      severity: null,
      evidenceQuote: null,
    })),
    chips: method("chips", overrides.chips, (input) => ({ chips: genericChips(input.lang) })),
    suggest: method("suggest", overrides.suggest, (input) => ({
      type: input.rotationType,
      text: `${input.recipientAddress}, what are you doing today?`,
      source: "rotation",
    })),
    translate: method("translate", overrides.translate, (input) => ({
      text: `[${input.to}] ${input.text}`,
    })),
    readback: method("readback", overrides.readback, (input) => ({
      lines: input.replies.map(replyLine),
    })),
    hello: method("hello", overrides.hello, (input) => ({
      lines: [
        input.replies.length > 0
          ? input.replies.map(replyLine).join(" ")
          : `A warm morning from the family, ${input.addressForm}.`,
        "Nothing new from the family today. How are you this morning?",
      ],
    })),
    weeklyRead: method("weekly_read", overrides.weeklyRead, (input) => ({
      lines: [
        `${input.elderName} answered ${input.answeredDays} of 7 days.`,
        `The family sent ${input.familyAsks} asks.`,
        `${input.quietDays} mornings were a hello from Vela.`,
      ],
      suggestion: `Ask ${input.elderName} about the week.`,
    })),
  };
}

/** The record the fake attaches: the real route and prompt version, with nothing spent. */
export function fakeRecord(call: AiCallName, error?: string): AiCallRecord {
  const record: AiCallRecord = {
    call,
    promptVersion: PROMPTS[call].version,
    model: MODEL_FOR[call],
    ok: error === undefined,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    latencyMs: 0,
    costUsd: 0,
  };
  return error === undefined ? record : { ...record, error };
}

const SUMMARY_LENGTH = 120;

function fakeSummary(input: UnderstandInput): string {
  return input.answer.text.trim().slice(0, SUMMARY_LENGTH) || "answered";
}

function replyLine(reply: ReplyItem): string {
  return `${reply.name}: ${reply.text ?? reply.kind}`;
}
