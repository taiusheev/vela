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

function clampQuiet(medianMinutes: number): number {
  const minutes = Math.ceil(medianMinutes + TUNING.marginMinutes);
  return Math.min(TUNING.capMinutes, Math.max(TUNING.floorMinutes, minutes));
}

/**
 * Minutes from delivery until an unanswered exchange turns quiet: the median answer latency plus two
 * hours, clamped to [240, 600]. With fewer than 14 samples (answered days) her rhythm is not known yet
 * and the default of 360 applies.
 *
 * `latencies` are minutes from delivery to answer over her recent answered days (the caller passes
 * the last 14). On Sundays and her country's holidays (`sunday: true`), the median of
 * `sundayLatencies` replaces the overall median when there are at least three such samples and the
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
      return clampQuiet(sunday);
    }
  }
  return clampQuiet(overall);
}

/**
 * The first local date after the learning period that starts on the consent date: the period covers
 * the consent date and the 13 days after it, and a date is inside it while `date < learningUntil`.
 */
export function learningUntil(consentDate: LocalDate): LocalDate {
  return addDays(consentDate, TUNING.learningDays);
}
