import type { VelaDatabase } from "@vela/db";
import { type Deps, errorLabel, type MediaStore } from "@vela/services";
import { describe, expect, it } from "vitest";
import { adminRuntime, PortNotGivenError, servicesDeps } from "./admin-runtime.ts";
import type { AdminDeps } from "./deps.ts";
import { createFakeAdminDeps, type LogLine } from "./testing/fakes.ts";

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
