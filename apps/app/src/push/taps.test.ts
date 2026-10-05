import type { PushData } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { foregroundBehaviour, hrefOf, pushDataOf, tapTargetOf } from "./taps.ts";

const FAMILY = "01a0d168-4bdc-7fff-be50-0c8690f1e2c1";
const OTHER_FAMILY = "01a0d168-4bdc-7fff-be50-0c8690f1e2c2";
const HER = "11111111-1111-7111-8111-111111111111";
const EVENT = "22222222-2222-7222-8222-222222222222";
const EXCHANGE = "33333333-3333-7333-8333-333333333333";
const SUGGESTION = "44444444-4444-7444-8444-444444444444";

function data(patch: Partial<PushData> & Pick<PushData, "kind">): PushData {
  return { family_id: FAMILY, member_id: HER, ...patch };
}

describe("reading a notification's data", () => {
  it("reads what Vela sends, ids only", () => {
    const sent = data({ kind: "quiet_notice", quiet_event_id: EVENT });
    expect(pushDataOf(sent)).toEqual(sent);
  });

  it("ignores a field a platform adds, and reads nothing that is not Vela's", () => {
    expect(pushDataOf({ ...data({ kind: "quiet_resolved" }), experienceId: "@vela/app" })).toEqual(
      data({ kind: "quiet_resolved" }),
    );
    for (const other of [
      null,
      undefined,
      "quiet_notice",
      {},
      { kind: "flag", family_id: FAMILY, member_id: HER },
      { kind: "quiet_notice", family_id: "not-a-uuid", member_id: HER },
      { kind: "answer_receipt", member_id: HER },
      { ...data({ kind: "quiet_notice" }), quiet_event_id: "../../settings" },
    ]) {
      expect(pushDataOf(other), JSON.stringify(other)).toBeNull();
    }
  });
});

describe("where a tap goes (A4)", () => {
  it("opens Today with the sheet for a quiet notice's event, in any family", () => {
    for (const family of [FAMILY, OTHER_FAMILY]) {
      const target = tapTargetOf(
        data({ kind: "quiet_notice", family_id: family, quiet_event_id: EVENT }),
        FAMILY,
      );
      expect(target).toEqual({ screen: "today", quietEventId: EVENT });
      expect(hrefOf(target)).toEqual({ pathname: "/", params: { quiet: EVENT } });
    }
    expect(tapTargetOf(data({ kind: "quiet_notice" }), FAMILY)).toEqual({ screen: "today" });
  });

  it("opens Today alone for a quiet morning that is settled", () => {
    const target = tapTargetOf(data({ kind: "quiet_resolved", quiet_event_id: EVENT }), FAMILY);
    expect(target).toEqual({ screen: "today" });
    expect(hrefOf(target)).toEqual({ pathname: "/", params: {} });
  });

  it("opens the exchange she answered", () => {
    const target = tapTargetOf(data({ kind: "answer_receipt", exchange_id: EXCHANGE }), FAMILY);
    expect(target).toEqual({ screen: "exchange", exchangeId: EXCHANGE });
    expect(hrefOf(target)).toEqual({ pathname: "/exchange/[id]", params: { id: EXCHANGE } });
    expect(tapTargetOf(data({ kind: "answer_receipt" }), FAMILY)).toEqual({ screen: "today" });
  });

  it("opens Ask for her, with the turn's suggestion when it has one", () => {
    const plain = tapTargetOf(data({ kind: "turn_prompt" }), FAMILY);
    expect(plain).toEqual({ screen: "ask", recipientId: HER });
    expect(hrefOf(plain)).toEqual({ pathname: "/ask", params: { recipient: HER } });
    const suggested = tapTargetOf(data({ kind: "turn_prompt", suggestion_id: SUGGESTION }), FAMILY);
    expect(hrefOf(suggested)).toEqual({
      pathname: "/ask",
      params: { recipient: HER, suggestion: SUGGESTION },
    });
  });

  it("opens Today for an exchange or a turn of a family the app does not show", () => {
    for (const kind of ["answer_receipt", "turn_prompt"] as const) {
      const other = data({ kind, family_id: OTHER_FAMILY, exchange_id: EXCHANGE });
      expect(tapTargetOf(other, FAMILY)).toEqual({ screen: "today" });
      expect(tapTargetOf(data({ kind, exchange_id: EXCHANGE }), undefined)).toEqual({
        screen: "today",
      });
    }
  });
});

describe("a notification arriving while the app is open", () => {
  it("shows a quiet notice and its close as a banner with their sound", () => {
    for (const kind of ["quiet_notice", "quiet_resolved"] as const) {
      expect(foregroundBehaviour(data({ kind }))).toEqual({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      });
    }
  });

  it("puts anything else quietly in the list, and never sets a badge", () => {
    for (const shown of [data({ kind: "answer_receipt" }), data({ kind: "turn_prompt" }), {}]) {
      expect(foregroundBehaviour(shown)).toEqual({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      });
    }
  });
});
