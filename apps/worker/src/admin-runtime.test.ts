import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import {
  adminAccessLog,
  type ChannelLink,
  events,
  families,
  type Member,
  members,
  outbound,
  type VelaDatabase,
} from "@vela/db";
import { type Deps, errorLabel, type MediaStore } from "@vela/services";
import { describe, expect, it } from "vitest";
import { createAdminWorker } from "./admin-app.ts";
import { adminRuntime, PortNotGivenError, servicesDeps } from "./admin-runtime.ts";
import type { AdminDeps } from "./deps.ts";
import {
  adminTestEnv,
  consoleLinesDuring,
  createFakeAdminDeps,
  familyFixture,
  type LogLine,
  memberFixture,
} from "./testing/fakes.ts";

/**
 * The admin ports passed on whole. A record over `AdminDeps`, so a port added to the admin Worker
 * cannot be left out here without the typecheck failing; `queues` is checked queue by queue, and
 * the bot username reaches services as `Config.telegramBotUsername`.
 */
const WHOLE_PORTS: Readonly<
  Record<Exclude<keyof AdminDeps, "queues" | "telegramBotUsername">, true>
> = {
  db: true,
  clock: true,
  logger: true,
  scheduler: true,
  ai: true,
  random: true,
};

/**
 * The media port as services see it. `Deps.media` is `null` while the pilot Worker's MEDIA_STORAGE
 * is "off" (decision M), and this Worker must never look like that: it has no bucket in any
 * environment, so every call has to fail rather than quietly keep no copy.
 */
function mediaOf(deps: Deps): MediaStore {
  if (deps.media === null) {
    throw new Error("the admin Worker gave services a null media port, which reads as storage off");
  }
  return deps.media;
}

/** Each port the admin Worker was not given, touched the way services would touch it. */
const NOT_GIVEN: readonly (readonly [string, (deps: Deps) => unknown])[] = [
  [
    "queues.media",
    (deps) => deps.queues.media.send({ type: "ingest_answer_media", answerId: "a" }),
  ],
  [
    "queues.understand",
    (deps) => deps.queues.understand.send({ type: "understand_answer", answerId: "a" }),
  ],
  ["media", (deps) => mediaOf(deps).put("key", new ArrayBuffer(1), "audio/ogg")],
  ["media", (deps) => mediaOf(deps).get("key")],
  ["media", (deps) => mediaOf(deps).delete("key")],
  ["media", (deps) => mediaOf(deps).head("key")],
  ["channels", (deps) => deps.channels.get("telegram")],
  [
    "stt",
    (deps) =>
      deps.stt.transcribe({ audio: new ArrayBuffer(1), mime: "audio/ogg", languageHint: "en" }),
  ],
  ["heartbeat", (deps) => deps.heartbeat.ping()],
  ["config", (deps) => deps.config.publicBaseUrl],
  ["config", (deps) => deps.config.adminConversationId],
  ["config", (deps) => deps.config.privacyNoticeUrls],
  ["config", (deps) => deps.config.privacyNoticeVersion],
  ["config", (deps) => deps.config.environment],
  ["config", (deps) => deps.config.regions],
];

