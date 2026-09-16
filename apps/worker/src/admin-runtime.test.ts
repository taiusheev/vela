import type { VelaDatabase } from "@vela/db";
import { type Deps, errorLabel } from "@vela/services";
import { describe, expect, it } from "vitest";
import { adminRuntime, PortNotGivenError, servicesDeps } from "./admin-runtime.ts";
import type { AdminDeps } from "./deps.ts";
import { createFakeAdminDeps, type LogLine } from "./testing/fakes.ts";

/**
 * The admin ports passed on whole. A record over `AdminDeps`, so a port added to the admin Worker
 * cannot be left out here without the typecheck failing; `queues` is checked queue by queue.
 */
const WHOLE_PORTS: Readonly<Record<Exclude<keyof AdminDeps, "queues">, true>> = {
  db: true,
  clock: true,
  logger: true,
  scheduler: true,
  ai: true,
};

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
  ["random", (deps) => deps.random.token()],
  ["media", (deps) => deps.media.put("key", new ArrayBuffer(1), "audio/ogg")],
  ["media", (deps) => deps.media.get("key")],
  ["media", (deps) => deps.media.delete("key")],
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
