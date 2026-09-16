/**
 * The founder's two server-rendered pages (code design §9, flows §3.17). The overview carries no
 * family content at all: states, times, kinds, counts, and the codes of failed sends. The family
 * page carries the records the founder needs to act on — summaries, flag quotes, AI outputs — and
 * every write on it is a POST form to `/admin/families/:familyId/:action`.
 *
 * Nothing here queries or decides: it renders what `@vela/services` returned, escaped.
 */
import type { AdminOverviewRow, FailedOutboundRow, FamilyPage } from "@vela/services";
import { type Html, html, page, type Renderable } from "./html.ts";

const DASH = "—";

/**
 * The two paths, as `ADMIN_OVERVIEW_PATH` and `familyPagePath` in `@vela/services` shape them:
 * `adminLink` puts the family one in every admin message, so the two must stay the same. They are
 * repeated rather than imported because this file keeps the services module graph (and with it
 * the Postgres driver) out of the pages and their tests.
 */
export const ADMIN_PATH = "/admin";

function instant(value: Date | null): string {
  return value === null ? DASH : value.toISOString().replace(".000Z", "Z");
}

function text(value: string | null): string {
  return value === null || value === "" ? DASH : value;
}

function flag(value: boolean): string {
  return value ? "yes" : "no";
}

function json(value: unknown, limit: number): string {
  if (value === null || value === undefined) {
    return DASH;
  }
  const serialised = JSON.stringify(value);
  return serialised.length > limit ? `${serialised.slice(0, limit)}…` : serialised;
}

function table(headings: readonly string[], rows: readonly Renderable[]): Html {
  if (rows.length === 0) {
    return html`<p class="muted">None.</p>`;
  }
  return html`<table><thead><tr>${headings.map((heading) => html`<th>${heading}</th>`)}</tr></thead>
<tbody>${rows}</tbody></table>`;
}

/** The id is encoded: it reaches here from a path and leaves in an href and a `Location`. */
export function familyHref(familyId: string): string {
  return `${ADMIN_PATH}/families/${encodeURIComponent(familyId)}`;
}

// The overview --------------------------------------------------------------------------------------

function overviewRow(row: AdminOverviewRow): Html {
  const kept = row.keptLight;
  const today = row.today;
  const quiet = row.quiet;
  return html`<tr>
<td><a href="${familyHref(row.family.id)}">${row.family.name}</a><br><span class="muted">${row.family.region} · ${row.family.language}${row.family.deletedAt === null ? null : html` · <b>deletion requested</b>`}</span></td>
<td>${kept === null ? DASH : html`${kept.status}${kept.lightOn ? ", light on" : ", light off"}<br><span class="muted">${kept.tz} · ${kept.localToday}</span>`}</td>
<td>${kept === null ? DASH : instant(kept.nextWakeAt)}</td>
<td>${today === null ? DASH : html`${today.type} · ${today.state}`}</td>
<td>${today === null ? DASH : html`sent ${instant(today.deliveredAt)}<br>failed ${instant(today.deliveryFailedAt)}<br>repeat ${instant(today.repeatedAt)}<br>answered ${instant(today.answeredAt)}`}</td>
<td>${quiet === null ? DASH : html`open ${instant(quiet.openedAt)}<br>notices ${quiet.notifyCount}<br>wait ${instant(quiet.waitUntil)}<br>${text(quiet.outcome)} ${instant(quiet.resolvedAt)}`}</td>
<td>${row.answers.length === 0 ? DASH : row.answers.map((answer) => html`${answer.kind} · ${answer.understoodAt === null ? `not understood (${answer.processingAttempts})` : "understood"}${answer.flag ? " · flagged" : ""}<br>`)}</td>
<td class="num">${row.ai.calls} / ${row.ai.failures}</td>
</tr>`;
}

function failedOutboundRow(row: FailedOutboundRow): Html {
  return html`<tr>
<td>${instant(row.queuedAt)}</td>
<td><a href="${familyHref(row.family.id)}">${row.family.name}</a></td>
<td>${row.kind}<br><span class="muted">${row.id}</span></td>
<td><span class="muted">${row.memberId}</span></td>
<td>${row.status}</td>
<td class="num">${row.attempts}</td>
<td><code>${row.errorCode}</code></td>
</tr>`;
}

