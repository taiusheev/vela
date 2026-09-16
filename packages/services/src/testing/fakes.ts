/**
 * In-memory ports for tests: a clock that moves only when told, queues that keep their jobs until
 * the harness drains them, a scheduler that remembers the latest wake per member, and recorders for
 * the logger, storage, tokens, and the heartbeat.
 */
import type {
  Clock,
  Heartbeat,
  JobQueue,
  Logger,
  MediaStore,
  MemberScheduler,
  Random,
} from "../deps.ts";

export interface FakeClock extends Clock {
  set(at: Date | string): void;
  advance(milliseconds: number): void;
  advanceMinutes(minutes: number): void;
}

export function createFakeClock(start: Date): FakeClock {
  let current = new Date(start.getTime());
  return {
    now: () => new Date(current.getTime()),
    set: (at) => {
      current = new Date(at);
    },
    advance: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
    },
    advanceMinutes: (minutes) => {
      current = new Date(current.getTime() + minutes * 60_000);
    },
  };
}

export interface LogEntry {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly fields: Record<string, unknown> | undefined;
}

export interface FakeLogger extends Logger {
  readonly entries: readonly LogEntry[];
  clear(): void;
}

export function createFakeLogger(): FakeLogger {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (event, fields) => {
      entries.push({ level: "info", event, fields });
    },
    warn: (event, fields) => {
      entries.push({ level: "warn", event, fields });
    },
    error: (event, fields) => {
      entries.push({ level: "error", event, fields });
    },
    clear: () => {
      entries.length = 0;
    },
  };
}

export interface FakeRandom extends Random {
  reset(): void;
}

/** Tokens in a fixed sequence, so an invite link in a test is known before it is created. */
export function createFakeRandom(): FakeRandom {
  let counter = 0;
  return {
    token: (bytes = 32) => {
      counter += 1;
      return `token-${counter}`.padEnd(Math.max(8, Math.ceil((bytes * 4) / 3)), "x");
    },
    reset: () => {
      counter = 0;
    },
  };
}

export interface QueuedJob<J> {
  readonly job: J;
  readonly dueAt: Date;
  readonly delaySeconds: number;
  /** Insertion order, so jobs due at the same instant run first in, first out. */
  readonly sequence: number;
}

export interface FakeQueue<J> extends JobQueue<J> {
  readonly pending: readonly QueuedJob<J>[];
  /** Removes one job the harness is about to run. */
  take(entry: QueuedJob<J>): void;
  clear(): void;
}

export function createFakeQueue<J>(clock: Clock, sequence: () => number): FakeQueue<J> {
  const pending: QueuedJob<J>[] = [];
  return {
    pending,
    send: async (job, options) => {
      const delaySeconds = options?.delaySeconds ?? 0;
      pending.push({
        job,
        dueAt: new Date(clock.now().getTime() + delaySeconds * 1000),
        delaySeconds,
        sequence: sequence(),
      });
    },
    take: (entry) => {
      const index = pending.indexOf(entry);
      if (index !== -1) {
        pending.splice(index, 1);
      }
    },
    clear: () => {
      pending.length = 0;
    },
  };
}

export interface FakeScheduler extends MemberScheduler {
  /** The latest wake per member; `null` when the member's scheduler was cleared. */
  readonly wakes: ReadonlyMap<string, Date | null>;
  readonly history: readonly { memberId: string; at: Date | null }[];
  clear(): void;
}

export function createFakeScheduler(): FakeScheduler {
  const wakes = new Map<string, Date | null>();
  const history: { memberId: string; at: Date | null }[] = [];
  return {
    wakes,
    history,
    wakeAt: async (memberId, at) => {
      wakes.set(memberId, at);
      history.push({ memberId, at });
    },
    clear: () => {
      wakes.clear();
      history.length = 0;
    },
  };
}

export interface FakeMediaStore extends MediaStore {
  readonly objects: ReadonlyMap<string, { body: ArrayBuffer; mime: string }>;
  clear(): void;
}

export function createFakeMediaStore(): FakeMediaStore {
  const objects = new Map<string, { body: ArrayBuffer; mime: string }>();
  return {
    objects,
    put: async (key, body, mime) => {
      objects.set(key, { body, mime });
    },
    get: async (key) => objects.get(key) ?? null,
    delete: async (key) => {
      objects.delete(key);
    },
    clear: () => {
      objects.clear();
    },
  };
}

export interface FakeHeartbeat extends Heartbeat {
  readonly pings: number;
  clear(): void;
}

export function createFakeHeartbeat(): FakeHeartbeat {
  let pings = 0;
  return {
    get pings() {
      return pings;
    },
    ping: async () => {
      pings += 1;
    },
    clear: () => {
      pings = 0;
    },
  };
}
