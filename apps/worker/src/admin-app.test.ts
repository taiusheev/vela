import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { NEARBY_CONTACT_CHANNELS } from "@vela/db";
import { type FailedOutboundRow, VelaError } from "@vela/services";
import { describe, expect, it } from "vitest";
import { createAdminWorker } from "./admin-app.ts";
import type { AdminEnv } from "./env.ts";
import {
  adminTestEnv,
  argsOf,
  consoleLinesDuring,
  createFakeAdminRuntime,
  FAILED_QUERY_LABEL,
  FAILED_QUERY_WORDS,
  type FakeAdminRuntime,
  failedQueryFixture,
  familyPageFixture,
  namesOf,
} from "./testing/fakes.ts";

const ORIGIN = "https://vela-admin.worker.test";

/**
 * The admin Worker as it is deployed: `PUBLIC_BASE_URL` is the origin the founder's browser loaded
 * the admin page from, which is the only origin a form may be posted from (§9). A test about that
 * rule passes an environment whose base URL is somewhere else.
 */
const adminEnv: AdminEnv = { ...adminTestEnv, PUBLIC_BASE_URL: ORIGIN };

/** The admin Worker, handed fakes: the entry the admin config deploys, not only its routes. */
async function send(
  fake: FakeAdminRuntime,
  request: Request,
  env: AdminEnv = adminEnv,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await createAdminWorker(fake.runtime).fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function formRequest(path: string, form: Record<string, string>, origin: string | null): Request {
  const body = new URLSearchParams(form);
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (origin !== null) {
    headers.set("Origin", origin);
  }
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body });
}

