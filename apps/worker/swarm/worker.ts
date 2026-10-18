/** Separate test entrypoint. Never imported or deployed by the product's staging/production configs. */
import { DurableObject } from "cloudflare:workers";
import { createFakeStt, createOffAi } from "@vela/ai";
import type { InboundEvent } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { connectDatabase, members, suggestions, users } from "@vela/db";
import { type Deps, errorLabel } from "@vela/services";
import { and, eq, sql } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { createFakeTelegram } from "../../../packages/services/src/testing/fake-telegram.ts";
import { seedFamily } from "../../../packages/services/src/testing/seed.ts";
import { createApiApp } from "../src/api-app.ts";
import { API_READ_SERVICES, API_WRITE_SERVICES } from "../src/api-runtime.ts";
import { createLogger, createSchedulerPort, type DepsOptions } from "../src/deps.ts";
import type { PilotEnv } from "../src/env.ts";
import { createWorker } from "../src/pilot-worker.ts";
import { type PilotRuntime, pilotRuntime } from "../src/runtime.ts";
import { MemberScheduler } from "../src/scheduler.ts";
import { MIGRATIONS, SCHEMA } from "./migrations.generated.ts";

interface SwarmEnv extends PilotEnv {
  SWARM_CONTROL: DurableObjectNamespace<SwarmControl>;
  SWARM_SECRET: string;
}
const control = (env: SwarmEnv) => env.SWARM_CONTROL.get(env.SWARM_CONTROL.idFromName("clock"));
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const open = (env: SwarmEnv) =>
  connectDatabase(env.HYPERDRIVE.connectionString, env.CONTENT_KEY_V1 ?? "");
const qualified = (table: string) => sql.raw(`"${SCHEMA}"."${table}"`);

export class SwarmControl extends DurableObject<SwarmEnv> {
  async offset(): Promise<number> {
    return (await this.ctx.storage.get<number>("offset")) ?? 0;
  }
  async setTime(iso: string): Promise<void> {
    const time = Date.parse(iso);
    if (
      !Number.isFinite(time) ||
      time < Date.parse("2026-09-01") ||
      time > Date.parse("2026-12-01")
    )
      throw new Error("invalid_time");
    await this.ctx.storage.put("offset", time - Date.now());
  }
}

async function build(env: SwarmEnv, options: DepsOptions = {}) {
  const offset = await control(env).offset();
  const clock = { now: () => new Date(Date.now() + offset) };
  const connection = await open(env);
  const telegram = createFakeTelegram(clock);
  const recorder = {
    ...telegram,
    send: async (...args: Parameters<typeof telegram.send>) => {
      const [message] = args;
      if (!/^swarm-(parent|child)-\d+$/.test(message.to.conversationId))
        throw new Error("non_synthetic_destination");
      // Record every actual adapter invocation; no deduplication here can hide gateway duplicates.
      await connection.db.execute(
        sql`insert into ${qualified("swarm_sends")} (key, kind, destination, text) values (${message.idempotencyKey}, ${message.kind}, ${message.to.conversationId}, ${message.text})`,
      );
      const id = message.idempotencyKey;
      return { externalMessageIds: [id], primaryMessageId: id };
    },
  };
  const scheduler = options.scheduler ?? createSchedulerPort(env);
  const deps: Deps = {
    db: connection.db,
    clock,
    logger: createLogger(env),
    random: {
      token: (bytes = 32) =>
        btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", ""),
    },
    queues: {
      outbound: {
        send: async (job, options) => {
          await env.OUTBOUND_QUEUE.send(job, options);
        },
      },
      media: {
        send: async (job, options) => {
          await env.MEDIA_QUEUE.send(job, options);
        },
      },
      understand: {
        send: async (job, options) => {
          await env.UNDERSTAND_QUEUE.send(job, options);
        },
      },
    },
    scheduler: {
      wakeAt: (id, at) =>
        scheduler.wakeAt(id, at === null ? null : new Date(at.getTime() - offset)),
    },
    channels: { get: () => recorder },
    ai: createOffAi(),
    stt: createFakeStt(),
    media: null,
    push: null,
    heartbeat: { ping: async () => {} },
    config: {
      environment: "staging",
      telegramBotUsername: "VelaSyntheticBot",
      lineBasicId: null,
      adminConversationId: null,
      regions: ["apac"],
      publicBaseUrl: "https://vela-swarm-20261018.vela-light-staging.workers.dev",
      privacyNoticeUrls: {
        de: "https://vela.test/privacy",
        hi: "https://vela.test/privacy",
        ja: "https://vela.test/privacy",
        ru: "https://vela.test/privacy",
        en: "https://vela.test/privacy",
        "zh-TW": "https://vela.test/privacy",
      },
      privacyNoticeVersion: "synthetic-only",
      memory: true,
      book: true,
      sendAsMe: true,
    },
  };
  return { deps, close: () => connection.close() };
}
const runtime: PilotRuntime = {
  ...pilotRuntime,
  createDeps: (env, options) => build(env as SwarmEnv, options),
  services: {
    ...pilotRuntime.services,
    tickMember: async (deps, id) => {
      const next = await pilotRuntime.services.tickMember(deps, id);
      return next === null
        ? null
        : new Date(next.getTime() - (deps.clock.now().getTime() - Date.now()));
    },
  },
};
export class SwarmMemberScheduler extends MemberScheduler {
  override runtime = runtime;
}
const product = createWorker(runtime);