describe("the ports the admin Worker hands services", () => {
  it("pass on each port it was given, as it was given", () => {
    const ports = createFakeAdminDeps([]);

    const deps = servicesDeps(ports);

    for (const name of Object.keys(WHOLE_PORTS)) {
      expect(Reflect.get(deps, name), name).toBe(Reflect.get(ports, name));
    }
    expect(deps.queues.outbound).toBe(ports.queues.outbound);
  });

  // ADR-34: push off, never a port that throws. Services read a non-null port as push on and count
  // an organiser's phone as someone who can be told, which from here would hide from the founder a
  // family that nobody can tell while push is off.
  it("give services no push port, which reads as push off", () => {
    expect(servicesDeps(createFakeAdminDeps([])).push).toBeNull();
  });

  // create_invite's link names the bot, and that is the one field of Config the admin Worker has.
  it("give services the bot's username as the one Config field it has", () => {
    const ports = { ...createFakeAdminDeps([]), telegramBotUsername: "VelaStagingBot" };

    expect(servicesDeps(ports).config.telegramBotUsername).toBe("VelaStagingBot");
  });

  // A port the admin Worker has no binding for must never do nothing quietly: a services change
  // that reaches for one fails the page, and the log names the port.
  it.each(NOT_GIVEN)(
    "fail loudly, naming %s, when services reach for a port not given",
    (port, touch) => {
      const deps = servicesDeps(createFakeAdminDeps([]));

      let thrown: unknown = null;
      try {
        touch(deps);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(PortNotGivenError);
      expect(errorLabel(thrown)).toBe(`PortNotGivenError:${port}`);
    },
  );

  it("reach the real admin action through those ports", async () => {
    const lines: LogLine[] = [];
    const ports: AdminDeps = {
      ...createFakeAdminDeps(lines),
      // The read was already sent: the action decides that inside its transaction and returns
      // without writing, so the only ports it touches are the database, the clock, and the logger.
      db: { transaction: async () => "already_sent" } as unknown as VelaDatabase,
    };
    const weeklyReadId = "33333333-3333-7333-8333-333333333333";

    const result = await adminRuntime.services.sendWeeklyRead(
      ports,
      { admin: "founder@vela.test", familyId: "11111111-1111-7111-8111-111111111111" },
      { weeklyReadId, lines: ["She walked to the market."], suggestion: "" },
    );

    expect(result).toBe("already_sent");
    expect(lines).toEqual([
      {
        level: "info",
        event: "weekly_read_send_refused",
        fields: { weeklyReadId, result: "already_sent" },
      },
    ]);
  });
});

/** One statement a scripted transaction ran: its kind, its table, and what it wrote or read. */
interface Statement {
  readonly op: "select" | "insert" | "update" | "delete";
  table: unknown;
  /** A select's named fields; null for `select()`, which reads whole rows. */
  readonly fields: readonly string[] | null;
  /** What an insert's `values` or an update's `set` was given. */
  values: unknown;
}

interface ScriptedDatabase {
  readonly db: VelaDatabase;
  /** Every statement awaited, in order. */
  readonly statements: readonly Statement[];
  /** Whether a transaction committed: its callback returned rather than threw. */
  committed(): boolean;
}

/**
 * A database for running one admin action whole on the admin Worker's ports, where workerd hosts
 * no Postgres: each statement is Drizzle's chain of builder calls, recorded, and answered when it
 * is awaited with the rows `answer` gives for it. What the action does to real rows is
 * `admin.test.ts`'s, against PGlite.
 */
function scriptedDatabase(answer: (statement: Statement) => unknown[]): ScriptedDatabase {
  const statements: Statement[] = [];
  let committed = false;
  function statement(op: Statement["op"], table: unknown, fields: Statement["fields"]): unknown {
    const current: Statement = { op, table, fields, values: undefined };
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) => {
              statements.push(current);
              try {
                resolve(answer(current));
              } catch (error) {
                reject(error);
              }
            };
          }
          return (...args: unknown[]) => {
            if (property === "from") {
              current.table = args[0];
            }
            if (property === "values" || property === "set") {
              current.values = args[0];
            }
            return chain;
          };
        },
      },
    );
    return chain;
  }
  const tx = {
    select: (fields?: Record<string, unknown>) =>
      statement("select", null, fields === undefined ? null : Object.keys(fields)),
    insert: (table: unknown) => statement("insert", table, null),
    update: (table: unknown) => statement("update", table, null),
    delete: (table: unknown) => statement("delete", table, null),
  };
  const db = {
    transaction: async <T>(run: (transaction: typeof tx) => Promise<T>): Promise<T> => {
      const result = await run(tx);
      committed = true;
      return result;
    },
  };
  return {
    db: db as unknown as VelaDatabase,
    statements,
    committed: () => committed,
  };
}

const TABLE_NAMES = new Map<unknown, string>([
  [members, "members"],
  [families, "families"],
  [adminAccessLog, "admin_access_log"],
  [events, "events"],
  [outbound, "outbound"],
]);

/** The writes a scripted transaction ran, as `[kind, table]`. */
function writesOf(scripted: ScriptedDatabase): string[][] {
  return scripted.statements
    .filter((statement) => statement.op !== "select")
    .map((statement) => [statement.op, TABLE_NAMES.get(statement.table) ?? "another table"]);
}

function valuesWritten(scripted: ScriptedDatabase, table: unknown): unknown[] {
  return scripted.statements
    .filter((statement) => statement.op !== "select" && statement.table === table)
    .map((statement) => statement.values);
}

