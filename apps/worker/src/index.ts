/**
 * The pilot Worker `vela` as wrangler deploys it (wrangler.jsonc): its handlers, and the
 * `MemberScheduler` Durable Object class, which the admin Worker also binds by `script_name`.
 *
 * workerd reads every export of this module as a handler or a class and refuses to start on any
 * other value, so the handlers and their constants live in `pilot-worker.ts` and nothing else is
 * exported here.
 */
import { createWorker } from "./pilot-worker.ts";
import { pilotRuntime } from "./runtime.ts";

export { MemberScheduler } from "./scheduler.ts";

export default createWorker(pilotRuntime);
