/**
 * Every HTTP route the admin Worker serves (code design §9, H2): the founder's admin pages and
 * their forms under `/admin`, behind Cloudflare Access, and a redirect from `/` to them. Nothing
 * else answers here: the webhook, the notices, and `/healthz` are the pilot Worker's.
 *
 * Nothing here decides anything about a family: a route verifies the request, builds the admin
 * ports, calls services, and renders what came back. Services' entry points arrive through
 * `AdminRuntime`, so a test hands the routes fakes; only the error types and the channels a nearby
 * contact form may name are imported directly.
 */
import { NEARBY_CONTACT_CHANNELS } from "@vela/db";
import { type AdminContext, VelaError } from "@vela/services";
import { type Context, Hono } from "hono";
import {
  ADMIN_PATH,
  familyHref,
  noticeFor,
  renderFamilyPage,
  renderMessage,
  renderOverview,
} from "./admin-pages.ts";
import type { AdminRuntime } from "./admin-runtime.ts";
import { ConfigError } from "./config.ts";
import type { AdminDeps } from "./deps.ts";
import type { AdminEnv } from "./env.ts";
import { requestFailed } from "./request-errors.ts";

interface AdminAppEnv {
  Bindings: AdminEnv;
  Variables: {
    /** The `email` claim of the verified Access token; every `admin_access_log` row's `admin`. */
    admin: string;
  };
}

type AdminAppContext = Context<AdminAppEnv>;

/** Local time as a form's `datetime-local` gives it, read as UTC (the pages label the fields). */
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A refusal from services; the route needs nothing from it but the code, which decides the status. */
function domainErrorCode(error: unknown): VelaError["code"] | null {
  return error instanceof VelaError ? error.code : null;
}

