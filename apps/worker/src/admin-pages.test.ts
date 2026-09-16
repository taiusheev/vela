import { describe, expect, it } from "vitest";
import { renderFamilyPage } from "./admin-pages.ts";
import { familyPageFixture, memberFixture } from "./testing/fakes.ts";

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
