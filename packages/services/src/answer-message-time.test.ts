import type { Answer } from "@vela/db";
import { expect, it } from "vitest";
import {
  answerMessageTime,
  answerSourceTime,
  compareAnswerMessages,
} from "./answer-message-time.ts";

const receivedAt = new Date("2026-10-18T00:05:00Z");
const base = {
  id: "a",
  payload: {},
  receivedAt,
  channel: "telegram",
  externalId: "chat:1",
  kind: "text",
} satisfies Pick<Answer, "id" | "payload" | "receivedAt" | "channel" | "externalId" | "kind">;
it("keeps the original message instant when a queue delivers it later", () => {
  expect(answerSourceTime({ at: "2026-10-18T00:01:00Z" }, receivedAt)).toEqual({
    source_at: "2026-10-18T00:01:00.000Z",
  });
  expect(answerSourceTime({ at: "invalid" }, receivedAt)).toEqual({});
  expect(answerSourceTime({ at: "2026-10-19T00:01:00Z" }, receivedAt)).toEqual({});
  expect(answerMessageTime(base)).toBe(receivedAt);
  expect(answerMessageTime({ ...base, payload: { source_at: "2026-10-19T00:01:00Z" } })).toBe(
    receivedAt,
  );
});
it("orders a delayed first message before a follow-up processed first", () => {
  const first = { ...base, id: "first", payload: { source_at: "2026-10-18T00:01:00Z" } };
  const second = {
    ...base,
    id: "second",
    receivedAt: new Date("2026-10-18T00:04:00Z"),
    payload: { source_at: "2026-10-18T00:02:00Z" },
  };
  expect([second, first].sort(compareAnswerMessages).map((x) => x.id)).toEqual(["first", "second"]);
});
it("orders same-second Telegram messages by their full-precision ids", () => {
  const first = { ...base, externalId: "chat:9007199254740992" };
  const second = {
    ...base,
    id: "b",
    externalId: "chat:9007199254740993",
    receivedAt: new Date("2026-10-18T00:04:00Z"),
    payload: { source_at: receivedAt.toISOString() },
  };
  const sameTime = { ...first, payload: { source_at: "2026-10-18T00:01:00Z" } };
  const next = { ...second, payload: { source_at: "2026-10-18T00:01:00Z" } };
  expect([next, sameTime].sort(compareAnswerMessages).map((x) => x.id)).toEqual(["a", "b"]);
});
