import type { TestWeekGroup, TestWeekReport, TestWeekStep } from "@vela/services";
import { familyHref } from "./admin-pages.ts";
import { type Html, html, page } from "./html.ts";

const GROUPS: readonly { group: TestWeekGroup; title: string }[] = [
  { group: "setup", title: "Setting up" },
  { group: "loop", title: "One exchange, end to end" },
  { group: "light", title: "The light" },
  { group: "control", title: "Stop, start and the weekly read" },
];

/** Seven scheduled mornings, as the test script asks. */
const MORNINGS_WANTED = 7;

function stepRow(step: TestWeekStep): Html {
  const done = step.count > 0;
  return html`<tr><td>${done ? "✓ Done" : "Not yet"}</td>
<td>${step.label}${step.required ? html` <strong>(gate 1)</strong>` : null}</td>
<td>${done ? html`${step.count} · first ${step.firstAt?.toISOString() ?? "time unknown"}` : step.how}</td></tr>`;
}

export function renderTestWeek(report: TestWeekReport): Response {
  const required = report.steps.filter((step) => step.required);
  const requiredDone = required.filter((step) => step.count > 0).length;
  const { arrivalFailures, droppedSends, missedTicks } = report.problems;
  const problems = arrivalFailures + droppedSends + missedTicks;
  return page(
    "Test week · Vela admin",
    html`<h1>Test week checklist</h1>
<p><a href="${familyHref(report.familyId)}">Family page</a> · <a href="${familyHref(report.familyId)}/trial">Trial counts</a></p>
<p class="lede">Launch gate 1: ${requiredDone} of ${required.length} required steps seen. Scheduled mornings delivered: ${report.deliveredMornings} of ${MORNINGS_WANTED}. Generated ${report.generatedAt.toISOString()}.</p>
<p>Read from Vela's own event records: a step counts once it has happened at least once in this family. That shows it can happen, not that it always works, so failures are listed below and the full script (plan/staging-test-script.md) still applies. No family words are shown.</p>
${
  problems === 0
    ? html`<p>No failed arrivals, dropped sends or missed scheduler runs recorded.</p>`
    : html`<p class="notice">Recorded problems: ${arrivalFailures} failed arrivals, ${droppedSends} dropped sends, ${missedTicks} missed scheduler runs. Look at them on the family page before counting the week.</p>`
}
${GROUPS.map(
  ({ group, title }) => html`<section><h2>${title}</h2>
<table><thead><tr><th>State</th><th>Step</th><th>Seen / how to make it happen</th></tr></thead>
<tbody>${report.steps.filter((step) => step.group === group).map(stepRow)}</tbody></table></section>`,
)}`,
  );
}
