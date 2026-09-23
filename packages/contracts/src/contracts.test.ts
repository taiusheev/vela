import { describe, expect, it } from "vitest";
import {
  ADMIN_ACTIONS,
  AdminAction,
  API_ERROR_CODES,
  ApiAccountPatch,
  ApiAccountProfile,
  ApiErrorBody,
  ApiErrorCode,
  ApiFamilyPlan,
  ApiIdempotencyKey,
  ApiLinkChallenge,
  ApiLinkCode,
  ApiLinkOutcome,
  ApiMe,
  ApiMutationResponse,
  ApiUser,
  BUDGETED_OUTBOUND_KINDS,
  ChannelSendError,
  CONSENT_ANSWERS,
  CONSENT_KINDS,
  ConsentAnswer,
  ConsentKind,
  DomainEvent,
  EventName,
  InboundEvent,
  isIanaTimeZone,
  LocalDate,
  LocalTime,
  MediaRef,
  MemberLight,
  OUTBOUND_KINDS,
  OutboundMessage,
  PageQuery,
  PauseMember,
  SetLight,
  TimeZone,
} from "./index.ts";

describe("LocalDate", () => {
  it("accepts real calendar dates", () => {
    expect(LocalDate.safeParse("2026-09-13").success).toBe(true);
    expect(LocalDate.safeParse("2028-02-29").success).toBe(true);
  });

  it("rejects impossible or malformed dates", () => {
    for (const value of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-9-13", "13-09-2026"]) {
      expect(LocalDate.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("LocalTime", () => {
  it("accepts 24-hour HH:MM", () => {
    for (const value of ["00:00", "08:30", "23:59"]) {
      expect(LocalTime.safeParse(value).success, value).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const value of ["24:00", "8:30", "08:60", "0830", "08:30:00"]) {
      expect(LocalTime.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("isIanaTimeZone", () => {
  it("accepts IANA zone names in any letter case", () => {
    for (const zone of ["Asia/Taipei", "Australia/Lord_Howe", "America/New_York", "asia/taipei"]) {
      expect(isIanaTimeZone(zone), zone).toBe(true);
    }
  });

  it("accepts UTC and Etc/UTC", () => {
    expect(isIanaTimeZone("UTC")).toBe(true);
    expect(isIanaTimeZone("Etc/UTC")).toBe(true);
  });

  it("rejects inventions and the empty string", () => {
    for (const zone of ["Mars/Olympus_Mons", "", "UTC+8", " Asia/Taipei"]) {
      expect(isIanaTimeZone(zone), zone).toBe(false);
    }
  });

  it("rejects fixed offsets, which would lose daylight saving", () => {
    for (const zone of ["+08:00", "-05:00", "+0800", "+08"]) {
      expect(isIanaTimeZone(zone), zone).toBe(false);
    }
  });

  it("rejects an offset written with the Unicode minus sign, which only resolves to an offset", () => {
    expect(isIanaTimeZone("\u221208:00")).toBe(false);
  });

  it("rejects Etc/GMT+N and Etc/GMT-N in any letter case, even when N is 0", () => {
    for (const zone of [
      "Etc/GMT-8",
      "Etc/GMT+5",
      "Etc/GMT-14",
      "etc/gmt-8",
      "Etc/GMT+0",
      "GMT-0",
    ]) {
      expect(isIanaTimeZone(zone), zone).toBe(false);
    }
  });
});

describe("TimeZone", () => {
  it("applies the isIanaTimeZone rule", () => {
    for (const zone of [
      "Asia/Taipei",
      "UTC",
      "Etc/UTC",
      "Mars/Olympus_Mons",
      "+08:00",
      "Etc/GMT-8",
    ]) {
      expect(TimeZone.safeParse(zone).success, zone).toBe(isIanaTimeZone(zone));
    }
  });
});

describe("MediaRef", () => {
  it("requires a provider file id or a url", () => {
    expect(MediaRef.safeParse({ kind: "audio" }).success).toBe(false);
    expect(MediaRef.safeParse({ kind: "audio", providerFileId: "AwAD" }).success).toBe(true);
    expect(MediaRef.safeParse({ kind: "image", url: "https://media.example/a.jpg" }).success).toBe(
      true,
    );
  });

  it("keeps the provider's unique id, which alone cannot fetch the file", () => {
    const withBoth = { kind: "audio", providerFileId: "AwAD", providerUniqueId: "AgADXxMA" };
    expect(MediaRef.parse(withBoth)).toStrictEqual(withBoth);
    expect(MediaRef.safeParse({ kind: "audio", providerUniqueId: "AgADXxMA" }).success).toBe(false);
    expect(MediaRef.safeParse({ ...withBoth, providerUniqueId: "" }).success).toBe(false);
  });
});

describe("OutboundMessage", () => {
  const base = {
    kind: "arrival",
    idempotencyKey: "arrival:0198f6aa-0000-7000-8000-000000000001:2026-09-14",
    lang: "zh-TW",
    to: { channel: "telegram", conversationId: "123456789" },
    text: "早安",
  } as const;

  it("accepts a minimal message", () => {
    expect(OutboundMessage.safeParse(base).success).toBe(true);
  });

  it("rejects button payloads Telegram cannot carry", () => {
    const tooLong = { ...base, buttons: [[{ id: "x".repeat(65), label: "Yes" }]] };
    expect(OutboundMessage.safeParse(tooLong).success).toBe(false);
  });
});

describe("InboundEvent", () => {
  it("parses a normalised button tap", () => {
    const result = InboundEvent.safeParse({
      channel: "telegram",
      eventId: "tg:update:1001",
      at: "2026-09-14T00:12:00.000Z",
      kind: "button",
      sender: { externalUserId: "42" },
      conversation: { externalId: "42", kind: "private" },
      messageId: "77",
      buttonData: "ans:fine",
      callbackId: "cb-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("migrated events", () => {
  it("carry the new conversation id alongside the old one", () => {
    const result = InboundEvent.safeParse({
      channel: "telegram",
      eventId: "tg:update:2001",
      at: "2026-09-14T00:12:00.000Z",
      kind: "migrated",
      sender: { externalUserId: "42" },
      conversation: { externalId: "-4001234567", kind: "group" },
      migratedToConversationId: "-1002001234567",
    });
    expect(result.success).toBe(true);
  });
});

describe("member_left events", () => {
  const removal = {
    channel: "telegram",
    eventId: "tg:update:3001",
    at: "2026-09-14T00:12:00.000Z",
    kind: "member_left",
    sender: { externalUserId: "5829174630", displayName: "Anna Chen" },
    conversation: { externalId: "-1002214567890", kind: "group" },
    subject: { externalUserId: "1938475620", displayName: "Sam" },
  } as const;

  it("carry the person who left apart from the person who acted", () => {
    expect(InboundEvent.parse(removal)).toStrictEqual(removal);
  });

  it("need the id of the person who left", () => {
    expect(InboundEvent.safeParse({ ...removal, subject: { displayName: "Sam" } }).success).toBe(
      false,
    );
    expect(InboundEvent.safeParse({ ...removal, subject: { externalUserId: "" } }).success).toBe(
      false,
    );
  });
});

describe("ADMIN_ACTIONS", () => {
  it("are exactly the admin page's actions, and nothing else parses as one", () => {
    expect(ADMIN_ACTIONS).toStrictEqual([
      "view",
      "record_consent",
      "record_contact_consent",
      "add_contact",
      "remove_contact",
      "set_away",
      "end_away",
      "mark_left",
      "mark_deceased",
      "delete_family",
      "send_weekly_read",
      "create_invite",
    ]);
    expect(AdminAction.safeParse("export_family").success).toBe(false);
  });

  it("each record events that exist", () => {
    // The events each action records (flows §3.17). An action whose event is missing from
    // EVENT_NAMES could not record it: events_name_check would refuse the row.
    const recorded: Record<AdminAction, readonly EventName[]> = {
      view: ["admin_page_opened"],
      record_consent: ["consent_given"],
      record_contact_consent: ["consent_given", "consent_declined"],
      add_contact: ["nearby_contact_added", "consent_given"],
      remove_contact: ["nearby_contact_removed"],
      set_away: ["away_set"],
      end_away: ["away_ended"],
      mark_left: ["member_left"],
      mark_deceased: ["member_marked_deceased"],
      delete_family: ["family_deletion_requested"],
      send_weekly_read: ["weekly_read_sent"],
      create_invite: ["invite_created"],
    };
    for (const [action, names] of Object.entries(recorded)) {
      for (const name of names) {
        expect(EventName.safeParse(name).success, `${action}: ${name}`).toBe(true);
      }
    }
  });
});

describe("consents", () => {
  it("record her health-words agreement as a kind of its own", () => {
    expect(CONSENT_KINDS).toContain("health_words");
    expect(ConsentKind.safeParse("health_words").success).toBe(true);
    expect(ConsentKind.safeParse("health").success).toBe(false);
  });

  it("record a yes or a no, and nothing else", () => {
    expect(CONSENT_ANSWERS).toStrictEqual(["yes", "no"]);
    expect(ConsentAnswer.safeParse("no").success).toBe(true);
    for (const value of ["maybe", "withdrawn", "", "Yes"]) {
      expect(ConsentAnswer.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("budget kinds", () => {
  it("are all outbound kinds", () => {
    for (const kind of BUDGETED_OUTBOUND_KINDS) {
      expect(OUTBOUND_KINDS).toContain(kind);
    }
  });
});

describe("DomainEvent", () => {
  it("rejects content-sized property values", () => {
    const result = DomainEvent.safeParse({
      name: "answer_recorded",
      props: { text: "x".repeat(201) },
    });
    expect(result.success).toBe(false);
  });
});

describe("API errors", () => {
  it("uses the public error codes rather than internal service or provider codes", () => {
    expect(API_ERROR_CODES).toStrictEqual([
      "unauthenticated",
      "forbidden",
      "not_found",
      "invalid",
      "conflict",
      "budget",
      "rate_limited",
      "internal",
      "unavailable",
    ]);
    for (const code of API_ERROR_CODES) {
      const body = { error: { code, message: "The request could not be completed." } };
      expect(ApiErrorBody.parse(body)).toStrictEqual(body);
      expect(ApiErrorCode.parse(code)).toBe(code);
    }
    for (const code of ["illegal_state", "blocked", "unexpected", "", "NOT_FOUND"]) {
      expect(ApiErrorBody.safeParse({ error: { code, message: "Not available." } }).success).toBe(
        false,
      );
    }
  });

  it("preserves optional structured JSON details", () => {
    const body = {
      error: {
        code: "conflict",
        message: "This date already has an ask.",
        details: { taken_by: "Mia", fields: ["date"], retryable: false, alternative: null },
      },
    };
    expect(ApiErrorBody.parse(body)).toStrictEqual(body);
  });

  it("rejects missing envelopes, missing messages and non-JSON details", () => {
    for (const body of [
      {},
      { code: "invalid", message: "Invalid request." },
      { error: { code: "invalid" } },
      { error: { code: "invalid", message: 400 } },
      { error: { code: "invalid", message: "Invalid request.", details: { value: undefined } } },
      { error: { code: "invalid", message: "Invalid request.", details: { value: Number.NaN } } },
    ]) {
      expect(ApiErrorBody.safeParse(body).success).toBe(false);
    }
  });

  it("strips fields outside the public error envelope", () => {
    expect(
      ApiErrorBody.parse({
        stack: "internal stack",
        error: { code: "invalid", message: "Invalid request.", cause: "internal cause" },
      }),
    ).toStrictEqual({ error: { code: "invalid", message: "Invalid request." } });
  });
});

describe("API mutation receipts", () => {
  it("accepts bounded opaque keys without whitespace or header separators", () => {
    for (const key of ["one", "key_123:step-1.v2", "x".repeat(200)]) {
      expect(ApiIdempotencyKey.parse(key)).toBe(key);
    }
    for (const key of [
      "",
      " ",
      "one,two",
      "two words",
      "key\n",
      "key\r\n",
      "key\u2028",
      "line\r\nbreak",
      "x".repeat(201),
      null,
      42,
    ]) {
      expect(ApiIdempotencyKey.safeParse(key).success).toBe(false);
    }
  });

  it("caches only defined JSON success responses, with no body for 204", () => {
    for (const status of [200, 201, 202]) {
      const result = { status, body: { id: "example", nested: [true, null, 1] } };
      expect(ApiMutationResponse.parse(result)).toEqual(result);
    }
    expect(ApiMutationResponse.parse({ status: 204, body: null })).toEqual({
      status: 204,
      body: null,
    });
    for (const result of [
      { status: 204, body: {} },
      { status: 400, body: {} },
      { status: 500, body: {} },
      { status: 302, body: {} },
      { status: 201 },
      { status: 201, body: undefined },
      { status: 201, body: Number.NaN },
      { status: 201, body: {}, headers: { "set-cookie": "not-stored" } },
    ]) {
      expect(ApiMutationResponse.safeParse(result).success).toBe(false);
    }
  });
});

describe("account linking contracts", () => {
  const id = "0198f6aa-0000-7000-8000-000000000001";

  it("exposes challenge metadata without a proof code or member identity", () => {
    const metadata = { challenge_id: id, expires_at: "2026-09-22T08:15:00Z" };
    expect(
      ApiLinkChallenge.parse({ ...metadata, code: "secret", member_id: id, session_id: "private" }),
    ).toEqual(metadata);
    expect(ApiLinkChallenge.safeParse({ ...metadata, challenge_id: "bad" }).success).toBe(false);
    expect(
      ApiLinkChallenge.safeParse({ ...metadata, expires_at: "2026-09-22T08:15:00" }).success,
    ).toBe(false);
  });

  it("requires a complete high-entropy code rather than an invite or member id", () => {
    expect(ApiLinkCode.parse("A".repeat(22))).toBe("A".repeat(22));
    for (const code of [
      "",
      "123456",
      id,
      "A".repeat(21),
      "A".repeat(23),
      `${"A".repeat(21)}!`,
      `${"A".repeat(22)}\n`,
    ]) {
      expect(ApiLinkCode.safeParse(code).success).toBe(false);
    }
  });

  it("reveals membership only for an explicit successful outcome", () => {
    expect(ApiLinkOutcome.parse({ linked: false })).toEqual({ linked: false });
    expect(ApiLinkOutcome.parse({ linked: true, member_id: id, family_id: id })).toEqual({
      linked: true,
      member_id: id,
      family_id: id,
    });
    for (const result of [
      { linked: "true" },
      { linked: true },
      { linked: false, member_id: id },
      { linked: true, member_id: "bad", family_id: id },
    ]) {
      expect(ApiLinkOutcome.safeParse(result).success).toBe(false);
    }
  });
});

describe("PageQuery", () => {
  it("leaves omitted fields absent without inventing a cursor or page size", () => {
    expect(PageQuery.parse({})).toStrictEqual({});
  });

  it("parses a decimal HTTP query limit and leaves the cursor opaque", () => {
    const query = Object.fromEntries(new URLSearchParams("cursor=next%2Bpage%2F%3D&limit=20"));
    expect(PageQuery.parse(query)).toStrictEqual({ cursor: "next+page/=", limit: 20 });
    expect(PageQuery.parse({ limit: "0002" })).toStrictEqual({ limit: 2 });
    expect(PageQuery.parse({ cursor: "opaque:cursor" })).toStrictEqual({ cursor: "opaque:cursor" });
  });

  it("rejects nonpositive, fractional, unsafe or coercible nondecimal limits", () => {
    for (const limit of [
      "",
      "0",
      "-1",
      "1.5",
      "1e2",
      "0x10",
      "Infinity",
      "NaN",
      " 20 ",
      "+20",
      "9007199254740992",
      "9".repeat(400),
      20,
      true,
      null,
      ["20"],
      {},
    ]) {
      expect(PageQuery.safeParse({ limit }).success, String(limit)).toBe(false);
    }
  });

  it("rejects empty or non-string cursors and unknown query fields", () => {
    for (const cursor of ["", null, 1, ["next"]]) {
      expect(PageQuery.safeParse({ cursor }).success).toBe(false);
    }
    expect(PageQuery.safeParse({ limti: "20" }).success).toBe(false);
  });
});

describe("API accounts and plan reads", () => {
  const user = {
    id: "0198f6aa-0000-7000-8000-000000000001",
    display_name: "Mia",
    language: "en",
    tz: "Asia/Taipei",
  };
  const membership = {
    member_id: "0198f6aa-0000-7000-8000-000000000002",
    role: "organiser",
    status: "active",
    family: {
      id: "0198f6aa-0000-7000-8000-000000000003",
      name: "The Chens",
      region: "apac",
      plan: "free",
    },
  };
  const subscription = {
    member_id: membership.member_id,
    status: "trial",
    trial_ends_at: "2026-10-21T08:00:00+08:00",
    current_period_end: null,
    grace_until: null,
  };

  it("validates only the explicitly provided account profile", () => {
    expect(
      ApiAccountProfile.parse({ display_name: "  Mia  ", language: "en", tz: "Asia/Taipei" }),
    ).toEqual({ display_name: "Mia", language: "en", tz: "Asia/Taipei" });
    const profile = { display_name: "Mia", language: "en", tz: "Asia/Taipei" };
    for (const invalid of [
      { display_name: " " },
      { display_name: "x".repeat(81) },
      { language: "xx" },
      { tz: "+08:00" },
      { tz: "Etc/GMT-8" },
      { auth_subject: "someone_else" },
      { user_id: user.id },
      { member_id: membership.member_id },
      { role: "organiser" },
      { email: "another@vela.test" },
      { phone: "+10000000000" },
    ]) {
      expect(ApiAccountProfile.safeParse({ ...profile, ...invalid }).success).toBe(false);
    }
    expect(ApiAccountProfile.safeParse({ display_name: "Mia" }).success).toBe(false);
  });

  it("accepts only nonempty profile patches without identity or membership changes", () => {
    expect(ApiAccountPatch.parse({ display_name: " Mia " })).toEqual({ display_name: "Mia" });
    expect(ApiAccountPatch.parse({ language: "zh-TW", tz: "UTC" })).toEqual({
      language: "zh-TW",
      tz: "UTC",
    });
    for (const patch of [
      {},
      { display_name: undefined },
      { tz: "UTC", language: undefined },
      { display_name: null },
      { language: "xx" },
      { tz: "+08:00" },
      ...[
        "id",
        "user_id",
        "auth_subject",
        "member_id",
        "family_id",
        "role",
        "email",
        "phone",
        "invite_token",
        "telegram_id",
      ].map((field) => ({ tz: "UTC", [field]: "forged" })),
    ]) {
      expect(ApiAccountPatch.safeParse(patch).success).toBe(false);
    }
  });

  it("refuses account names that cannot round-trip through PostgreSQL UTF8 text", () => {
    for (const display_name of ["a\u0000b", "\ud800", "\udfff"]) {
      expect(ApiAccountProfile.safeParse({ display_name, language: "en", tz: "UTC" }).success).toBe(
        false,
      );
      expect(ApiAccountPatch.safeParse({ display_name }).success).toBe(false);
    }
    expect(ApiAccountPatch.safeParse({ display_name: "明" }).success).toBe(true);
  });

  it("projects user and membership responses without private identity fields", () => {
    expect(ApiUser.parse({ ...user, auth_subject: "private", email: "private@vela.test" })).toEqual(
      user,
    );
    expect(
      ApiMe.parse({
        user: { ...user, phone: "+10000000000" },
        memberships: [
          {
            ...membership,
            user_id: user.id,
            family: { ...membership.family, created_by: user.id },
          },
        ],
        session_id: "private-session",
      }),
    ).toEqual({ user, memberships: [membership] });
    expect(ApiMe.parse({ user, memberships: [] })).toEqual({ user, memberships: [] });
  });

  it("accepts paused memberships but not departed or invited ones", () => {
    expect(
      ApiMe.safeParse({ user, memberships: [{ ...membership, status: "paused" }] }).success,
    ).toBe(true);
    for (const status of ["invited", "left", "deceased", "unknown"]) {
      expect(ApiMe.safeParse({ user, memberships: [{ ...membership, status }] }).success).toBe(
        false,
      );
    }
  });

  it("rejects malformed account and family identifiers or roles", () => {
    expect(ApiMe.safeParse({ user: { ...user, id: "invalid" }, memberships: [] }).success).toBe(
      false,
    );
    expect(ApiMe.safeParse({ user, memberships: [{ ...membership, role: "admin" }] }).success).toBe(
      false,
    );
    expect(
      ApiMe.safeParse({
        user,
        memberships: [{ ...membership, family: { ...membership.family, id: "invalid" } }],
      }).success,
    ).toBe(false);
  });

  it("exposes stored plan states without payment or provider linkage", () => {
    for (const status of ["trial", "active", "grace", "lapsed", "cancelled"]) {
      const plan = {
        family_id: membership.family.id,
        plan: "light",
        subscriptions: [{ ...subscription, status }],
      };
      expect(
        ApiFamilyPlan.parse({
          ...plan,
          payer_user_id: "private-payer",
          subscriptions: [
            {
              ...subscription,
              status,
              external_id: "private-provider-id",
              provider: "stripe",
              price_cents: 999,
            },
          ],
        }),
      ).toEqual(plan);
    }
    expect(
      ApiFamilyPlan.parse({ family_id: membership.family.id, plan: "free", subscriptions: [] }),
    ).toEqual({ family_id: membership.family.id, plan: "free", subscriptions: [] });
  });

  it("requires valid plan states and explicit nullable subscription timestamps", () => {
    const plan = { family_id: membership.family.id, plan: "free", subscriptions: [subscription] };
    for (const invalid of [
      { status: "none" },
      { trial_ends_at: "2026-10-21T08:00:00" },
      { current_period_end: "2026-02-30T08:00:00Z" },
      { member_id: "invalid" },
      { grace_until: undefined },
    ]) {
      expect(
        ApiFamilyPlan.safeParse({ ...plan, subscriptions: [{ ...subscription, ...invalid }] })
          .success,
      ).toBe(false);
    }
    expect(ApiFamilyPlan.safeParse({ ...plan, plan: "paid" }).success).toBe(false);
    expect(ApiFamilyPlan.safeParse({ ...plan, family_id: "invalid" }).success).toBe(false);
  });
});

describe("MemberLight", () => {
  const light = {
    member_id: "0198f6aa-0000-7000-8000-000000000001",
    display_name: "Mom",
    state: "resting",
    answered_at: null,
    usual_time: null,
    away_until: null,
    quiet_event_id: null,
  };

  it("accepts every light state and explicit nulls before there is an answer", () => {
    for (const state of ["resting", "lit", "quiet", "away", "paused", "none"]) {
      expect(MemberLight.parse({ ...light, state })).toStrictEqual({ ...light, state });
    }
  });

  it("accepts UUIDv7, offset-bearing instants, local times and calendar dates", () => {
    for (const answered_at of ["2026-09-21T08:00:00+08:00", "2026-09-21T00:00:00Z"]) {
      const answered = {
        ...light,
        state: "lit",
        answered_at,
        usual_time: "08:00",
        away_until: "2028-02-29",
        quiet_event_id: "0198f6aa-0000-7000-8000-000000000002",
      };
      expect(MemberLight.parse(answered)).toStrictEqual(answered);
    }
  });

  it("rejects malformed ids, states, timestamps and local calendar values", () => {
    for (const invalid of [
      { member_id: "not-a-uuid" },
      { quiet_event_id: "not-a-uuid" },
      { state: "active" },
      { answered_at: "2026-09-21T08:00:00" },
      { answered_at: "2026-02-30T08:00:00Z" },
      { answered_at: new Date("2026-09-21T08:00:00Z") },
      { usual_time: "8:00" },
      { usual_time: "24:00" },
      { away_until: "2026-02-29" },
      { away_until: "2026-09-21T08:00:00Z" },
    ]) {
      expect(MemberLight.safeParse({ ...light, ...invalid }).success).toBe(false);
    }
  });

  it("requires nullable fields to be present rather than silently defaulting them", () => {
    for (const field of Object.keys(light)) {
      const incomplete = Object.fromEntries(Object.entries(light).filter(([key]) => key !== field));
      expect(MemberLight.safeParse(incomplete).success, field).toBe(false);
    }
  });

  it("returns only light fields even when the input contains other member data", () => {
    expect(
      MemberLight.parse({ ...light, phone: "+10000000000", health_words: "private" }),
    ).toStrictEqual(light);
  });
});

describe("member control requests", () => {
  it("accepts true and false without coercion", () => {
    for (const value of [true, false]) {
      expect(SetLight.parse({ on: value })).toStrictEqual({ on: value });
      expect(PauseMember.parse({ paused: value })).toStrictEqual({ paused: value });
    }
  });

  it("rejects absent, null and truthy nonboolean values", () => {
    expect(SetLight.safeParse({}).success).toBe(false);
    expect(PauseMember.safeParse({}).success).toBe(false);
    for (const value of ["true", "false", 0, 1, null, [], {}]) {
      expect(SetLight.safeParse({ on: value }).success).toBe(false);
      expect(PauseMember.safeParse({ paused: value }).success).toBe(false);
    }
  });

  it("rejects undeclared fields instead of accepting caller-supplied consent or identity", () => {
    expect(SetLight.safeParse({ on: true, consented: true }).success).toBe(false);
    expect(PauseMember.safeParse({ paused: false, member_id: "someone-else" }).success).toBe(false);
  });
});

describe("ChannelSendError", () => {
  it("marks only transient failures as retryable", () => {
    expect(
      new ChannelSendError("rate_limited", "slow down", { retryAfterSeconds: 3 }).retryable,
    ).toBe(true);
    expect(new ChannelSendError("unavailable", "5xx").retryable).toBe(true);
    expect(new ChannelSendError("blocked", "user blocked the bot").retryable).toBe(false);
    expect(new ChannelSendError("invalid_request", "bad").retryable).toBe(false);
  });

  it("carries the conversation a group moved to without making the send retryable", () => {
    const error = new ChannelSendError("invalid_request", "group chat was upgraded", {
      migratedToConversationId: "-1002214567890",
    });
    expect(error.migratedToConversationId).toBe("-1002214567890");
    expect(error.retryable).toBe(false);
    expect(new ChannelSendError("invalid_request", "bad").migratedToConversationId).toBeUndefined();
  });
});
