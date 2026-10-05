import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://vela.example");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("existing Telegram family connection", () => {
  it("starts an authenticated, idempotent empty-body challenge and completes with that session", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challenge_id: "challenge",
            telegram_url: "https://t.me/example?start=link_challenge",
            expires_at: "2026-10-05T12:15:00Z",
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ linked: true, member_id: "member", family_id: "family" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const { startTelegramLink, completeTelegramLink } = await import("./client.ts");
    const challenge = await startTelegramLink("same-start-attempt", "test-session");
    await completeTelegramLink(
      { challenge_id: challenge.challenge_id, code: "test-code" },
      "same-complete-attempt",
      "test-session",
    );
    expect(fetch.mock.calls[0]).toEqual([
      "https://vela.example/v1/me/link",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          authorization: "Bearer test-session",
          "idempotency-key": "same-start-attempt",
        }),
      }),
    ]);
    expect(fetch.mock.calls[1]).toEqual([
      "https://vela.example/v1/me/link/complete",
      expect.objectContaining({
        body: JSON.stringify({ challenge_id: "challenge", code: "test-code" }),
        headers: expect.objectContaining({
          authorization: "Bearer test-session",
          "idempotency-key": "same-complete-attempt",
        }),
      }),
    ]);
  });
  it("reads non-sensitive pilot capabilities before an account profile exists", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pilot: true,
          telegram_first: true,
          english_only: true,
          memory: false,
          book: false,
          parent_app: false,
          billing: false,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const { fetchCapabilities } = await import("./client.ts");
    expect((await fetchCapabilities()).telegram_first).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://vela.example/v1/capabilities",
      expect.objectContaining({ method: "GET", headers: { accept: "application/json" } }),
    );
  });
  it("keeps a refused connection a failure instead of assuming it linked", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }),
        ),
    );
    const { completeTelegramLink } = await import("./client.ts");
    await expect(
      completeTelegramLink(
        { challenge_id: "challenge", code: "code" },
        "same-attempt",
        "test-session",
      ),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});