describe("mark_left on the admin Worker's ports", () => {
  const FOUNDER = "founder@vela.test";
  const family = familyFixture();
  const MIA = "44444444-4444-7444-8444-444444444444";
  const SAM = "55555555-5555-7555-8555-555555555555";
  const mia = memberFixture({
    id: MIA,
    role: "organiser",
    status: "active",
    displayName: "Mia",
    turnsIn: false,
  }).member;
  const sam = memberFixture({ id: SAM, status: "active", displayName: "Sam" }).member;

  /** Anna, the other organiser, with her Telegram link, as `reachableOrganisers` reads them. */
  const anna: { member: Member; link: ChannelLink; push: boolean } = {
    member: memberFixture({ role: "organiser", status: "active", displayName: "Anna" }).member,
    link: {
      id: "66666666-6666-7666-8666-666666666666",
      memberId: "22222222-2222-7222-8222-222222222222",
      channel: "telegram",
      externalId: "1003",
      displayName: "Anna",
      linkedAt: new Date("2026-09-01T00:00:00.000Z"),
      blockedAt: null,
      meta: {},
    },
    push: false,
  };

  /**
   * The family's rows as the action reads them: `marked` is the member the form names, and
   * `reachable` the organisers who can still be told. The family has not ended.
   */
  function familyWith(marked: Member, reachable: readonly unknown[]): ScriptedDatabase {
    return scriptedDatabase((statement) => {
      if (statement.op !== "select") {
        return [];
      }
      if (statement.table === members) {
        return statement.fields === null ? [marked] : [...reachable];
      }
      if (statement.table === families) {
        // `select()` is the family; a named field is `familyHasEnded`, which finds nothing.
        return statement.fields === null ? [family] : [];
      }
      throw new Error(`no rows scripted for a select of ${String(statement.fields)}`);
    });
  }

  function portsOn(scripted: ScriptedDatabase, logs: LogLine[] = []): AdminDeps {
    return { ...createFakeAdminDeps(logs), db: scripted.db };
  }

  it("marks a family member left, with its log row and its event, and reads no Config field", async () => {
    const scripted = familyWith(sam, []);
    const ports = portsOn(scripted);

    const result = await adminRuntime.services.markLeft(
      ports,
      { admin: FOUNDER, familyId: family.id },
      SAM,
    );

    expect(result).toBe("done");
    expect(scripted.committed()).toBe(true);
    expect(writesOf(scripted)).toEqual([
      ["update", "members"],
      ["insert", "admin_access_log"],
      ["insert", "events"],
    ]);
    expect(valuesWritten(scripted, adminAccessLog)).toEqual([
      {
        admin: FOUNDER,
        familyId: family.id,
        memberId: SAM,
        action: "mark_left",
        what: "left",
        at: ports.clock.now(),
      },
    ]);
    expect(valuesWritten(scripted, events)).toEqual([
      expect.objectContaining({
        name: "member_left",
        familyId: family.id,
        memberId: SAM,
        props: { source: "admin", role: "member", kept_light: false },
      }),
    ]);
  });

  // The founder is the one acting, and the admin Worker holds no chat to tell them in (ADR-26 H2),
  // so the page says it: nothing is queued for anyone.
  it("marks the last organiser who could be told left, and answers that nobody is left to tell", async () => {
    const scripted = familyWith(mia, []);
    const sent: unknown[] = [];
    const ports: AdminDeps = {
      ...portsOn(scripted),
      queues: { outbound: { send: async (job) => void sent.push(job) } },
    };

    const result = await adminRuntime.services.markLeft(
      ports,
      { admin: FOUNDER, familyId: family.id },
      MIA,
    );

    expect(result).toBe("nobody_to_tell");
    expect(scripted.committed()).toBe(true);
    expect(writesOf(scripted)).toEqual([
      ["update", "members"],
      ["insert", "admin_access_log"],
      ["insert", "events"],
    ]);
    expect(sent).toEqual([]);
  });

  it("marks an organiser left while another can still be told, and says nothing more", async () => {
    const scripted = familyWith(mia, [anna]);

    const result = await adminRuntime.services.markLeft(
      portsOn(scripted),
      { admin: FOUNDER, familyId: family.id },
      MIA,
    );

    expect(result).toBe("done");
    expect(scripted.committed()).toBe(true);
  });

  it("goes back to the family page, which tells the founder that nobody is left to tell", async () => {
    const scripted = familyWith(mia, []);
    const origin = "https://vela-admin.worker.test";
    const worker = createAdminWorker({
      services: adminRuntime.services,
      createDeps: async () => ({ deps: portsOn(scripted), close: async () => {} }),
      access: async () => ({ email: FOUNDER }),
    });
    const ctx = createExecutionContext();

    const { result: response, lines } = await consoleLinesDuring(() =>
      worker.fetch(
        new Request(`${origin}/admin/families/${family.id}/mark_left`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", Origin: origin },
          body: new URLSearchParams({ memberId: MIA, confirm: "left" }),
        }),
        { ...adminTestEnv, PUBLIC_BASE_URL: origin },
        ctx,
      ),
    );
    await waitOnExecutionContext(ctx);

    expect(lines).toEqual([]);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/admin/families/${family.id}?result=nobody_to_tell`,
    );
    expect(scripted.committed()).toBe(true);
  });
});
