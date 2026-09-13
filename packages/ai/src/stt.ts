/**
 * Speech-to-text through Deepgram's pre-recorded API (POST /v1/listen), checked against Deepgram's
 * documentation on 2026-09-13:
 * - `nova-3` transcribes Traditional Chinese as `zh-TW` and English as `en` (and `ja`, `de`, `hi`,
 *   `ru`), so her language passes straight through as `language`. Its `multi` code-switching mode
 *   does not include Chinese, so it is not used.
 * - `detect_language=true` picks the dominant language (Chinese is detected only as `zh`) and
 *   reports it per channel as `detected_language`.
 * - `mip_opt_out=true` excludes every request from Deepgram's Model Improvement Program.
 * - `smart_format=true` adds punctuation and the formatting available for the language.
 */
import type { Lang } from "@vela/contracts";
import { z } from "zod";
import type { AiCallRecord, Stt, TranscribeInput, Transcription } from "./types.ts";

export const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";
export const STT_MODEL = "nova-3";
/** Versions the request configuration the way prompt versions do for Claude calls. */
export const STT_VERSION = "deepgram-nova-3.v1";
/** Pay-as-you-go Nova-3 monolingual pre-recorded price, US dollars per audio minute. */
export const DEEPGRAM_USD_PER_MINUTE = 0.0043;
/**
 * Below this confidence in her language, the audio is transcribed again with language detection:
 * the spec's auto-detect fallback for someone who answered in another language than her own.
 */
export const DETECT_FALLBACK_BELOW = 0.5;

export interface DeepgramSttOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

const DeepgramResponse = z.object({
  metadata: z.object({ duration: z.number().nonnegative() }),
  results: z.object({
    channels: z
      .array(
        z.object({
          alternatives: z
            .array(z.object({ transcript: z.string(), confidence: z.number().min(0).max(1) }))
            .optional(),
          detected_language: z.string().min(1).optional(),
        }),
      )
      .min(1),
  }),
});

interface Attempt {
  text: string;
  language: string | null;
  confidence: number | null;
  durationSeconds: number;
}

type AttemptResult = { ok: true; attempt: Attempt } | { ok: false; error: string };

export function createDeepgramStt(options: DeepgramSttOptions): Stt {
  // Called through a closure so the global fetch never runs with a foreign `this`, which Workers reject.
  const fetchImpl: typeof fetch = options.fetch ?? ((resource, init) => fetch(resource, init));

  async function attempt(
    input: TranscribeInput,
    language: Lang | "detect",
  ): Promise<AttemptResult> {
    const url = new URL(DEEPGRAM_LISTEN_URL);
    url.searchParams.set("model", STT_MODEL);
    if (language === "detect") {
      url.searchParams.set("detect_language", "true");
    } else {
      url.searchParams.set("language", language);
    }
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("mip_opt_out", "true");

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: { Authorization: `Token ${options.apiKey}`, "Content-Type": input.mime },
        body: input.audio,
      });
    } catch {
      return { ok: false, error: "network" };
    }
    if (!response.ok) {
      return { ok: false, error: `http_${response.status}` };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: "invalid_response" };
    }
    const parsed = DeepgramResponse.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "invalid_response" };
    }

    const [channel] = parsed.data.results.channels;
    const best = channel?.alternatives?.[0];
    return {
      ok: true,
      attempt: {
        text: best?.transcript.trim() ?? "",
        language: language === "detect" ? (channel?.detected_language ?? null) : language,
        confidence: best?.confidence ?? null,
        durationSeconds: parsed.data.metadata.duration,
      },
    };
  }

  return {
    async transcribe(input) {
      const started = performance.now();
      const finish = (result: AttemptResult, billedSeconds: number): Transcription => {
        const record: AiCallRecord = {
          call: "transcribe",
          promptVersion: STT_VERSION,
          model: STT_MODEL,
          ok: result.ok,
          tokensIn: 0,
          tokensOut: 0,
          tokensCached: 0,
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
          costUsd: costOfSeconds(billedSeconds),
          ...(result.ok ? {} : { error: result.error }),
        };
        return result.ok
          ? {
              ok: true,
              text: result.attempt.text,
              language: result.attempt.language,
              confidence: result.attempt.confidence,
              record,
            }
          : { ok: false, text: "", language: null, confidence: null, record };
      };

      // An empty upload cannot be transcribed; it is bad data from the channel, not a bug.
      if (input.audio.byteLength === 0) {
        return finish({ ok: false, error: "empty_audio" }, 0);
      }

      const first = await attempt(input, input.languageHint ?? "detect");
      if (!first.ok || input.languageHint === null || !needsDetection(first.attempt)) {
        return finish(first, first.ok ? first.attempt.durationSeconds : 0);
      }

      const detected = await attempt(input, "detect");
      if (!detected.ok) {
        return finish(first, first.attempt.durationSeconds);
      }
      const billed = first.attempt.durationSeconds + detected.attempt.durationSeconds;
      const better =
        (detected.attempt.confidence ?? 0) > (first.attempt.confidence ?? 0) ? detected : first;
      return finish(better, billed);
    },
  };
}

/** Silence yields an empty transcript; retrying it with detection would only cost a second call. */
function needsDetection(attempt: Attempt): boolean {
  return attempt.text !== "" && (attempt.confidence ?? 0) < DETECT_FALLBACK_BELOW;
}

function costOfSeconds(seconds: number): number {
  return Math.round((seconds / 60) * DEEPGRAM_USD_PER_MINUTE * 1_000_000) / 1_000_000;
}

/** A deterministic `Stt` for tests; `result` overrides any field of the successful transcription. */
export function createFakeStt(result: Partial<Omit<Transcription, "record">> = {}): Stt {
  return {
    transcribe(input) {
      const ok = result.ok ?? true;
      const record: AiCallRecord = {
        call: "transcribe",
        promptVersion: STT_VERSION,
        model: STT_MODEL,
        ok,
        tokensIn: 0,
        tokensOut: 0,
        tokensCached: 0,
        latencyMs: 0,
        costUsd: 0,
        ...(ok ? {} : { error: "fake_failure" }),
      };
      return Promise.resolve({
        ok,
        text: result.text ?? (ok ? "fake transcript" : ""),
        language: result.language !== undefined ? result.language : ok ? input.languageHint : null,
        confidence: result.confidence !== undefined ? result.confidence : ok ? 0.99 : null,
        record,
      });
    },
  };
}