function statusForDomainError(code: VelaError["code"]): 400 | 404 | 409 {
  if (code === "not_found") {
    return 404;
  }
  return code === "illegal_state" || code === "no_channel_link" ? 409 : 400;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalField(form: FormData, name: string): string | null {
  const value = field(form, name);
  return value === "" ? null : value;
}

/** A form the page itself would never send: a missing field, a value no input allows. */
class BadRequest extends Error {
  override readonly name = "BadRequest";
}

/**
 * A value one of the page's selects offers. Anything else is refused rather than read as one of
 * them: a missing answer read as "yes" would list a nearby contact who never agreed.
 */
function oneOf<const T extends string>(form: FormData, name: string, allowed: readonly T[]): T {
  const value = field(form, name);
  const found = allowed.find((option) => option === value);
  if (found === undefined) {
    throw new BadRequest(`${name} is not one of ${allowed.join(", ")}`);
  }
  return found;
}

/** The languages the consent forms offer. */
const CONSENT_LANGS = ["en", "zh-TW"] as const;

function instantField(form: FormData, name: string): Date {
  const value = field(form, name);
  const parsed = new Date(DATETIME_LOCAL.test(value) ? `${value}:00Z` : value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequest(`${name} is not a time`);
  }
  return parsed;
}

/** The lines of a weekly read as the founder left them in the textarea. */
function lines(form: FormData, name: string): string[] {
  return field(form, name)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function createAdminApp(runtime: AdminRuntime): Hono<AdminAppEnv> {
  const app = new Hono<AdminAppEnv>();

  /** The ports for one request; the connection closes after the response, on the request's time. */
  async function withDeps<T>(c: AdminAppContext, run: (deps: AdminDeps) => Promise<T>): Promise<T> {
    const handle = await runtime.createDeps(c.env);
    try {
      return await run(handle.deps);
    } finally {
      c.executionCtx.waitUntil(handle.close());
    }
  }

  // The Worker's bare address, as the founder types it, opens the overview.
  app.get("/", (c) => c.redirect(ADMIN_PATH, 302));

  const admin = new Hono<AdminAppEnv>();

  /**
   * Cloudflare Access covers this whole Worker at the edge; the Worker verifies the token again so
   * an Access application switched off or misconfigured opens nothing. A write must also come from
   * a form on this origin: a foreign or missing `Origin` is refused, so another site cannot post
   * one on the founder's behalf.
   */
  admin.use("*", async (c, next) => {
    const identity = await runtime.access(c.req.raw, c.env);
    if (identity === null) {
      // 401: nobody is signed in. A signed-in request from a foreign origin is 403 below.
      return renderMessage(
        401,
        "Not signed in",
        "This page needs a Cloudflare Access sign-in. Open it through the Access application.",
      );
    }
    c.set("admin", identity.email);
    if (c.req.method !== "GET") {
      const origin = c.req.header("Origin");
      // §9 names one origin, not a set: the origin of `PUBLIC_BASE_URL`, which is where the
      // founder's browser loaded the page from. Any other hostname the request arrived on is not
      // that origin.
      if (origin === undefined || origin !== publicOrigin(c.env.PUBLIC_BASE_URL)) {
        return renderMessage(
          403,
          "Refused",
          "This form was not sent from the admin page. Open the page again and retry.",
        );
      }
    }
    await next();
    return;
  });

  admin.get("/", async (c) => {
    const ctx: AdminContext = { admin: c.get("admin") };
    // One read after the other: both use the request's one database connection.
    const overview = await withDeps(c, async (deps) => ({
      families: await runtime.services.loadAdminOverview(deps, ctx),
      failedOutbound: await runtime.services.loadFailedOutbound(deps, ctx),
    }));
    return renderOverview(overview.families, overview.failedOutbound);
  });

  admin.get("/families/:familyId", async (c) => {
    const familyId = c.req.param("familyId");
    const ctx: AdminContext = { admin: c.get("admin") };
    try {
      const family = await withDeps(c, (deps) =>
        runtime.services.loadFamilyPage(deps, ctx, familyId),
      );
      if (family === null) {
        return renderMessage(404, "No such family", "Nothing is recorded under that address.");
      }
      return renderFamilyPage(family, noticeFor(c.req.query("result") ?? null));
    } catch (error) {
      // A mistyped or stale address is a bad address, not a failure of the Worker: services refuse
      // an id that is not a uuid before they look anything up, and that refusal reads as a status
      // here rather than as a 500 and an error in the log.
      const code = domainErrorCode(error);
      if (code === null) {
        throw error;
      }
      return renderMessage(
        statusForDomainError(code),
        "No such family",
        `That address is not a family (${code}).`,
      );
    }
  });

  admin.post("/families/:familyId/:action", async (c) => {
    const familyId = c.req.param("familyId");
    const action = c.req.param("action");
    // Every id in the form must belong to the family the form was posted from; services refuse a
    // form that names another family's row.
    const ctx: AdminContext = { admin: c.get("admin"), familyId };
    const form = await c.req.formData();
    try {
      const result = await withDeps(c, (deps) =>
        runAction(runtime, deps, ctx, familyId, action, form),
      );
      if (result === null) {
        return renderMessage(404, "No such action", "That address is not an admin action.");
      }
      return c.redirect(`${familyHref(familyId)}?result=${result}`, 303);
    } catch (error) {
      if (error instanceof BadRequest) {
        return renderMessage(400, "Not saved", `${error.message}. Nothing was changed.`);
      }
      const code = domainErrorCode(error);
      if (code === null) {
        throw error;
      }
      return renderMessage(
        statusForDomainError(code),
        "Not saved",
        `The action was refused (${code}). Nothing was changed.`,
      );
    }
  });

  app.route(ADMIN_PATH, admin);

  app.notFound((c) => c.text("not found", 404));
  app.onError(requestFailed);

  return app;
}

/** The admin Worker's one handler, not optional, so a test that calls it always runs it. */
export interface AdminWorker extends ExportedHandler<AdminEnv> {
  fetch(request: Request, env: AdminEnv, ctx: ExecutionContext): Promise<Response>;
}

export function createAdminWorker(runtime: AdminRuntime): AdminWorker {
  const app = createAdminApp(runtime);
  return {
    async fetch(request, env, ctx) {
      return app.fetch(request, env, ctx);
    },
  };
}

/**
 * The one origin a form may be posted from. A `PUBLIC_BASE_URL` that does not parse is a
 * misconfigured deployment, not an origin nothing matches: it fails loudly, the way a missing var
 * does in `config.ts`, rather than refusing every form with a quiet 403.
 */
function publicOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    throw new ConfigError(
      "PUBLIC_BASE_URL",
      "PUBLIC_BASE_URL is not a URL: set the admin Worker's origin in the environment's vars in wrangler.admin.jsonc",
    );
  }
}