async function api(request: Request, env: SwarmEnv): Promise<Response> {
  const offset = await control(env).offset();
  const clock = { now: () => new Date(Date.now() + offset) };
  const app = createApiApp({
    sendAsMe: true,
    now: clock.now,
    verifySession: async (req) => {
      try {
        const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
        const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SWARM_SECRET), {
          algorithms: ["HS256"],
          issuer: "vela-synthetic-only",
        });
        if (!payload.sub || !/^swarm-\d+$/.test(payload.sub)) return null;
        return { authSubject: payload.sub, sessionId: `session-${payload.sub}` };
      } catch {
        return null;
      }
    },
    openDatabase: () => open(env),
    services: API_READ_SERVICES,
    logger: createLogger(env),
    writes: {
      verifyActiveSession: async () => true,
      clock,
      services: API_WRITE_SERVICES,
      nudges: {
        deliver: async (id) => {
          await env.OUTBOUND_QUEUE.send({ type: "deliver", outboundId: id });
        },
        wake: (id, at) => createSchedulerPort(env).wakeAt(id, new Date(at.getTime() - offset)),
      },
    },
  });
  return app.fetch(request);
}

async function route(request: Request, env: SwarmEnv): Promise<Response> {
  if (
    env.ENVIRONMENT !== "staging" ||
    !env.SWARM_SECRET ||
    !/^vela_swarm_[a-f0-9]{12}$/.test(SCHEMA)
  )
    return json({ error: "isolation_refused" }, 503);
  const path = new URL(request.url).pathname;
  if (path.startsWith("/v1/")) return api(request, env);
  if (request.headers.get("authorization") !== `Bearer ${env.SWARM_SECRET}`)
    return json({ error: "unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const input = (await request.json()) as {
    index?: number;
    time?: string;
    day?: number;
    part?: number;
    events?: InboundEvent[];
  };
  if (path === "/control/time") {
    await control(env).setTime(input.time ?? "");
    return json({ ok: true });
  }
  const c = await open(env);
  try {
    if (path === "/control/init") {
      await c.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`));
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${SCHEMA}", pg_catalog`));
        await tx.execute(sql`select pg_advisory_xact_lock(20261018, 101)`);
        const exists = await tx.execute<{ n: number }>(
          sql`select count(*)::int n from information_schema.tables where table_schema=${SCHEMA}`,
        );
        if (exists.rows[0]?.n !== 0) throw new Error("schema_not_empty");
        for (const statement of MIGRATIONS) await tx.execute(sql.raw(statement));
        await tx.execute(
          sql.raw(
            `CREATE TABLE "${SCHEMA}"."swarm_sends" (id bigint generated always as identity primary key, key text not null, kind text not null, destination text not null, text text not null, at timestamptz default now())`,
          ),
        );
      });
      return json({ ok: true, schema: SCHEMA, migrations: 17 });
    }
    if (path === "/control/reset") {
      await c.db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`));
      return json({ reset: true });
    }
    if (path === "/control/stats") {
      const result = await c.db.execute(
        sql.raw(`SELECT
        (select count(*)::int from "${SCHEMA}".families) families,
        (select count(*)::int from "${SCHEMA}".exchanges) exchanges,
        (select count(*)::int from "${SCHEMA}".exchanges where delivered_at is not null) delivered,
        (select count(*)::int from "${SCHEMA}".answers) answers,
        (select count(*)::int from "${SCHEMA}".exchanges where drafted_by_vela) signed,
        (select count(*)::int from "${SCHEMA}".replies) replies,
        (select count(*)::int from "${SCHEMA}".replies where read_back_at is not null) read_back,
        (select count(*)::int from "${SCHEMA}".outbound where status != 'sent' or effects_at is null) pending,
        (select count(*)::int from "${SCHEMA}".dead_letters) dead,
        (select count(*)::int from "${SCHEMA}".quiet_events) quiet,
        (select count(*)::int - count(distinct key)::int from "${SCHEMA}".swarm_sends) duplicates`),
      );
      return json(result.rows[0]);
    }
    if (path === "/control/stop") {
      const rows = await c.db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.role, "member"));
      await Promise.all(rows.map((row) => createSchedulerPort(env).wakeAt(row.id, null)));
      return json({ stopped: rows.length });
    }
    const index = input.index;
    if (!Number.isInteger(index) || index === undefined || index < 0 || index >= 200)
      return json({ error: "index" }, 400);
    if (path === "/control/seed") {
      const now = new Date(Date.now() + (await control(env).offset()));
      const family = await seedFamily(c.db, {
        now: new Date(now.getTime() - 10 * 86400000),
        familyName: `Synthetic hosted ${index}`,
        organiserName: `Child ${index}`,
        organiserExternalId: `swarm-child-${index}`,
        memberExternalId: `swarm-parent-${index}`,
        timeZone: index % 2 === 0 ? "Asia/Taipei" : "Asia/Ho_Chi_Minh",
        arrivalTime: index % 2 === 0 ? "08:00" : "07:00",
        language: index % 3 === 0 ? "zh-TW" : "en",
      });
      const [user] = await c.db
        .insert(users)
        .values({ authSubject: `swarm-${index}`, displayName: `Child ${index}` })
        .returning();
      if (!user) throw new Error("seed_user");
      await c.db
        .update(members)
        .set({ userId: user.id })
        .where(eq(members.id, family.organiser.id));
      if (index % 2 === 0)
        await c.db
          .update(members)
          .set({ suggestionsSignedBy: family.organiser.id })
          .where(eq(members.id, family.member.id));
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("vela-synthetic-only")
        .setSubject(`swarm-${index}`)
        .setExpirationTime("2h")
        .sign(new TextEncoder().encode(env.SWARM_SECRET));
      return json({
        familyId: family.family.id,
        memberId: family.member.id,
        organiserId: family.organiser.id,
        token,
      });
    }
    const [parent] = await c.db
      .select()
      .from(members)
      .where(
        and(
          eq(members.displayName, "Mom"),
          sql`${members.id} in (select member_id from ${qualified("channel_links")} where external_id=${`swarm-parent-${index}`})`,
        ),
      );
    if (!parent) return json({ error: "family_missing" }, 404);
    if (path === "/control/wake") {
      const now = new Date(Date.now() + (await control(env).offset()));
      if (index % 2 === 0) {
        const [child] = await c.db
          .select()
          .from(members)
          .where(and(eq(members.familyId, parent.familyId), eq(members.role, "organiser")));
        if (!child) throw new Error("child_missing");
        await c.db
          .insert(suggestions)
          .values({
            familyId: parent.familyId,
            forMemberId: child.id,
            aboutMemberId: parent.id,
            localDay: localDateOf(now, parent.tz),
            bankId: "opinions.taste.season",
            type: "question",
            text: `Synthetic question ${index} day ${input.day}`,
            lang: parent.language,
            promptVersion: "hosted-swarm",
          })
          .onConflictDoNothing();
      }
      const stub = createSchedulerPort(env);
      await stub.wakeAt(parent.id, new Date(Date.now() - 1));
      return json({ ok: true });
    }
    if (path === "/control/answer") {
      const at = new Date(Date.now() + (await control(env).offset())).toISOString();
      const event: InboundEvent = {
        channel: "telegram",
        eventId: `swarm-${index}-${input.day}-${input.part ?? 0}`,
        messageId: `answer-${input.day}-${input.part ?? 0}`,
        at,
        kind: "text",
        sender: { externalUserId: `swarm-parent-${index}` },
        conversation: { externalId: `swarm-parent-${index}`, kind: "private" },
        text: `Synthetic answer ${index} day ${input.day}${input.part === 1 ? " follow-up" : ""}`,
      };
      await env.INBOUND_QUEUE?.send({ type: "handle_inbound", events: [event, event] });
      return json({ ok: true });
    }
    return json({ error: "not_found" }, 404);
  } finally {
    await c.close();
  }
}
export default {
  async fetch(request: Request, env: SwarmEnv): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      createLogger(env).error("swarm_request_failed", {
        error: errorLabel(error),
      });
      return json({ error: "swarm_request_failed" }, 500);
    }
  },
  queue: product.queue,
};
