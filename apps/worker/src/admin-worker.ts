/**
 * The admin Worker `vela-admin` as wrangler deploys it (code design §9, H2), from this package with
 * `wrangler.admin.jsonc`: the founder's admin pages and forms, and nothing else. It lives apart from
 * the pilot Worker because Cloudflare Access protects every hostname of a Worker, and turning it on
 * for the pilot Worker would close Telegram's webhook. It has no queue consumer, cron, or Durable
 * Object class of its own: it reaches the pilot Worker's scheduler, outbound queue, and database
 * through its own bindings.
 *
 * workerd reads every export of this module as a handler or a class, so the handler is built in
 * `admin-app.ts` and only the default export is here.
 */
import { createAdminWorker } from "./admin-app.ts";
import { adminRuntime } from "./admin-runtime.ts";

export default createAdminWorker(adminRuntime);
