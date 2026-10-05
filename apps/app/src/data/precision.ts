import { plural, t } from "@lingui/core/macro";
import type { ApiPrecision, ApiPrecisionMonth } from "@vela/contracts";
import { listOf, monthYear } from "./format.ts";

/**
 * How Vela is doing (spec §8 "Precision accounting"), in the screen's words: each month of quiet
 * notices as a few sentences built from the numbers the API counted. The words say what happened
 * after a morning stayed quiet, never that she failed to answer (spec §8, "No guilt").
 */

export interface PrecisionMonth {
  month: string;
  /** "September 2026". */
  label: string;
  /** "3 quiet notices.", then how they ended, then the share that were real, then the verdicts. */
  lines: string[];
}

export interface Precision {
  family: PrecisionMonth[];
  vela: PrecisionMonth[];
  /** "Vela shows a month once it has at least 10 notices from 3 families." */
  velaRule: string;
}

/** How the settled notices of a month ended, as one sentence, or nothing when none has. */
function endings(outcomes: ApiPrecisionMonth["outcomes"]): string | null {
  const {
    answered_late: later,
    away,
    fine_known: known,
    true_concern: wrong,
    unknown: neverKnown,
  } = outcomes;
  const parts = [
    later === 0 ? null : t`${later} answered later`,
    away === 0 ? null : t`${away} away`,
    known === 0 ? null : t`${known} fine, and the family knew why`,
    wrong === 0 ? null : t`${wrong} where something was wrong`,
    neverKnown === 0 ? null : t`${neverKnown} never known`,
  ].filter((part): part is string => part !== null);
  const ended = listOf(parts);
  return parts.length === 0 ? null : t`How they ended: ${ended}.`;
}

/** One month's sentences. */
export function monthLines(month: ApiPrecisionMonth): string[] {
  const { notices, open, outcomes, useful } = month;
  const lines = [plural(notices, { one: "# quiet notice.", other: "# quiet notices." })];
  const ended = endings(outcomes);
  if (ended !== null) lines.push(ended);
  if (open > 0) {
    lines.push(plural(open, { one: "# is still open.", other: "# are still open." }));
  }
  if (notices > open) {
    const wrong = outcomes.true_concern;
    lines.push(
      wrong === 0
        ? t`In none of them was something wrong.`
        : t`Something was wrong in ${wrong} of ${notices}.`,
    );
  }
  const found = useful.yes;
  const verdicts = useful.yes + useful.no;
  if (verdicts > 0) {
    lines.push(t`The family found ${found} of ${verdicts} useful.`);
  }
  return lines;
}

function monthOf(month: ApiPrecisionMonth): PrecisionMonth {
  return { month: month.month, label: monthYear(month.month), lines: monthLines(month) };
}

export function toPrecision(precision: ApiPrecision): Precision {
  const { notices, families } = precision.vela_minimum;
  return {
    family: precision.family.map(monthOf),
    vela: precision.vela.map(monthOf),
    velaRule: t`Vela shows a month once it has at least ${notices} notices from ${families} families, so no one family's morning can be read out of it.`,
  };
}

/** The example page, with no API: a month of the family's and one of Vela's. */
export function precisionFixture(): Precision {
  return toPrecision({
    family: [
      {
        month: "2026-09",
        notices: 2,
        open: 0,
        outcomes: { answered_late: 1, away: 1, fine_known: 0, true_concern: 0, unknown: 0 },
        useful: { yes: 1, no: 1 },
      },
    ],
    vela: [
      {
        month: "2026-09",
        notices: 24,
        open: 1,
        outcomes: { answered_late: 15, away: 5, fine_known: 2, true_concern: 1, unknown: 0 },
        useful: { yes: 16, no: 5 },
      },
    ],
    vela_minimum: { notices: 10, families: 3 },
  });
}