/**
 * The sends that did not go out, as services return them: ids, kind, state, attempts, and the
 * code in front of the stored error. What was sent, and the platform's own description, never
 * reach this page. The id matches the `what` of the view rows services write for this section.
 */
function failedOutboundSection(rows: readonly FailedOutboundRow[]): Html {
  return html`<section id="failed-outbound"><h2>Failed sends</h2>
<p class="muted">The most recent sends that failed or were dropped, newest first. The time is when the last attempt was due; the code is the platform's or the gateway's reason.</p>
${
  rows.length === 0
    ? html`<p class="muted">No send has failed or been dropped.</p>`
    : table(
        ["Last due (UTC)", "Family", "Kind", "Member", "Status", "Attempts", "Code"],
        rows.map(failedOutboundRow),
      )
}</section>`;
}

export function renderOverview(
  rows: readonly AdminOverviewRow[],
  failedOutbound: readonly FailedOutboundRow[],
): Response {
  const body = html`<h1>Vela admin</h1>
<p class="lede">Every family, as of this page load. No words from any family appear here: states, times, kinds, counts, and codes only.</p>
${table(
  [
    "Family",
    "Kept light",
    "Next wake",
    "Today",
    "Times (UTC)",
    "Quiet",
    "Answers today",
    "AI 24 h (calls / failures)",
  ],
  rows.map(overviewRow),
)}
${failedOutboundSection(failedOutbound)}`;
  return page("Vela admin", body);
}

// The family page -----------------------------------------------------------------------------------

function hidden(name: string, value: string): Html {
  return html`<input type="hidden" name="${name}" value="${value}">`;
}

function actionForm(familyId: string, action: string, fields: Renderable, label: string): Html {
  return html`<form class="action" method="post" action="${familyHref(familyId)}/${action}">${fields}<button type="submit">${label}</button></form>`;
}

function consentFields(): Html {
  return html`<label>Text version<input name="textVersion" value="pilot-2026-09" required></label>
<label>Language<select name="lang"><option value="en">en</option><option value="zh-TW">zh-TW</option></select></label>
<label>Channel<input name="channel" value="telegram" required></label>
<label>Note (evidence)<input name="note" required></label>`;
}

/**
 * One departure, typed out before it is sent (the route checks the word): the kept-light member's
 * cannot be undone, and a one-click button beside a sibling's is an easy slip.
 */
function markLeftForm(familyId: string, { member }: FamilyPage["members"][number]): Html {
  return actionForm(
    familyId,
    "mark_left",
    html`${hidden("memberId", member.id)}<label>Type <code>left</code> to confirm<input name="confirm" required></label>`,
    `Mark ${member.displayName} left`,
  );
}

