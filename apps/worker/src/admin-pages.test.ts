import type { FailedOutboundRow } from "@vela/services";
import { describe, expect, it } from "vitest";
import { renderFamilyPage, renderOverview } from "./admin-pages.ts";
import { familyPageFixture, memberFixture } from "./testing/fakes.ts";

describe("the overview's failed sends", () => {
  /** The section alone, from its opening tag to its close. */
  function failedSection(body: string): string {
    const start = body.indexOf('<section id="failed-outbound">');
    expect(start, "no failed-outbound section on the overview").toBeGreaterThan(-1);
    return body.slice(start, body.indexOf("</section>", start));
  }

  const failed: FailedOutboundRow = {
    id: "55555555-5555-7555-8555-555555555555",
    family: {
      id: "11111111-1111-7111-8111-111111111111",
      name: '<img src=x onerror="go()"> & Lin',
    },
    memberId: "22222222-2222-7222-8222-222222222222",
    kind: "quiet_notice",
    status: "dropped",
    attempts: 1,
    errorCode: "member_deceased",
    queuedAt: new Date("2026-09-14T06:10:00.000Z"),
  };

  it("lists each send by its code, time, kind, and attempts, linked to its family and escaped", async () => {
    const section = failedSection(await renderOverview([], [failed]).text());

    expect(section).toContain(
      '<a href="/admin/families/11111111-1111-7111-8111-111111111111">&lt;img src=x onerror=&quot;go()&quot;&gt; &amp; Lin</a>',
    );
    expect(section).not.toContain("<img");
    expect(section).toContain("<td>2026-09-14T06:10:00Z</td>");
    expect(section).toContain(`<td>quiet_notice<br><span class="muted">${failed.id}</span></td>`);
    expect(section).toContain(`<span class="muted">${failed.memberId}</span>`);
    expect(section).toContain("<td>dropped</td>");
    expect(section).toContain('<td class="num">1</td>');
    expect(section).toContain("<td><code>member_deceased</code></td>");
  });

  it("says no send has failed when services returned none", async () => {
    const section = failedSection(await renderOverview([], []).text());

    expect(section).toContain("No send has failed or been dropped.");
    expect(section).not.toContain("<table");
  });
});

/** One form of the family page, from its `action` to its closing tag. */
function formFor(body: string, familyId: string, action: string): string {
  const start = body.indexOf(`action="/admin/families/${familyId}/${action}"`);
  expect(start, `no ${action} form on the page`).toBeGreaterThan(-1);
  const end = body.indexOf("</form>", start);
  return body.slice(start, end);
}

async function render(page: ReturnType<typeof familyPageFixture>): Promise<string> {
  return renderFamilyPage(page, null).text();
}

describe("the add-contact form", () => {
  it("offers her before she has consented, which is when the call collects the numbers", async () => {
    const her = memberFixture();
    const page = familyPageFixture({ members: [her] });

    const form = formFor(await render(page), page.family.id, "add_contact");

    expect(her.member.lightOn).toBe(false);
    expect(her.member.lightConsentedAt).toBeNull();
    expect(form).toContain(`<option value="${her.member.id}">`);
  });

  it("offers the kept-light member first, so the option already chosen is hers", async () => {
    const organiser = memberFixture({
      id: "33333333-3333-7333-8333-333333333333",
      role: "organiser",
      displayName: "Mia",
    });
    const her = memberFixture({ lightOn: true, status: "active" });
    const page = familyPageFixture({ members: [organiser, her] });

    const form = formFor(await render(page), page.family.id, "add_contact");

    expect(form.indexOf(her.member.id)).toBeLessThan(form.indexOf(organiser.member.id));
  });
});

describe("the mark-deceased form", () => {
  it("is offered for a member whose light is on", async () => {
    const her = memberFixture({ lightOn: true, status: "active" });
    const page = familyPageFixture({ members: [her] });

    const form = formFor(await render(page), page.family.id, "mark_deceased");

    expect(form).toContain(`value="${her.member.id}"`);
  });

  it("is not offered once the light is off, so a member cannot be marked deceased twice", async () => {
    const her = memberFixture({
      lightOn: false,
      lightConsentedAt: new Date("2026-09-02T00:00:00.000Z"),
      status: "deceased",
    });
    const page = familyPageFixture({ members: [her] });

    expect(await render(page)).not.toContain("mark_deceased");
  });
});

