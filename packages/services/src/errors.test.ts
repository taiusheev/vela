import { ChannelSendError } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { errorLabel, VelaError } from "./errors.ts";

/** The shape of Drizzle's `DrizzleQueryError`: its message lists the query's parameters. */
class FailedQuery extends Error {
  constructor(params: string[], cause: unknown) {
    super(
      `Failed query: insert into "answers" ("payload") values ($1)\nparams: ${params.join(",")}`,
    );
    this.cause = cause;
  }
}

/** The shape of node-postgres' `DatabaseError`: name "error", the SQLSTATE as `code`. */
class DriverError extends Error {
  override readonly name = "error";
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

describe("errorLabel", () => {
  it("names a failed query and its driver error by class and SQLSTATE, never by the words in them", () => {
    const words = "my chest hurts a bit";
    const error = new FailedQuery(
      [JSON.stringify({ text: words })],
      new DriverError(`invalid input syntax for type uuid: "${words}"`, "22P02"),
    );

    const label = errorLabel(error);

    expect(label).toBe("Error <- error:22P02");
    expect(label).not.toContain("chest");
  });

  it("keeps the code of a channel send error and of a Vela error, and drops the platform's text", () => {
    expect(
      errorLabel(new ChannelSendError("invalid_request", "Bad Request: message text is my chest")),
    ).toBe("ChannelSendError:invalid_request");
    expect(errorLabel(new VelaError("not_found", "outbound row 1 does not exist"))).toBe(
      "VelaError:not_found",
    );
  });

  it("leaves out a code that is not an identifier, and says unknown for a thrown value that is no error", () => {
    const odd = Object.assign(new TypeError("boom"), { code: "she said: call me" });

    expect(errorLabel(odd)).toBe("TypeError");
    expect(errorLabel("my chest hurts")).toBe("unknown");
    expect(errorLabel(null)).toBe("unknown");
  });

  it("follows causes three deep and no further", () => {
    const deep = new Error("1", {
      cause: new Error("2", { cause: new Error("3", { cause: new RangeError("4") }) }),
    });

    expect(errorLabel(deep)).toBe("Error <- Error <- Error");
  });
});
