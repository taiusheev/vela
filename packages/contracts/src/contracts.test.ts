import { describe, expect, it } from "vitest";
import {
  BUDGETED_OUTBOUND_KINDS,
  ChannelSendError,
  DomainEvent,
  InboundEvent,
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

describe("TimeZone", () => {
  it("accepts IANA zones and rejects inventions", () => {
    expect(TimeZone.safeParse("Asia/Taipei").success).toBe(true);
    expect(TimeZone.safeParse("Australia/Lord_Howe").success).toBe(true);
    expect(TimeZone.safeParse("Mars/Olympus_Mons").success).toBe(false);
  });

  it("rejects fixed offsets, which would lose daylight saving", () => {
    expect(TimeZone.safeParse("+08:00").success).toBe(false);
    expect(TimeZone.safeParse("-05:00").success).toBe(false);
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
});
