import type { TrialDay, TrialRecipientReport, TrialReport } from "@vela/services";
import { familyHref } from "./admin-pages.ts";
import { type Html, html, page } from "./html.ts";

function rate(n: number, d: number): string {
  return d === 0 ? "Unavailable (no denominator)" : `${n} / ${d} (${((100 * n) / d).toFixed(1)}%)`;
}

function dayRow(day: TrialDay): Html {
  return html`<tr><td>${day.day}</td><td>${day.fallback ? "Fallback" : "Family ask"}</td>
<td>${day.arrivalAttempts} / ${day.arrivalUnsuccessfulAttempts}</td><td>${day.arrivalSent} / ${day.arrivalFailed} / ${day.arrivalDropped} / ${day.arrivalPending}</td>
<td>${day.delivered ? "Delivered" : day.failed ? "Failed" : "Not delivered"}${day.delivered && day.failed ? " · earlier failure" : ""}</td>
<td>${day.answered ? "Answered" : "No answer"} · ${day.answerCount}</td>
<td>${day.latencyMin === null ? "Unavailable" : day.latencyMin.toFixed(1)}</td>
<td>${day.humanReplies}</td><td>${day.repliesReadBack} / ${day.humanReplies}</td>
<td>${day.readBackAttempts} / ${day.readBackUnsuccessfulAttempts} · ${day.readBackSent} / ${day.readBackFailed} / ${day.readBackDropped} / ${day.readBackPending}</td>
<td>${day.quietNotices} · ${day.quietOutcome ?? "Unresolved / none"}</td></tr>`;
}

function recipient(data: TrialRecipientReport): Html {
  const s = data.summary;
  return html`<section><h2>Recipient ${data.recipientId}</h2>
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