function membersSection(data: FamilyPage): Html {
  const rows = data.members.map(
    ({ member, link }) => html`<tr>
<td>${member.displayName}<br><span class="muted">${member.id}</span></td>
<td>${member.role}${member.lightOn ? " · kept light" : ""}</td>
<td>${member.status}${member.leftAt === null ? null : html`<br><span class="muted">left ${instant(member.leftAt)}</span>`}</td>
<td>${member.language} · ${member.tz}<br><span class="muted">arrival ${member.arrivalTime} · starts ${text(member.lightStartsOn)}</span></td>
<td>${link === null ? "no Telegram link" : link.blockedAt === null ? "linked" : `blocked ${instant(link.blockedAt)}`}</td>
<td>${instant(member.lightConsentedAt)}</td>
</tr>`,
  );
  const keptLight = data.members.filter(({ member }) => member.lightOn);
  // Services clear the schedule of a member whose light is on or who has consented, so those
  // departures are set apart; marking deceased stays with a light that is on.
  const leavingLight = data.members.filter(isKeptLight);
  const leavingOthers = data.members.filter((entry) => !isKeptLight(entry));
  return html`<section id="members"><h2>Members</h2>
${table(["Member", "Role", "Status", "Local", "Channel", "Consented"], rows)}
<h3>Record a consent</h3>
${actionForm(
  data.family.id,
  "record_consent",
  html`<label>Member<select name="memberId">${data.members.map(({ member }) => html`<option value="${member.id}">${member.displayName}</option>`)}</select></label>
<label>Kind<select name="kind"><option value="pilot">pilot</option><option value="privacy_notice">privacy_notice</option></select></label>
<label>Given at (UTC)<input type="datetime-local" name="givenAt" required></label>
${consentFields()}`,
  "Record consent",
)}
<h3>Mark a member left</h3>
<p class="muted">They leave the turn rotation, and retention deletes them 30 days on. Someone with the member role who takes part in the group again becomes active.</p>
${leavingOthers.map((entry) => markLeftForm(data.family.id, entry))}
${
  leavingLight.length === 0
    ? null
    : html`<h3>Mark the kept-light member left</h3><p class="muted">Her light goes out for good: her schedule is cleared, the family's queued messages are dropped, and her own messages are ignored, so nothing on this page and nothing she sends switches it back on. Retention deletes her 30 days on.</p>
${leavingLight.map((entry) => markLeftForm(data.family.id, entry))}`
}
${
  keptLight.length === 0
    ? null
    : html`<h3>Mark the kept-light member deceased</h3><p class="muted">Nothing is sent to anyone, and no arrival, repeat, quiet notice, or turn prompt follows.</p>
${keptLight.map(({ member }) => actionForm(data.family.id, "mark_deceased", hidden("memberId", member.id), `Mark ${member.displayName} deceased`))}`
}
</section>`;
}

function consentsSection(data: FamilyPage): Html {
  const rows = data.consents.map(
    (consent) => html`<tr>
<td>${consent.kind}</td>
<td>${text(consent.memberId)}</td>
<td>${text(consent.contactId)}</td>
<td>${consent.textVersion} · ${consent.lang} · ${consent.channel}</td>
<td>${instant(consent.givenAt)}</td>
<td>${instant(consent.withdrawnAt)}</td>
</tr>`,
  );
  return html`<section id="consents"><h2>Consents</h2>
${table(["Kind", "Member", "Contact", "Text", "Given", "Withdrawn"], rows)}</section>`;
}

/** Services' rule for a kept-light member: the light is on, or she has consented and it is off. */
function isKeptLight({ member }: FamilyPage["members"][number]): boolean {
  return member.lightOn || member.lightConsentedAt !== null;
}

/**
 * Whose contacts these are, as the add-contact select offers them: every member of the family, as
 * `addContact` accepts, kept-light members first so the option already chosen is hers. Filtering to
 * the light alone would empty the select in exactly the window the founder needs it — between her
 * invitation and her Yes, which is when the onboarding call collects these numbers.
 */
function contactMembers(data: FamilyPage): FamilyPage["members"] {
  return [
    ...data.members.filter(isKeptLight),
    ...data.members.filter((entry) => !isKeptLight(entry)),
  ];
}

function contactsSection(data: FamilyPage): Html {
  const rows = data.nearbyContacts.map(
    (contact) => html`<tr>
<td>${contact.name}<br><span class="muted">${text(contact.relation)}</span></td>
<td>${contact.phone}</td>
<td>${text(contact.channel)}</td>
<td>${instant(contact.consentedAt)}</td>
<td>${instant(contact.declinedAt)}</td>
<td>${actionForm(data.family.id, "record_contact_consent", html`${hidden("contactId", contact.id)}<label>Answer<select name="answer"><option value="yes">yes</option><option value="no">no</option></select></label><label>At (UTC)<input type="datetime-local" name="at" required></label>${consentFields()}`, "Record")}
${actionForm(data.family.id, "remove_contact", hidden("contactId", contact.id), "Remove")}</td>
</tr>`,
  );
  return html`<section id="contacts"><h2>Nearby contacts</h2>
<p class="muted">A contact is listed in a quiet notice only after they have said yes themselves. Vela never contacts them.</p>
${table(["Name", "Phone", "Channel", "Consented", "Declined", "Actions"], rows)}
<h3>Add a contact</h3>
${actionForm(
  data.family.id,
  "add_contact",
  html`<label>Member they are near<select name="memberId">${contactMembers(data).map((entry) => html`<option value="${entry.member.id}">${entry.member.displayName}${isKeptLight(entry) ? " · kept light" : ""}</option>`)}</select></label>
<label>Name<input name="name" required></label>
<label>Phone<input name="phone" required></label>
<label>Relation<input name="relation"></label>
<label>Channel<select name="channel"><option value="">none</option><option value="line">line</option><option value="whatsapp">whatsapp</option><option value="telegram">telegram</option><option value="sms">sms</option></select></label>`,
  "Add contact",
)}</section>`;
}

