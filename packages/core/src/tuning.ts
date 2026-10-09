/**
 * How long silence lasts before it counts as quiet, learned from her own rhythm (spec §8,
 * architecture §6.5).
 */
import type { LocalDate } from "@vela/contracts";
import { addDays } from "./time.ts";

export const TUNING = {
  /** T_quiet before her rhythm is known: six hours. */
  defaultQuietAfterMinutes: 360,
  /** Two hours past her usual answer time. */
  marginMinutes: 120,
  /**
   * Her late days: the answer time she beats on nine days in ten. With 14 samples this is her
   * second-latest day, so one outlier does not stretch the threshold but a loose rhythm does.
   */
  lateQuantile: 0.9,
  /** One hour past her late days. */
  lateMarginMinutes: 60,
  floorMinutes: 240,
  capMinutes: 600,
  /** Spec §8: her rhythm counts as known only from the 14th answered day. */
  minSamples: 14,
  /**
   * A Sunday rhythm needs a few Sundays before it can override the weekly one; one late Sunday is
   * not a pattern.
   */
  minSundaySamples: 3,
  /** The Sunday median is used only when it differs from the overall median by more than this. */
  sundayDifferenceMinutes: 60,
  learningDays: 14,
} as const;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return upper;
  }
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/**
 * A negative latency is kept: she can answer before the arrival is sent (spec §19), which still
 * counts as an answered day, and a median that low lands on the floor anyway.
 */
function samplesOf(latencies: readonly number[]): readonly number[] {
  for (const latency of latencies) {
    if (!Number.isFinite(latency)) {
      throw new RangeError(`latency must be a finite number of minutes: ${latency}`);
    }
  }
  return latencies;
}

/** The nearest-rank quantile: the smallest sample with at least `q` of the samples at or below it. */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/** Her late-day latency (the 90th percentile), or null with no samples; stored beside the median. */
export function lateLatencyMinutes(latencies: readonly number[]): number | null {
  const samples = samplesOf(latencies);
  return samples.length === 0 ? null : quantile(samples, TUNING.lateQuantile);
}

/**
 * Her usual time plus two hours, or her late days plus one hour when her rhythm is loose, whichever
 * is later, clamped to [240, 600]. A steady parent keeps the median rule; a parent whose answers
 * spread over the morning is not reported quiet on her ordinary late days.
 */
function clampQuiet(samples: readonly number[]): number {
  const usual = median(samples) + TUNING.marginMinutes;
  const late = quantile(samples, TUNING.lateQuantile) + TUNING.lateMarginMinutes;
  const minutes = Math.ceil(Math.max(usual, late));
  return Math.min(TUNING.capMinutes, Math.max(TUNING.floorMinutes, minutes));
}

/**
 * Minutes from delivery until an unanswered exchange turns quiet: the later of the median answer
 * latency plus two hours and her 90th-percentile latency plus one hour, clamped to [240, 600]. With fewer than 14 samples (answered days) her rhythm is not known yet
 * and the default of 360 applies.
 *
 * `latencies` are minutes from delivery to answer over her recent answered days (the caller passes
 * the last 14). On Sundays and her country's holidays (`sunday: true`), the median of
 * `sundayLatencies` replace the overall samples when there are at least three such samples and the
 * two medians differ by more than an hour. The result is rounded up to a whole minute so the
 * threshold never falls before the computed time.
 */
export function quietAfterMinutes(
  latencies: number[],
  options: { sunday?: boolean; sundayLatencies?: number[] } = {},
): number {
  const samples = samplesOf(latencies);
  if (samples.length < TUNING.minSamples) {
    return TUNING.defaultQuietAfterMinutes;
  }
  const overall = median(samples);
  const sundaySamples = samplesOf(options.sundayLatencies ?? []);
  if (options.sunday === true && sundaySamples.length >= TUNING.minSundaySamples) {
    const sunday = median(sundaySamples);
    if (Math.abs(sunday - overall) > TUNING.sundayDifferenceMinutes) {
      return clampQuiet(sundaySamples);
    }
  }
  return clampQuiet(samples);
}

/**
 * The first local date after the learning period that starts on the consent date: the period covers
 * the consent date and the 13 days after it, and a date is inside it while `date < learningUntil`.
 */
export function learningUntil(consentDate: LocalDate): LocalDate {
  return addDays(consentDate, TUNING.learningDays);
}
