import {
  TRIAL_TARGETS,
  type TrialDay,
  type TrialNumber,
  type TrialOverview,
  type TrialRecipientReport,
  type TrialReport,
  type TrialStatus,
  trialNumbers,
} from "@vela/services";
import { ADMIN_PATH, familyHref } from "./admin-pages.ts";
import { type Html, html, page } from "./html.ts";

function rate(n: number, d: number): string {
  return d === 0 ? "Unavailable (no denominator)" : `${n} / ${d} (${((100 * n) / d).toFixed(1)}%)`;
}

const STATUS_LABEL: Record<TrialStatus, string> = {
  on_track: "On track",
  watch: "Watch",
  kill: "Kill signal",
  too_early: "Too early",
  founder_check: "Founder check",
};

const T = TRIAL_TARGETS;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const NUMBER_LABEL: Record<TrialNumber["key"], { name: string; target: string }> = {
  answer_rate: {
    name: "Days she answers",
    target: `≥ ${pct(T.answerRate.onTrack)} of delivered days outside away (kill < ${pct(T.answerRate.kill)}); from ${T.answerRate.minDays} days`,
  },
  useful_notices: {
    name: "Quiet notices marked useful",
    target: `> ${pct(T.useful.onTrack)} of verdicts (kill < ${pct(T.useful.kill)}); from ${T.useful.minVerdicts} verdicts`,
  },
  notices_per_month: {
    name: "Quiet notices per 30 days",
    target: `< ${T.noticesPerMonth.onTrack} by month 3`,
  },
  missed_trouble: {
    name: "Real trouble (true concern)",
    target:
      "0 missed: confirm on the check-in calls; a true concern found in time is the light working",
  },
  stops: { name: "Times she said stop", target: "Parent stop rate < 10% in month 1" },
  fallback_share: {
    name: "Mornings nobody asked (fallback hello)",
    target: `< ${pct(T.fallbackShare.onTrack)} (alarm > ${pct(T.fallbackShare.kill)})`,
  },
  replies_heard: {
    name: "Answered days with replies heard next morning",
    target: `≥ ${pct(T.repliesHeard.onTrack)}`,
  },
};

function numberValue(n: TrialNumber): string {
  if (n.value === null) return "Unavailable (no denominator)";
  switch (n.key) {
    case "notices_per_month":
      return `${n.value.toFixed(1)} (${n.numerator} notice days in ${n.denominator} days)`;
    case "missed_trouble":
    case "stops":
      return String(n.value);
    default:
      return `${n.numerator} / ${n.denominator} (${(100 * n.value).toFixed(1)}%)`;
  }
}

function numbersTable(summary: TrialRecipientReport["summary"]): Html {
  return html`<table class="numbers"><thead><tr><th>Number</th><th>Now</th><th>Status</th><th>Target</th></tr></thead>
<tbody>${trialNumbers(summary).map(
    (n) =>
      html`<tr><td>${NUMBER_LABEL[n.key].name}</td><td>${numberValue(n)}</td><td class="status-${n.status}">${STATUS_LABEL[n.status]}</td><td>${NUMBER_LABEL[n.key].target}</td></tr>`,
  )}</tbody></table>`;
}

function dayRow(day: TrialDay): Html {
  return html`<tr><td>${day.day}</td><td>${day.fallback ? "Fallback" : "Family ask"}</td>
<td>${day.arrivalAttempts} / ${day.arrivalUnsuccessfulAttempts}</td><td>${day.arrivalSent} / ${day.arrivalFailed} / ${day.arrivalDropped} / ${day.arrivalPending}</td>
<td>${day.delivered ? "Delivered" : day.failed ? "Failed" : "Not delivered"}${day.delivered && day.failed ? " · earlier failure" : ""}</td>
<td>${day.answered ? "Answered" : "No answer"} · ${day.answerCount}</td>
<td>${day.latencyMin === null ? "Unavailable" : day.latencyMin.toFixed(1)}</td>
<td>${day.humanReplies}</td><td>${day.repliesReadBack} / ${day.humanReplies}</td>
<td>${day.readBackAttempts} / ${day.readBackUnsuccessfulAttempts} · ${day.readBackSent} / ${day.readBackFailed} / ${day.readBackDropped} / ${day.readBackPending}</td>
<td>${day.quietNotices} · ${day.quietOutcome ?? "Unresolved / none"}${day.quietUseful === null ? null : day.quietUseful ? " · useful" : " · not useful"}${day.away ? " · away" : null}</td></tr>`;
}