describe("the admin Worker's addresses", () => {
  it("sends its bare address to the overview", async () => {
    const fake = createFakeAdminRuntime({ admin: null });

    const response = await send(fake, new Request(`${ORIGIN}/`));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin");
    expect(namesOf(fake.calls)).toEqual([]);
  });

  // The webhook, the notices, and the health check are the pilot Worker's: Access closes this
  // Worker to Telegram, so nothing of the pilot's may answer here.
  it.each([
    ["POST", "/webhooks/telegram"],
    ["GET", "/healthz"],
    ["GET", "/privacy"],
  ])("answers 404 to %s %s and builds nothing", async (method, path) => {
    const fake = createFakeAdminRuntime();

    const response = await send(fake, new Request(`${ORIGIN}${path}`, { method }));

    expect(response.status).toBe(404);
    expect(fake.built()).toBe(0);
  });

  it("logs a failed page by its error label, never by the message that carries the family's words", async () => {
    const fake = createFakeAdminRuntime({
      services: {
        loadAdminOverview: async () => {
          throw failedQueryFixture();
        },
      },
    });

    const { result: response, lines } = await consoleLinesDuring(() =>
      send(fake, new Request(`${ORIGIN}/admin`)),
    );

    expect(response.status).toBe(500);
    expect(lines).toEqual([
      {
        level: "error",
        event: "request_failed",
        path: "/admin",
        method: "GET",
        error: FAILED_QUERY_LABEL,
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(FAILED_QUERY_WORDS);
    expect(fake.closed()).toBe(fake.built());
  });
});

describe("the admin pages", () => {
  it("refuses the overview without a valid Access token and reads nothing", async () => {
    const fake = createFakeAdminRuntime({ admin: null });

    const response = await send(fake, new Request(`${ORIGIN}/admin`));

    expect(response.status).toBe(401);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("reads the overview and its failed sends as the identity in the token", async () => {
    const failed: FailedOutboundRow = {
      id: "55555555-5555-7555-8555-555555555555",
      family: { id: "11111111-1111-7111-8111-111111111111", name: "The Lin family" },
      memberId: "22222222-2222-7222-8222-222222222222",
      kind: "arrival",
      status: "failed",
      attempts: 4,
      errorCode: "blocked",
      queuedAt: new Date("2026-09-14T00:35:00.000Z"),
    };
    const fake = createFakeAdminRuntime({
      admin: "founder@vela.test",
      services: { loadFailedOutbound: async () => [failed] },
    });

    const response = await send(fake, new Request(`${ORIGIN}/admin`));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(namesOf(fake.calls)).toEqual(["loadAdminOverview", "loadFailedOutbound"]);
    expect(argsOf(fake.calls, "loadAdminOverview")).toEqual([[{ admin: "founder@vela.test" }]]);
    expect(argsOf(fake.calls, "loadFailedOutbound")).toEqual([[{ admin: "founder@vela.test" }]]);
    expect(body).toContain(`<span class="muted">${failed.id}</span>`);
    expect(body).toContain("<code>blocked</code>");
    expect(fake.closed()).toBe(fake.built());
  });

  it("answers 404 for a family that is not recorded", async () => {
    const fake = createFakeAdminRuntime();
    const response = await send(
      fake,
      new Request(`${ORIGIN}/admin/families/11111111-1111-7111-8111-111111111111`),
    );

    expect(response.status).toBe(404);
  });

  it("answers 400 for an address that is not a family id, without failing the request", async () => {
    const refusal = new VelaError("invalid_payload", "view: 'not-a-uuid' is not a uuid");
    const fake = createFakeAdminRuntime({
      services: {
        loadFamilyPage: async () => {
          throw refusal;
        },
      },
    });

    const response = await send(fake, new Request(`${ORIGIN}/admin/families/not-a-uuid`));

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("is not a uuid");
    expect(fake.closed()).toBe(fake.built());
  });

  // A form's POST is a navigation, and the Fetch standard ("append a request `Origin` header") gives
  // one sent under the `no-referrer` policy the Origin `null`, which the same-origin check below
  // refuses: every admin action would answer 403 in a real browser. `same-origin` keeps the page's
  // own Origin on its forms and still sends no referrer to any other origin.
  it("serves the pages that hold the forms with a referrer policy that keeps their Origin", async () => {
    const page = familyPageFixture();
    const fake = createFakeAdminRuntime({ services: { loadFamilyPage: async () => page } });

    const overview = await send(fake, new Request(`${ORIGIN}/admin`));
    const familyPage = await send(fake, new Request(`${ORIGIN}/admin/families/${page.family.id}`));

    expect(overview.status).toBe(200);
    expect(familyPage.status).toBe(200);
    expect(await familyPage.text()).toContain('method="post"');
    expect(overview.headers.get("referrer-policy")).toBe("same-origin");
    expect(familyPage.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("escapes what a family wrote into its own name", async () => {
    const page = familyPageFixture();
    page.family.name = '<script>alert("x")</script>';
    const fake = createFakeAdminRuntime({ services: { loadFamilyPage: async () => page } });

    const response = await send(fake, new Request(`${ORIGIN}/admin/families/${page.family.id}`));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("<script>alert");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("an admin action", () => {
  const memberId = "22222222-2222-7222-8222-222222222222";
  const familyId = "11111111-1111-7111-8111-111111111111";
  const path = `/admin/families/${familyId}/mark_left`;

  it("refuses a post with no Origin header", async () => {
    const fake = createFakeAdminRuntime();

    const response = await send(fake, formRequest(path, { memberId }, null));

    expect(response.status).toBe(403);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a post from another origin", async () => {
    const fake = createFakeAdminRuntime();

    const response = await send(fake, formRequest(path, { memberId }, "https://elsewhere.example"));

    expect(response.status).toBe(403);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a post whose Origin is the hostname it arrived on rather than the public base", async () => {
    const fake = createFakeAdminRuntime();
    const deployed: AdminEnv = { ...adminEnv, PUBLIC_BASE_URL: "https://vela-admin.vela.example" };

    const response = await send(fake, formRequest(path, { memberId }, ORIGIN), deployed);

    expect(response.status).toBe(403);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("accepts a post from the public base, whichever hostname it arrived on", async () => {
    const fake = createFakeAdminRuntime();
    const deployed: AdminEnv = { ...adminEnv, PUBLIC_BASE_URL: "https://vela-admin.vela.example" };

    const response = await send(
      fake,
      formRequest(path, { memberId, confirm: "left" }, "https://vela-admin.vela.example"),
      deployed,
    );

    expect(response.status).toBe(303);
  });

  it("changes nothing when PUBLIC_BASE_URL is not a URL: that is a misconfigured deployment", async () => {
    const fake = createFakeAdminRuntime();
    const misconfigured: AdminEnv = { ...adminEnv, PUBLIC_BASE_URL: "vela-admin.vela.example" };

    const response = await send(fake, formRequest(path, { memberId }, ORIGIN), misconfigured);

    expect(response.status).toBe(500);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("refuses a post without a valid Access token", async () => {
    const fake = createFakeAdminRuntime({ admin: null });

    const response = await send(fake, formRequest(path, { memberId }, ORIGIN));

    expect(response.status).toBe(401);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("calls the action with the Access identity and the family it was posted from", async () => {
    const fake = createFakeAdminRuntime({ admin: "founder@vela.test" });

    const response = await send(fake, formRequest(path, { memberId, confirm: "left" }, ORIGIN));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/admin/families/${familyId}?result=done`);
    expect(argsOf(fake.calls, "markLeft")).toEqual([
      [{ admin: "founder@vela.test", familyId }, memberId],
    ]);
  });

  it("sends the weekly read as the founder edited it and says what came back", async () => {
    const weeklyReadId = "33333333-3333-7333-8333-333333333333";
    const fake = createFakeAdminRuntime({ services: { sendWeeklyRead: async () => "budget" } });

    const response = await send(
      fake,
      formRequest(
        `/admin/families/${familyId}/send_weekly_read`,
        {
          weeklyReadId,
          lines: "She walked to the market.\n\nThe cat is well.\n",
          suggestion: "Ask about the market",
        },
        ORIGIN,
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/admin/families/${familyId}?result=budget`);
    expect(argsOf(fake.calls, "sendWeeklyRead")).toEqual([
      [
        { admin: "founder@vela.test", familyId },
        {
          weeklyReadId,
          lines: ["She walked to the market.", "The cat is well."],
          suggestion: "Ask about the market",
        },
      ],
    ]);
  });

  it("deletes a family only when the word is typed", async () => {
    const fake = createFakeAdminRuntime();

    const refused = await send(
      fake,
      formRequest(`/admin/families/${familyId}/delete_family`, { confirm: "" }, ORIGIN),
    );
    expect(refused.status).toBe(400);
    expect(namesOf(fake.calls)).toEqual([]);

    const accepted = await send(
      fake,
      formRequest(`/admin/families/${familyId}/delete_family`, { confirm: "delete" }, ORIGIN),
    );
    expect(accepted.status).toBe(303);
    expect(argsOf(fake.calls, "deleteFamily")).toEqual([
      [{ admin: "founder@vela.test", familyId }, familyId],
    ]);
  });

  it("adds a contact on every channel a nearby contact can be reached on", async () => {
    const fake = createFakeAdminRuntime();
    const contact = { memberId, name: "Auntie Lin", relation: "" };

    for (const channel of NEARBY_CONTACT_CHANNELS) {
      const response = await send(
        fake,
        formRequest(`/admin/families/${familyId}/add_contact`, { ...contact, channel }, ORIGIN),
      );
      expect(response.status).toBe(303);
    }

    expect(argsOf(fake.calls, "addContact")).toEqual(
      NEARBY_CONTACT_CHANNELS.map((channel) => [
        { admin: "founder@vela.test", familyId },
        { memberId, name: "Auntie Lin", relation: null, channel, yes: null },
      ]),
    );
  });

  // L8: a contact's number reaches the database only with their recorded yes.
  describe("the add-contact form's number", () => {
    const addPath = `/admin/families/${familyId}/add_contact`;
    const named = { memberId, name: "Auntie Lin", relation: "neighbour", channel: "line" };
    const theirYes = {
      phone: "+886 900 000 000",
      consentAt: "2026-09-16T09:15",
      textVersion: "nearby-contact-consent.zh-TW@1",
      lang: "zh-TW",
      consentChannel: "line",
      note: "replied yes to text A",
    };

    it("adds a name alone when the yes group is empty", async () => {
      const fake = createFakeAdminRuntime();

      const response = await send(fake, formRequest(addPath, named, ORIGIN));

      expect(response.status).toBe(303);
      expect(argsOf(fake.calls, "addContact")).toEqual([
        [
          { admin: "founder@vela.test", familyId },
          { memberId, name: "Auntie Lin", relation: "neighbour", channel: "line", yes: null },
        ],
      ]);
    });

    it("passes the number only inside the contact's yes, with every field of it", async () => {
      const fake = createFakeAdminRuntime();

      const response = await send(fake, formRequest(addPath, { ...named, ...theirYes }, ORIGIN));

      expect(response.status).toBe(303);
      expect(argsOf(fake.calls, "addContact")).toEqual([
        [
          { admin: "founder@vela.test", familyId },
          {
            memberId,
            name: "Auntie Lin",
            relation: "neighbour",
            channel: "line",
            yes: {
              phone: "+886 900 000 000",
              at: new Date("2026-09-16T09:15:00.000Z"),
              textVersion: "nearby-contact-consent.zh-TW@1",
              lang: "zh-TW",
              channel: "line",
              evidence: { note: "replied yes to text A" },
            },
          },
        ],
      ]);
    });

    it.each(["consentAt", "textVersion", "lang", "consentChannel", "note"])(
      "refuses a number whose yes lacks %s, and changes nothing",
      async (missing) => {
        const fake = createFakeAdminRuntime();
        const form = { ...named, ...theirYes, [missing]: "" };

        const response = await send(fake, formRequest(addPath, form, ORIGIN));

        expect(response.status).toBe(400);
        expect(namesOf(fake.calls)).toEqual([]);
      },
    );

    it("refuses a yes without a number rather than dropping it", async () => {
      const fake = createFakeAdminRuntime();
      const form = { ...named, ...theirYes, phone: "" };

      const response = await send(fake, formRequest(addPath, form, ORIGIN));

      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("replied yes to text A");
      expect(namesOf(fake.calls)).toEqual([]);
    });
  });

  describe("the invite-again form", () => {
    const invitePath = `/admin/families/${familyId}/create_invite`;
    const organiserId = "66666666-6666-7666-8666-666666666666";
    const replacedId = "77777777-7777-7777-8777-777777777777";
    const invite = {
      invitedBy: organiserId,
      name: "Mum",
      address: "Mum",
      language: "zh-TW",
      country: "TW",
      timeZone: "Asia/Taipei",
      wakeTime: "07:30",
      replacesMemberId: "",
      confirm: "invite",
    };

    it("creates the invite with what onboarding asked, and no member to replace when none waits", async () => {
      const fake = createFakeAdminRuntime();

      const response = await send(fake, formRequest(invitePath, invite, ORIGIN));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/admin/families/${familyId}?result=done`);
      expect(argsOf(fake.calls, "createInvite")).toEqual([
        [
          { admin: "founder@vela.test", familyId },
          {
            invitedBy: organiserId,
            name: "Mum",
            address: "Mum",
            language: "zh-TW",
            country: "TW",
            timeZone: "Asia/Taipei",
            wakeTime: "07:30",
            replacesMemberId: null,
          },
        ],
      ]);
    });

    it("names the waiting member the page showed, so a form sent twice changes nothing", async () => {
      const fake = createFakeAdminRuntime();

      await send(
        fake,
        formRequest(invitePath, { ...invite, replacesMemberId: replacedId }, ORIGIN),
      );

      expect(argsOf(fake.calls, "createInvite")).toMatchObject([
        [{ familyId }, { replacesMemberId: replacedId }],
      ]);
    });

    it.each([
      ["no confirmation", { confirm: "" }],
      ["another word typed", { confirm: "yes" }],
      ["a language the form does not offer", { language: "ja" }],
      ["a country the form does not offer", { country: "RU" }],
      ["a country in lower case", { country: "tw" }],
      ["a time zone that is not an IANA name", { timeZone: "+08:00" }],
      ["an empty time zone", { timeZone: "" }],
      ["a wake time that is not HH:MM", { wakeTime: "7:30" }],
      ["a wake time past midnight", { wakeTime: "24:00" }],
    ])("refuses %s with 400, changing nothing", async (_what, change) => {
      const fake = createFakeAdminRuntime();

      const response = await send(fake, formRequest(invitePath, { ...invite, ...change }, ORIGIN));

      expect(response.status).toBe(400);
      expect(namesOf(fake.calls)).toEqual([]);
    });

    it("turns a refusal from services, such as a family whose light is on, into 409", async () => {
      const fake = createFakeAdminRuntime({
        services: {
          createInvite: async () => {
            throw new VelaError("illegal_state", "the family's light is on");
          },
        },
      });

      const response = await send(fake, formRequest(invitePath, invite, ORIGIN));

      expect(response.status).toBe(409);
      expect(await response.text()).toContain("illegal_state");
    });
  });

  // For the kept-light member a departure cannot be undone, and which member that is lives in the
  // database, so every departure is typed out.
  it("marks a member left only when the departure is typed out", async () => {
    const fake = createFakeAdminRuntime();

    for (const confirm of [null, "", "yes"]) {
      const form: Record<string, string> = confirm === null ? { memberId } : { memberId, confirm };
      const refused = await send(fake, formRequest(path, form, ORIGIN));
      expect(refused.status).toBe(400);
    }
    expect(namesOf(fake.calls)).toEqual([]);

    const accepted = await send(fake, formRequest(path, { memberId, confirm: "left" }, ORIGIN));
    expect(accepted.status).toBe(303);
    expect(argsOf(fake.calls, "markLeft")).toEqual([
      [{ admin: "founder@vela.test", familyId }, memberId],
    ]);
  });

  describe("a consent form", () => {
    const contactId = "44444444-4444-7444-8444-444444444444";
    const contactConsent = {
      contactId,
      answer: "yes",
      at: "2026-09-14T08:30",
      textVersion: "pilot-2026-09",
      lang: "zh-TW",
      channel: "telegram",
      note: "said yes on the onboarding call",
    };
    const memberConsent = {
      memberId,
      kind: "privacy_notice",
      givenAt: "2026-09-14T08:30",
      textVersion: "pilot-2026-09",
      lang: "en",
      channel: "telegram",
      note: "read to her on the call",
    };

    // A contact is listed in quiet notices only after they said yes themselves: an answer the page
    // could not have sent is refused, never read as the yes.
    it("refuses a contact answer the page does not offer instead of recording a yes", async () => {
      const fake = createFakeAdminRuntime();
      const contactPath = `/admin/families/${familyId}/record_contact_consent`;

      for (const answer of ["", "Yes", "maybe"]) {
        const response = await send(
          fake,
          formRequest(contactPath, { ...contactConsent, answer }, ORIGIN),
        );
        expect(response.status).toBe(400);
      }
      const unanswered = Object.fromEntries(
        Object.entries(contactConsent).filter(([name]) => name !== "answer"),
      );
      expect((await send(fake, formRequest(contactPath, unanswered, ORIGIN))).status).toBe(400);
      expect(namesOf(fake.calls)).toEqual([]);

      const declined = await send(
        fake,
        formRequest(contactPath, { ...contactConsent, answer: "no" }, ORIGIN),
      );
      expect(declined.status).toBe(303);
      expect(argsOf(fake.calls, "recordContactConsent")).toEqual([
        [
          { admin: "founder@vela.test", familyId },
          {
            contactId,
            answer: "no",
            phone: null,
            at: new Date("2026-09-14T08:30:00.000Z"),
            textVersion: "pilot-2026-09",
            lang: "zh-TW",
            channel: "telegram",
            evidence: { note: "said yes on the onboarding call" },
          },
        ],
      ]);
    });

    // L8: the number arrives with the yes; services refuse a yes without one and a no with one.
    it("passes the number given with a contact's answer, and none when the field is empty", async () => {
      const fake = createFakeAdminRuntime();
      const contactPath = `/admin/families/${familyId}/record_contact_consent`;

      await send(
        fake,
        formRequest(contactPath, { ...contactConsent, phone: " +886 912 000 001 " }, ORIGIN),
      );
      await send(fake, formRequest(contactPath, { ...contactConsent, phone: "" }, ORIGIN));

      expect(argsOf(fake.calls, "recordContactConsent")).toMatchObject([
        [{ familyId }, { contactId, answer: "yes", phone: "+886 912 000 001" }],
        [{ familyId }, { contactId, answer: "yes", phone: null }],
      ]);
    });

    it("refuses a language the page does not offer instead of recording English", async () => {
      const fake = createFakeAdminRuntime();

      const contact = await send(
        fake,
        formRequest(
          `/admin/families/${familyId}/record_contact_consent`,
          { ...contactConsent, lang: "ja" },
          ORIGIN,
        ),
      );
      const member = await send(
        fake,
        formRequest(
          `/admin/families/${familyId}/record_consent`,
          { ...memberConsent, lang: "" },
          ORIGIN,
        ),
      );

      expect([contact.status, member.status]).toEqual([400, 400]);
      expect(namesOf(fake.calls)).toEqual([]);
    });

    it("refuses a consent kind the page does not offer instead of recording the pilot consent", async () => {
      const fake = createFakeAdminRuntime();
      const consentPath = `/admin/families/${familyId}/record_consent`;

      for (const kind of ["", "nearby"]) {
        const response = await send(
          fake,
          formRequest(consentPath, { ...memberConsent, kind }, ORIGIN),
        );
        expect(response.status).toBe(400);
      }
      expect(namesOf(fake.calls)).toEqual([]);

      const recorded = await send(fake, formRequest(consentPath, memberConsent, ORIGIN));
      expect(recorded.status).toBe(303);
      expect(argsOf(fake.calls, "recordConsent")).toEqual([
        [
          { admin: "founder@vela.test", familyId },
          {
            memberId,
            kind: "privacy_notice",
            textVersion: "pilot-2026-09",
            lang: "en",
            channel: "telegram",
            givenAt: new Date("2026-09-14T08:30:00.000Z"),
            evidence: { note: "read to her on the call" },
          },
        ],
      ]);
    });
  });

  it("answers 404 for an address that is not an action", async () => {
    const fake = createFakeAdminRuntime();

    const response = await send(
      fake,
      formRequest(`/admin/families/${familyId}/burn_everything`, {}, ORIGIN),
    );

    expect(response.status).toBe(404);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("turns a refusal from services into a status, not a stack trace", async () => {
    const refusal = new VelaError("not_found", "not in this family");
    const fake = createFakeAdminRuntime({
      services: {
        markLeft: async () => {
          throw refusal;
        },
      },
    });

    const response = await send(fake, formRequest(path, { memberId, confirm: "left" }, ORIGIN));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("not in this family");
  });
});