/**
 * One admin write per `ADMIN_ACTIONS` value except `view`, each calling the matching `admin.ts`
 * function with the Access identity. Returns the word the page shows afterwards, or null when the
 * address names no action.
 */
async function runAction(
  runtime: AdminRuntime,
  deps: AdminDeps,
  ctx: AdminContext,
  familyId: string,
  action: string,
  form: FormData,
): Promise<string | null> {
  const services = runtime.services;
  switch (action) {
    case "record_consent":
      await services.recordConsent(deps, ctx, {
        memberId: field(form, "memberId"),
        kind: oneOf(form, "kind", ["pilot", "privacy_notice"]),
        textVersion: field(form, "textVersion"),
        lang: oneOf(form, "lang", CONSENT_LANGS),
        channel: field(form, "channel"),
        givenAt: instantField(form, "givenAt"),
        evidence: { note: field(form, "note") },
      });
      return "done";
    case "record_contact_consent":
      await services.recordContactConsent(deps, ctx, {
        contactId: field(form, "contactId"),
        answer: oneOf(form, "answer", ["yes", "no"]),
        at: instantField(form, "at"),
        textVersion: field(form, "textVersion"),
        lang: oneOf(form, "lang", CONSENT_LANGS),
        channel: field(form, "channel"),
        evidence: { note: field(form, "note") },
      });
      return "done";
    case "add_contact":
      await services.addContact(deps, ctx, {
        memberId: field(form, "memberId"),
        name: field(form, "name"),
        phone: field(form, "phone"),
        relation: optionalField(form, "relation"),
        channel: contactChannel(form),
      });
      return "done";
    case "remove_contact":
      await services.removeContact(deps, ctx, field(form, "contactId"));
      return "done";
    case "set_away":
      await services.setAway(deps, ctx, {
        memberId: field(form, "memberId"),
        setBy: field(form, "setBy"),
        from: field(form, "from"),
        until: optionalField(form, "until"),
      });
      return "done";
    case "end_away":
      await services.endAway(deps, ctx, field(form, "awayPeriodId"));
      return "done";
    case "mark_left":
      // For the kept-light member this puts her light out for good: nothing on the page, and
      // nothing she sends, turns it back on. Which member that is lives in the database, so every
      // departure is typed out, and the page sets her form apart.
      if (field(form, "confirm") !== "left") {
        throw new BadRequest("the departure was not confirmed");
      }
      await services.markLeft(deps, ctx, field(form, "memberId"));
      return "done";
    case "mark_deceased":
      await services.markDeceased(deps, ctx, field(form, "memberId"));
      return "done";
    case "delete_family":
      // A family is deleted within 24 hours of this click, so the word is typed out first.
      if (field(form, "confirm") !== "delete") {
        throw new BadRequest("the deletion was not confirmed");
      }
      await services.deleteFamily(deps, ctx, familyId);
      return "done";
    case "send_weekly_read":
      return services.sendWeeklyRead(deps, ctx, {
        weeklyReadId: field(form, "weeklyReadId"),
        lines: lines(form, "lines"),
        suggestion: field(form, "suggestion"),
      });
    default:
      return null;
  }
}

function contactChannel(form: FormData): (typeof NEARBY_CONTACT_CHANNELS)[number] | null {
  const value = field(form, "channel");
  return NEARBY_CONTACT_CHANNELS.find((channel) => channel === value) ?? null;
}