function awaySection(data: FamilyPage): Html {
  const rows = data.awayPeriods.map(
    (period) => html`<tr>
<td>${period.fromDate} → ${text(period.toDate)}</td>
<td>${period.source}</td>
<td>${instant(period.endedAt)}</td>
<td>${period.endedAt === null ? actionForm(data.family.id, "end_away", hidden("awayPeriodId", period.id), "End") : null}</td>
</tr>`,
  );
  const organisers = data.members.filter(({ member }) => member.role === "organiser");
  return html`<section id="away"><h2>Away periods</h2>
${table(["Dates", "Source", "Ended", ""], rows)}
<h3>Set away</h3>
${actionForm(
  data.family.id,
  "set_away",
  html`<label>Member<select name="memberId">${data.members.map(({ member }) => html`<option value="${member.id}">${member.displayName}</option>`)}</select></label>
<label>Asked by<select name="setBy">${organisers.map(({ member }) => html`<option value="${member.id}">${member.displayName}</option>`)}</select></label>
<label>From<input type="date" name="from" required></label>
<label>Until (open ended if empty)<input type="date" name="until"></label>`,
  "Set away",
)}</section>`;
}

function answerRow(answer: FamilyPage["answers"][number]): Html {
  return html`<tr id="answer-${answer.id}">
<td>${text(answer.scheduledFor)}<br><span class="muted">${instant(answer.receivedAt)}</span></td>
<td>${answer.kind}</td>
<td>${text(answer.summary)}</td>
<td>${answer.moodWords.length === 0 ? DASH : answer.moodWords.join(", ")}</td>
<td>${answer.understoodAt === null ? `no (${answer.processingAttempts} attempts)` : "yes"}</td>
<td>${flag(answer.flag)}</td>
</tr>`;
}

const ANSWER_HEADINGS = ["Day", "Kind", "Summary", "Mood", "Understood", "Flag"] as const;

function answersSection(data: FamilyPage): Html {
  return html`<section id="answers"><h2>Answers</h2>
${table(ANSWER_HEADINGS, data.answers.map(answerRow))}

<h2 id="flags">Flagged answers</h2>
<p class="muted">Organisers already received her words; this is the record behind the admin message.</p>
${table(
  ["Day", "Kind", "Summary", "Reason", "Flag"],
  data.flagged.map(
    (answer) => html`<tr id="flag-${answer.id}">
<td>${text(answer.scheduledFor)}<br><span class="muted">${instant(answer.receivedAt)}</span></td>
<td>${answer.kind}</td>
<td>${text(answer.summary)}</td>
<td>${text(answer.flagReason)}</td>
<td>${flag(answer.flag)}</td>
</tr>`,
  ),
)}

<h2 id="not-understood">Answers the re-run could not read</h2>
${table(ANSWER_HEADINGS, data.notUnderstood.map(answerRow))}
</section>`;
}

