/**
 * A push port that records what it is sent and answers as Expo does (ADR-34), with failures a test
 * asks for: a device that is gone, a whole request that fails, a ticket that is refused, and the
 * receipts a later check reads. Failures are mapped exactly as the Expo client maps them
 * (`expoPushErrorCode`, `expoRequestErrorCode`), so a service meets the same codes it will in
 * production. Ticket ids are numbered from 1 per fake, so a test knows each before it is issued.
 */
import { ExpoPushRequestError, expoPushErrorCode, expoRequestErrorCode } from "@vela/adapters";
import type { PushFailure, PushMessage, PushPort, PushReceipt, PushResult } from "../deps.ts";

/** A ticket id as Expo writes one, numbered as the fake issues them. */
export function fakeTicketId(serial: number): string {
  return `0198f6aa-7e57-7000-8000-${String(serial).padStart(12, "0")}`;
}

/** A refused ticket or receipt, as the Expo client makes one of Expo's `details.error`. */
export function pushFailureFor(name: string): PushFailure {
  return { ...expoPushErrorCode(name), reason: name, message: `expo push ticket: ${name}` };
}

export interface FakePush extends PushPort {
  /** Every message handed to `send`, in order, across calls, including those that failed. */
  readonly sent: readonly PushMessage[];
  /** Each `send` call's messages, one entry per call. */
  readonly sends: readonly (readonly PushMessage[])[];
  /** The message each accepted ticket was for, by ticket id. */
  readonly tickets: ReadonlyMap<string, PushMessage>;
  /** The ids each `getReceipts` call asked for. */
  readonly receiptRequests: readonly (readonly string[])[];
  /** From now on a message to `token` gets a DeviceNotRegistered ticket: the phone is gone. */
  unregister(token: string): void;
  /** From now on a message to `token` gets a ticket refused with Expo's `name`. */
  refuseTicketsTo(token: string, name: string): void;
  /**
   * The next `count` sends fail as a whole, as Expo's `errors[].code` (or an HTTP status) makes
   * the client throw, and accept nothing.
   */
  failNextSends(count: number, failure: { status: number; code?: string }): void;
  /** The next `count` receipt checks fail as a whole. */
  failNextReceipts(count: number, failure: { status: number; code?: string }): void;
  /**
   * What `getReceipts` answers for a ticket: a receipt, or `null` for one that is not ready. A
   * ticket the fake issued with nothing set answers `{ status: "ok" }`; one it never issued,
   * nothing.
   */
  receiptFor(ticketId: string, receipt: PushReceipt | null): void;
  reset(): void;
}

export function createFakePush(): FakePush {
  const sent: PushMessage[] = [];
  const sends: PushMessage[][] = [];
  const tickets = new Map<string, PushMessage>();
  const receiptRequests: string[][] = [];
  const refused = new Map<string, string>();
  const receipts = new Map<string, PushReceipt | null>();
  let sendFailures: { remaining: number; status: number; code?: string } | null = null;
  let receiptFailures: { remaining: number; status: number; code?: string } | null = null;
  let serial = 0;

  const requestError = (
    call: string,
    failure: { status: number; code?: string },
  ): ExpoPushRequestError => {
    const reason = failure.code ?? `http_${failure.status}`;
    return new ExpoPushRequestError({
      ...expoRequestErrorCode(failure.status, failure.code),
      reason,
      message: `expo ${call}: ${reason} (${failure.status})`,
    });
  };

  return {
    sent,
    sends,
    tickets,
    receiptRequests,

    async send(messages) {
      sent.push(...messages);
      sends.push([...messages]);
      if (sendFailures !== null && sendFailures.remaining > 0) {
        sendFailures.remaining -= 1;
        throw requestError("push send", sendFailures);
      }
      return messages.map((message): PushResult => {
        const name = refused.get(message.to);
        if (name !== undefined) {
          return { status: "error", failure: pushFailureFor(name) };
        }
        serial += 1;
        const id = fakeTicketId(serial);
        tickets.set(id, message);
        return { status: "ok", id };
      });
    },

    async getReceipts(ids) {
      receiptRequests.push([...ids]);
      if (receiptFailures !== null && receiptFailures.remaining > 0) {
        receiptFailures.remaining -= 1;
        throw requestError("push receipts", receiptFailures);
      }
      const answered: Record<string, PushReceipt> = {};
      for (const id of ids) {
        const set = receipts.get(id);
        if (set === null) continue;
        if (set !== undefined) {
          answered[id] = set;
        } else if (tickets.has(id)) {
          answered[id] = { status: "ok" };
        }
      }
      return answered;
    },

    unregister(token) {
      refused.set(token, "DeviceNotRegistered");
    },

    refuseTicketsTo(token, name) {
      refused.set(token, name);
    },

    failNextSends(count, failure) {
      sendFailures = { remaining: count, ...failure };
    },

    failNextReceipts(count, failure) {
      receiptFailures = { remaining: count, ...failure };
    },

    receiptFor(ticketId, receipt) {
      receipts.set(ticketId, receipt);
    },

    reset() {
      sent.length = 0;
      sends.length = 0;
      tickets.clear();
      receiptRequests.length = 0;
      refused.clear();
      receipts.clear();
      sendFailures = null;
      receiptFailures = null;
      serial = 0;
    },
  };
}
