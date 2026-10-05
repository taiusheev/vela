import { errorLabel } from "@vela/services";
import type { Context, Env as HonoEnv } from "hono";

/**
 * Both Workers' answer to an unexpected failure in a route: 500, so Telegram redelivers a webhook
 * and the founder sees a page failed rather than a blank success. Neither the response nor the log
 * line carries the error's message: a failed query's message lists its parameters, which hold what
 * the family wrote, and a platform's description can repeat what was sent. The label keeps the
 * class names and codes, such as `ConfigError:PUBLIC_BASE_URL`.
 */
export function requestFailed<E extends HonoEnv>(error: Error, c: Context<E>): Response {
  console.log(
    JSON.stringify({
      level: "error",
      event: "request_failed",
      path: new URL(c.req.url).pathname,
      method: c.req.method,
      error: errorLabel(error),
    }),
  );
  return c.text("internal error", 500);
}
