/**
 * `MemberScheduler`, one Durable Object per kept-light member (code design §9). It is the
 * instrument's clock: services ask it to wake at an instant, the alarm runs the member's tick, and
 * the tick says when to wake next. `reconcile` is the safety net, not the schedule.
 *
 * A wake means "tick no later than this", so it never moves an alarm that is already set sooner.
 * The tick decides from the data, so an early wake costs one tick that finds nothing due, while a
 * later one can lose a wake: the object accepts calls while a tick waits on the database or
 * Telegram, which is not storage I/O, so a change can ask for a wake mid-tick, and the tick then
 * arms the instant it computed from its earlier read.
 *
 * `wakeAt(memberId, null)` deletes the alarm and everything the object stores, so a member who
 * stopped, left, died, or was deleted keeps nothing here (flows §3.15).
 */
import { DurableObject } from "cloudflare:workers";
import type { MemberScheduler as MemberSchedulerPort } from "@vela/services";
import { createLogger, createSchedulerPort } from "./deps.ts";
import type { Env } from "./env.ts";
import { productionRuntime, type WorkerRuntime } from "./runtime.ts";

/** The only key the object stores: whose schedule this is. */
const MEMBER_ID_KEY = "memberId";

/** A tick that threw is tried again shortly; the next scheduled wake is recomputed from the data. */
const RETRY_AFTER_MS = 60_000;

export class MemberScheduler extends DurableObject<Env> {
  /**
   * What the alarm builds deps from and calls. A field rather than an import so the alarm can be
   * tested against fakes: a test replaces it inside `runInDurableObject`, and nothing else does.
   */
  runtime: WorkerRuntime = productionRuntime;

  /**
   * Wakes this member no later than `at`, or clears the object when `at` is null. Called over RPC
   * by the scheduler port, and directly by this object's own tick.
   */
  async wakeAt(memberId: string, at: Date | null): Promise<void> {
    if (at === null) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.put(MEMBER_ID_KEY, memberId);
    await this.#armNoLaterThan(at.getTime());
  }

  /**
   * Sets the alarm unless it is already set sooner. While the alarm handler runs, the storage does
   * not report the alarm that fired, so the next wake a tick computes is always armed.
   */
  async #armNoLaterThan(at: number): Promise<void> {
    const armed = await this.ctx.storage.getAlarm();
    if (armed === null || at < armed) {
      await this.ctx.storage.setAlarm(at);
    }
  }

  /**
   * The scheduler port the tick receives. A wake for this member sets this object's alarm
   * directly: an RPC call to itself would wait for a lock it is already holding. Any other member
   * goes through the namespace as usual.
   */
  #port(ownMemberId: string): MemberSchedulerPort {
    const outer = createSchedulerPort(this.env);
    return {
      wakeAt: async (memberId, at) => {
        if (memberId === ownMemberId) {
          await this.wakeAt(memberId, at);
          return;
        }
        await outer.wakeAt(memberId, at);
      },
    };
  }

  override async alarm(): Promise<void> {
    const memberId = await this.ctx.storage.get<string>(MEMBER_ID_KEY);
    if (memberId === undefined) {
      // The object was cleared while this alarm was in flight: she stopped, left, or was deleted.
      return;
    }
    const logger = createLogger(this.env);
    let handle: Awaited<ReturnType<WorkerRuntime["createDeps"]>> | null = null;
    try {
      handle = await this.runtime.createDeps(this.env, { scheduler: this.#port(memberId) });
      const next = await this.runtime.services.tickMember(handle.deps, memberId);
      if (next === null) {
        // Nothing to wake for. A wake asked for mid-tick goes too, but her `next_wake_at` is now
        // null, and `reconcile` ticks an active kept-light member with none within five minutes.
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.#armNoLaterThan(next.getTime());
      }
    } catch (error) {
      // Her light must not go out because one tick failed: try again in a minute, from the data.
      logger.error("scheduler_tick_failed", { memberId, error: String(error) });
      await this.#armNoLaterThan(Date.now() + RETRY_AFTER_MS);
    } finally {
      if (handle !== null) {
        this.ctx.waitUntil(handle.close());
      }
    }
  }
}