function weeklyReadsSection(data: FamilyPage): Html {
  const reads = data.weeklyReads.map((entry) => {
    const { read } = entry;
    const sent = read.sentAt !== null;
    return html`<article id="weekly-read-${read.id}">
<h3>Week ${read.weekStart} → ${entry.weekEnd}${sent ? html` <span class="muted">sent ${instant(read.sentAt)}</span>` : null}</h3>
<p class="muted">Counts, as organisers will read them (not editable):</p>
<pre>${text(entry.countLines)}</pre>
${
  sent
    ? html`<p>Sent lines:</p><pre>${(read.sentLines ?? []).join("\n")}</pre><p>Sent suggestion: ${text(read.sentSuggestion)}</p>`
    : actionForm(
        data.family.id,
        "send_weekly_read",
        html`${hidden("weeklyReadId", read.id)}
<label>Lines (one per line, at most four)<textarea name="lines">${read.lines.join("\n")}</textarea></label>
<label>Suggestion (empty removes it)<input name="suggestion" value="${text(read.suggestion) === DASH ? "" : read.suggestion}"></label>`,
        "Send to organisers",
      )
}
</article>`;
  });
  return html`<section id="weekly-reads"><h2>Weekly reads</h2>
<p class="muted">She can read the sent lines, in her language, by asking what the family sees. She never sees the counts or the suggestion.</p>
${data.weeklyReads.length === 0 ? html`<p class="muted">None.</p>` : reads}</section>`;
}

function aiSection(data: FamilyPage): Html {
  const rows = data.aiCalls.map(
    (call) => html`<tr>
<td>${instant(call.at)}</td>
<td>${call.call}<br><span class="muted">${call.model} · ${call.promptVersion}</span></td>
<td>${flag(call.ok)}</td>
<td class="num">${call.tokensIn ?? DASH} / ${call.tokensOut ?? DASH}</td>
<td class="num">${call.latencyMs ?? DASH}</td>
<td>${json(call.output, 300)}</td>
</tr>`,
  );
  return html`<section id="ai"><h2>AI calls</h2>
${table(["At (UTC)", "Call", "Ok", "Tokens in / out", "ms", "Output"], rows)}</section>`;
}

function dangerSection(data: FamilyPage): Html {
  return html`<section id="delete"><h2>Delete this family</h2>
<p class="muted">Sets the deletion request. Ticks and reconciliation stop at once, queued messages are dropped, and retention removes everything within 24 hours.</p>
${
  data.family.deletedAt === null
    ? actionForm(
        data.family.id,
        "delete_family",
        html`<label>Type <code>delete</code> to confirm<input name="confirm" required></label>`,
        "Request deletion",
      )
    : html`<p>Deletion requested ${instant(data.family.deletedAt)}.</p>`
}</section>`;
}

/** The result of a form, shown at the top of the page the browser was redirected back to. */
export function noticeFor(result: string | null): Html | null {
  if (result === null || result === "") {
    return null;
  }
  const messages: Record<string, string> = {
    sent: "The weekly read was sent to the organisers.",
    already_sent: "That weekly read was already sent; nothing changed.",
    no_organiser:
      "No active organiser has a Telegram link, so nothing was sent, stored, or logged.",
    budget:
      "Each organiser already received a weekly read today, so nothing was sent, stored, or logged. Send it tomorrow.",
    done: "Done.",
  };
  const message = messages[result];
  return message === undefined ? null : html`<p class="notice">${message}</p>`;
}

export function renderFamilyPage(data: FamilyPage, notice: Html | null): Response {
  const body = html`<h1>${data.family.name}</h1>
<p class="lede"><a href="${ADMIN_PATH}">All families</a> ·${data.family.region} · ${data.family.language} · ${data.family.country} · created ${instant(data.family.createdAt)}</p>
${notice}
${membersSection(data)}
${consentsSection(data)}
${contactsSection(data)}
${awaySection(data)}
${answersSection(data)}
${weeklyReadsSection(data)}
${aiSection(data)}
${dangerSection(data)}`;
  return page(`${data.family.name} · Vela admin`, body);
}

/** A refusal or a failure: a heading and one sentence, never a stack trace. */
export function renderMessage(status: number, title: string, message: string): Response {
  return page(title, html`<h1>${title}</h1><p>${message}</p>`, status);
}
