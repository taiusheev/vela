import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchMe: vi.fn() }));
vi.mock("./client.ts", async (original) => ({
  ...(await original<typeof import("./client.ts")>()),
  fetchMe: mocks.fetchMe,
}));

const { ApiError } = await import("./client.ts");
const { readMe } = await import("./read-me.ts");

const me = { user: { id: "synthetic" }, memberships: [] };

describe("readMe", () => {
  it("asks once more with a fresh token when the first token is refused just after sign-in", async () => {
    mocks.fetchMe.mockReset();
    mocks.fetchMe
      .mockRejectedValueOnce(new ApiError(401, "unauthorized"))
      .mockResolvedValueOnce(me);
    const token = vi.fn(async (options?: { fresh?: boolean }) =>
      options?.fresh === true ? "fresh" : "cached",
    );

    await expect(readMe({ token })).resolves.toBe(me);
    expect(mocks.fetchMe.mock.calls.map((call) => call[0])).toEqual(["cached", "fresh"]);
  });

  it("does not ask again for any other failure", async () => {
    mocks.fetchMe.mockReset();
    mocks.fetchMe.mockRejectedValueOnce(new ApiError(503, "unavailable"));
    const token = vi.fn(async () => "cached");

    await expect(readMe({ token })).rejects.toMatchObject({ status: 503 });
    expect(mocks.fetchMe).toHaveBeenCalledTimes(1);
  });
});
