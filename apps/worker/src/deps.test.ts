import type { Logger } from "@vela/services";
import { describe, expect, it } from "vitest";
import { createHeartbeat } from "./deps.ts";

/**
 * A Healthchecks ping URL as the founder pastes it: the uuid in it is the whole credential, so
 * whoever reads it out of a log can silence or fake the monitor.
 */
const PING_URL = "https://hc-ping.com/6f1a0f8e-0000-4000-8000-2f1b0e4d9c77";

interface LogLine {
  readonly level: string;
  readonly event: string;
  readonly fields: Record<string, unknown> | undefined;
}

function recordingLogger(lines: LogLine[]): Logger {
  return {
    info: (event, fields) => lines.push({ level: "info", event, fields }),
    warn: (event, fields) => lines.push({ level: "warn", event, fields }),
    error: (event, fields) => lines.push({ level: "error", event, fields }),
  };
}

describe("the heartbeat", () => {
  it("pings the monitor and says nothing while it answers", async () => {
    const lines: LogLine[] = [];
    const sent: string[] = [];
    const heartbeat = createHeartbeat(PING_URL, recordingLogger(lines), {
      fetch: async (resource, init) => {
        sent.push(`${init?.method ?? "GET"} ${String(resource)}`);
        return new Response("OK");
      },
    });

    await heartbeat.ping();

    expect(sent).toEqual([`POST ${PING_URL}`]);
    expect(lines).toEqual([]);
  });

  it("keeps the ping URL out of the log line when the fetch fails", async () => {
    const lines: LogLine[] = [];
    const heartbeat = createHeartbeat(PING_URL, recordingLogger(lines), {
      // What workerd throws for a URL it cannot load: the message carries the URL it was given,
      // which for a mistyped or scheme-less ping URL is the secret itself.
      fetch: async (resource) => {
        throw new TypeError(`Fetch API cannot load: ${String(resource)}`);
      },
    });

    await heartbeat.ping();

    expect(lines).toEqual([
      { level: "warn", event: "heartbeat_failed", fields: { reason: "network" } },
    ]);
    expect(JSON.stringify(lines)).not.toContain("hc-ping.com");
  });

  it("says the status the monitor answered with, which carries nothing secret", async () => {
    const lines: LogLine[] = [];
    const heartbeat = createHeartbeat(PING_URL, recordingLogger(lines), {
      fetch: async () => new Response("no", { status: 502 }),
    });

    await heartbeat.ping();

    expect(lines).toEqual([{ level: "warn", event: "heartbeat_failed", fields: { status: 502 } }]);
  });
});
