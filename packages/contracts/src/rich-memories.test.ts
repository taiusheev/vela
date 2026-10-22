import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MEMORY_KEEP_EXPLANATION_EN, MEMORY_KEEP_EXPLANATION_SHA256 } from "./rich-memories.ts";

describe("memory keep confirmation", () => {
  it("publishes the fingerprint of exactly the words the person confirms", () => {
    expect(createHash("sha256").update(MEMORY_KEEP_EXPLANATION_EN).digest("hex")).toBe(
      MEMORY_KEEP_EXPLANATION_SHA256,
    );
  });
});
