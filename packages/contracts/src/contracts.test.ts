import { describe, expect, it } from "vitest";
import {
  ADMIN_ACTIONS,
  AdminAction,
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
  OUTBOUND_KINDS,
  OutboundMessage,
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