function recipient(data: TrialRecipientReport): Html {
  const s = data.summary;
  return html`<section><h2>Recipient ${data.recipientId}${data.lightOn ? " · kept light" : null}</h2>
${data.lightOn ? html`<h3>The four numbers</h3>${numbersTable(s)}` : null}
<p>${data.from} through ${data.through} · ${data.timezone}. ${data.unobservedDays} calendar days have no prepared exchange; review consent, pauses, away periods and scheduling evidence before assigning an eligible-day denominator.</p>
<dl><dt>Recorded scheduled days</dt><dd>${s.recordedDays} · delivered ${s.deliveredDays} · terminal delivery failures ${s.failedDays}</dd>
<dt>Answered recorded days</dt><dd>${rate(s.answeredDays, s.recordedDays)}; this retains failed deliveries and is provisional until eligibility is reconciled.</dd>
<dt>Family / fallback asks</dt><dd>${s.recordedDays - s.fallbackDays} / ${s.fallbackDays}. Fallback share: ${rate(s.fallbackDays, s.recordedDays)}</dd>
<dt>Answer records</dt><dd>${s.answerCount}</dd>
<dt>Median answer latency</dt><dd>${s.medianLatencyMin === null ? "Unavailable" : `${s.medianLatencyMin.toFixed(1)} minutes`} · ${s.latencySamples} nonnegative samples; ${s.preArrivalAnswers} answers before arrival are shown separately.</dd>
<dt>Human replies per answer</dt><dd>${s.humanReplies} / ${s.answerCount}${s.answerCount === 0 ? " · unavailable" : ` = ${(s.humanReplies / s.answerCount).toFixed(2)}`}. Text, voice and photo replies to the recipient; reactions and conversation between other members are excluded.</dd>
<dt>Human replies read back</dt><dd>${s.repliesReadBack} / ${s.humanReplies}. Delivery is not proof of reading or listening.</dd></dl>
${data.expiredArrivalMetadata === 0 ? null : html`<p class="notice">${data.expiredArrivalMetadata} arrival records have expired send metadata. Read-back attempt and send-state counts below may be incomplete; retained reply read-back stamps remain visible.</p>`}
<p>Attempt columns show total / unsuccessful recorded attempts, so a successful retry does not hide earlier failures. Unsuccessful attempts include recovery of interrupted sends; Telegram may have accepted part of a message before a failure. Send-state columns show sent / failed / dropped / queued records. A queued send can be in progress. These are not counts of messages read.</p>
<table><thead><tr><th>Local day</th><th>Ask origin</th><th>Arrival attempts / unsuccessful</th><th>Arrival send states</th><th>Day delivery</th><th>Answers</th><th>Latency (min)</th><th>Human replies</th><th>Replies read back</th><th>Read-back attempts / unsuccessful · send states</th><th>Quiet notices · outcome</th></tr></thead>
<tbody>${data.days.map(dayRow)}</tbody></table></section>`;
}

export function renderTrialReport(report: TrialReport): Response {
  const path = `${familyHref(report.familyId)}/trial`;
  return page(
    "Trial counts · Vela admin",
    html`<h1>Trial counts</h1>
<p><a href="${familyHref(report.familyId)}">Family page</a> · <a href="${path}?days=7">Seven days</a> · <a href="${path}?days=30">30 days</a></p>
<p class="lede">Last ${report.windowDays} complete recipient-local days. Generated ${report.generatedAt.toISOString()}. Refresh to include later answers and read-backs.</p>
<p>Counts only. No family words or media are included. Failed deliveries stay visible. Contentful-answer assessment, comfort, usefulness, assistance, stop reasons and eligibility reconciliation require the separately authorised trial notes. These results are early evidence; they do not establish loneliness reduction or product-market fit.</p>
${report.recipients.length === 0 ? html`<p>No prepared exchanges are recorded in this period. This does not prove scheduled delivery or consent.</p>` : report.recipients.map(recipient)}`,
  );
}

export function renderTrialOverview(overview: TrialOverview): Response {
  const path = `${ADMIN_PATH}/trial`;
  const parents = overview.parents.length;
  return page(
    "Trial numbers · Vela admin",
    html`<h1>Trial numbers</h1>
<p><a href="${ADMIN_PATH}">Overview</a> · <a href="${path}?days=7">Seven days</a> · <a href="${path}?days=30">30 days</a></p>
<p class="lede">Every kept-light member, last ${overview.windowDays} complete local days. Generated ${overview.generatedAt.toISOString()}. Counts only; each family read is logged.</p>
${
  parents === 0
    ? html`<p>No kept-light member yet.</p>`
    : html`<h2>All kept-light members together</h2>
<p>${parents} kept-light ${parents === 1 ? "member" : "members"}; ${overview.parentsWhoStopped} said stop in this window (${pct(overview.parentsWhoStopped / parents)}).</p>
${numbersTable(overview.totals)}
<h2>Each kept-light member</h2>
<table><thead><tr><th>Family</th><th>Recipient</th>${trialNumbers(overview.totals).map((n) => html`<th>${NUMBER_LABEL[n.key].name}</th>`)}</tr></thead>
<tbody>${overview.parents.map(
        ({ familyId, report }) =>
          html`<tr><td><a href="${familyHref(familyId)}/trial?days=${overview.windowDays}">${familyId.slice(0, 8)}</a></td><td>${report.recipientId.slice(0, 8)}</td>${trialNumbers(report.summary).map((n) => html`<td class="status-${n.status}">${numberValue(n)} · ${STATUS_LABEL[n.status]}</td>`)}</tr>`,
      )}</tbody></table>`
}
<p class="muted">Targets come from plan/product-week.md and research/14. A status is "too early" until the number has its minimum sample. Missed real trouble cannot be counted from events: the founder confirms it on the day 14 and day 30 calls.</p>`,
  );
}