describe("the mark-left forms", () => {
  const organiser = memberFixture({
    id: "33333333-3333-7333-8333-333333333333",
    role: "organiser",
    displayName: "Mia",
    status: "active",
  });
  const her = memberFixture({
    lightOn: true,
    lightConsentedAt: new Date("2026-09-02T00:00:00.000Z"),
    status: "active",
  });

  /** Every mark-left form on the page, in page order. */
  function markLeftForms(body: string, familyId: string): string[] {
    return body
      .split(`action="/admin/families/${familyId}/mark_left"`)
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf("</form>")));
  }

  it("asks for every departure to be typed out, which the route checks", async () => {
    const page = familyPageFixture({ members: [organiser, her] });

    const forms = markLeftForms(await render(page), page.family.id);

    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form).toContain('<input name="confirm" required>');
    }
  });

  it("sets her departure apart, under what it puts out for good", async () => {
    const page = familyPageFixture({ members: [her, organiser] });
    const body = await render(page);

    const heading = body.indexOf("<h3>Mark the kept-light member left</h3>");
    const hers = body.indexOf(`name="memberId" value="${her.member.id}"><label>Type`);
    const theirs = body.indexOf(`name="memberId" value="${organiser.member.id}"><label>Type`);

    expect(heading).toBeGreaterThan(-1);
    expect(body.slice(heading, hers)).toContain(
      "nothing on this page and nothing she sends switches it back on",
    );
    expect(theirs).toBeGreaterThan(-1);
    expect(theirs).toBeLessThan(heading);
  });

  it("sets apart a member who has consented, whose schedule a departure clears too", async () => {
    const consented = memberFixture({
      lightOn: false,
      lightConsentedAt: new Date("2026-09-02T00:00:00.000Z"),
      status: "paused",
    });
    const page = familyPageFixture({ members: [consented] });
    const body = await render(page);

    const heading = body.indexOf("<h3>Mark the kept-light member left</h3>");
    expect(heading).toBeGreaterThan(-1);
    expect(body.indexOf(`value="${consented.member.id}"><label>Type`)).toBeGreaterThan(heading);
  });
});

describe("the invite-again form", () => {
  const organiser = memberFixture({
    id: "33333333-3333-7333-8333-333333333333",
    role: "organiser",
    displayName: "Mia",
    status: "active",
  });

  it("is offered after a No, when nobody waits, naming no member to replace", async () => {
    const page = familyPageFixture({ members: [organiser] });

    const form = formFor(await render(page), page.family.id, "create_invite");

    expect(form).toContain('<input type="hidden" name="replacesMemberId" value="">');
    expect(form).toContain(`<option value="${organiser.member.id}">Mia</option>`);
    expect(form).toContain('<input name="confirm" required>');
    for (const name of ["name", "address", "language", "country", "timeZone", "wakeTime"]) {
      expect(form).toContain(`name="${name}"`);
    }
    expect(form).toContain('<option value="ZZ">Other</option>');
  });

  it("names the invited member who never answered, whose link the new one replaces", async () => {
    const waiting = memberFixture();
    const page = familyPageFixture({ members: [organiser, waiting] });
    const body = await render(page);

    const form = formFor(body, page.family.id, "create_invite");

    expect(form).toContain(
      `<input type="hidden" name="replacesMemberId" value="${waiting.member.id}">`,
    );
    expect(body).toContain("Mom's earlier link stops working");
  });

  it.each([
    ["her light is on", memberFixture({ lightOn: true, status: "active" })],
    [
      "she consented and paused",
      memberFixture({ lightConsentedAt: new Date("2026-09-02T00:00:00.000Z"), status: "paused" }),
    ],
  ])("is not offered when %s", async (_state, her) => {
    const page = familyPageFixture({ members: [organiser, her] });

    expect(await render(page)).not.toContain("create_invite");
  });

  it("is not offered for a family that asked to be deleted", async () => {
    const page = familyPageFixture({ members: [organiser] });
    const deleted = {
      ...page,
      family: { ...page.family, deletedAt: new Date("2026-09-16T00:00:00Z") },
    };

    expect(await render(deleted)).not.toContain("create_invite");
  });
});

describe("the nearby contacts section", () => {
  const her = memberFixture();
  const contact = {
    id: "44444444-4444-7444-8444-444444444444",
    familyId: her.member.familyId,
    memberId: her.member.id,
    name: "Auntie Lin",
    relation: "neighbour",
    phone: null,
    channel: null,
    consentRequestedAt: null,
    consentedAt: null,
    declinedAt: null,
    createdAt: new Date("2026-09-15T00:00:00.000Z"),
  };

  it("shows a contact named at setup without a number, and asks for the number with the answer", async () => {
    const page = familyPageFixture({ members: [her], nearbyContacts: [contact] });
    const body = await render(page);

    expect(body).toContain(
      '<td>Auntie Lin<br><span class="muted">neighbour</span></td>\n<td>—</td>',
    );
    const answer = formFor(body, page.family.id, "record_contact_consent");
    expect(answer).toContain('<input name="phone">');
  });

  it("takes a number on the add-contact form only inside the contact's yes", async () => {
    const page = familyPageFixture({ members: [her] });

    const form = formFor(await render(page), page.family.id, "add_contact");
    const yes = form.slice(form.indexOf("<fieldset>"), form.indexOf("</fieldset>"));

    expect(form.indexOf('name="phone"')).toBeGreaterThan(form.indexOf("<fieldset>"));
    for (const name of ["phone", "consentAt", "textVersion", "lang", "consentChannel", "note"]) {
      expect(yes).toContain(`name="${name}"`);
    }
  });
});
