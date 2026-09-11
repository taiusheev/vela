import { handleUpdate } from "./flows";
import { tick } from "./scheduler";
import type { Env, TgUpdate } from "./types";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/webhook") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = (await req.json()) as TgUpdate;
      // Respond to Telegram immediately; do the work in the background.
      ctx.waitUntil(handleUpdate(env, update).catch((e) => console.error("update", e)));
      return new Response("ok");
    }

    // One-time helper: GET /register?secret=<TELEGRAM_WEBHOOK_SECRET> points Telegram at this worker.
    if (req.method === "GET" && url.pathname === "/register") {
      if (url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: `${url.origin}/webhook`,
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["message", "callback_query"],
        }),
      });
      return new Response(await res.text(), { headers: { "content-type": "application/json" } });
    }

    // Manual scheduler trigger for testing: GET /tick?secret=...
    if (req.method === "GET" && url.pathname === "/tick") {
      if (url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      await tick(env);
      return new Response("ticked");
    }

    return new Response("Vela bot", { status: 200 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env));
  },
} satisfies ExportedHandler<Env>;
