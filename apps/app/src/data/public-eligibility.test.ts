import { describe, expect, it, vi } from "vitest";
import { EligibilityReviewController, eligibilityReviewDecision } from "./public-eligibility.ts";

function ready(controller: EligibilityReviewController) {
  controller.change({ adult: "yes", taiwan: "yes", noticeRead: true, termsRead: true });
}
describe("Taiwan eligibility review controller", () => {
  it.each(["no", "unsure"] as const)(
    "does not submit excluded or undisclosed %s answers",
    async (answer) => {
      const record = vi.fn();
      const c = new EligibilityReviewController("demo", { record, clear: vi.fn() }, () => "key");
      ready(c);
      c.change({ adult: answer });
      expect(eligibilityReviewDecision(c.snapshot())).toBe("outside_scope");
      await c.save();
      expect(record).not.toHaveBeenCalled();
    },
  );
  it("requires separate acknowledgements, not just passing age and residence", async () => {
    const record = vi.fn();
    const c = new EligibilityReviewController("demo", { record, clear: vi.fn() }, () => "key");
    c.change({ adult: "yes", taiwan: "yes" });
    await c.save();
    expect(record).not.toHaveBeenCalled();
    c.change({ noticeRead: true });
    await c.save();
    expect(record).not.toHaveBeenCalled();
  });
  it("uses the same retry key after failure, preserves answers and never claims saved", async () => {
    const record = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const c = new EligibilityReviewController("demo", { record, clear: vi.fn() }, () => "same-key");
    ready(c);
    await c.save();
    expect(c.snapshot()).toMatchObject({ status: "failed", adult: "yes" });
    await c.save();
    expect(c.snapshot().status).toBe("saved");
    expect(record.mock.calls.map((call) => call[1])).toEqual(["same-key", "same-key"]);
  });
  it("ignores double taps and late results after leaving the scope", async () => {
    let finish = () => {};
    const record = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const c = new EligibilityReviewController("first", { record, clear: vi.fn() }, () => "key");
    ready(c);
    const pending = c.save();
    await c.save();
    expect(record).toHaveBeenCalledTimes(1);
    c.dispose();
    finish();
    await pending;
    expect(c.snapshot().status).toBe("saving");
    const next = new EligibilityReviewController(
      "next",
      { record, clear: vi.fn() },
      () => "new-key",
    );
    expect(next.snapshot().adult).toBeNull();
  });
  it("changing the displayed document language resets its acknowledgements", () => {
    const c = new EligibilityReviewController(
      "demo",
      { record: vi.fn(), clear: vi.fn() },
      () => "key",
    );
    ready(c);
    c.change({ language: "zh-TW" });
    expect(c.snapshot()).toMatchObject({ noticeRead: false, termsRead: false, adult: "yes" });
  });
  it("keeps a failed clear visible and retries without claiming the declaration disappeared", async () => {
    const clear = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const c = new EligibilityReviewController("demo", { record: vi.fn(), clear }, () => "key");
    ready(c);
    await c.save();
    await c.clear();
    expect(c.snapshot().status).toBe("saved");
    await c.clear();
    expect(c.snapshot()).toMatchObject({ status: "editing", adult: null, noticeRead: false });
  });
});
