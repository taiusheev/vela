import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proveWaitlist, type WaitlistProofPorts } from "./waitlist-proof.ts";

const NONCE = "a".repeat(32);
let db: PGlite;
let ports: WaitlistProofPorts;
let submitted: string[];

beforeEach(async () => {
  db = new PGlite();
  await db.exec("create table waitlist_signups (email text primary key, language text not null)");
  await db.query("insert into waitlist_signups values ($1, 'en')", ["unrelated@example.invalid"]);
  submitted = [];
  ports = {
    query: (sql, values) => db.query(sql, values),
    submit: async (origin, email, language) => {
      submitted.push(origin);
      await db.query("insert into waitlist_signups values ($1, $2) on conflict do nothing", [
        email,
        language,
      ]);
      return true;
    },
  };
});
afterEach(async () => {
  await db.close();
});

async function remaining() {
  return (await db.query<{ email: string }>("select email from waitlist_signups order by email"))
    .rows;
}

describe("protected public waitlist proof", () => {
  it("proves both languages and duplicate saving through HTTP, removes only its generated rows", async () => {
    await proveWaitlist(ports, "public-domain", NONCE);
    expect(submitted).toEqual(Array(4).fill("https://vela-light.com"));
    expect(await remaining()).toEqual([{ email: "unrelated@example.invalid" }]);
  });

  it("does not treat an acknowledged request into another database as a saved signup", async () => {
    ports.submit = async () => true;
    await expect(proveWaitlist(ports, "production-worker", NONCE)).rejects.toThrow("not saved");
    expect(await remaining()).toEqual([{ email: "unrelated@example.invalid" }]);
  });

  it("fails on a wrong language and still removes the generated row", async () => {
    ports.submit = async (_origin, email) => {
      await db.query("insert into waitlist_signups values ($1, 'wrong')", [email]);
      return true;
    };
    await expect(proveWaitlist(ports, "public-domain", NONCE)).rejects.toThrow("not saved");
    expect(await remaining()).toEqual([{ email: "unrelated@example.invalid" }]);
  });

  it("cleans up an insertion even if the submission subsequently fails", async () => {
    ports.submit = async (_origin, email, language) => {
      await db.query("insert into waitlist_signups values ($1, $2)", [email, language]);
      throw new Error("synthetic network failure");
    };
    await expect(proveWaitlist(ports, "public-domain", NONCE)).rejects.toThrow("network failure");
    expect(await remaining()).toEqual([{ email: "unrelated@example.invalid" }]);
  });

  it("refuses an existing synthetic marker without submitting or deleting it", async () => {
    const email = `vela-public-proof-${NONCE}-en@example.invalid`;
    await db.query("insert into waitlist_signups values ($1, 'en')", [email]);
    await expect(proveWaitlist(ports, "public-domain", NONCE)).rejects.toThrow("already exists");
    expect(submitted).toEqual([]);
    expect((await remaining()).map((row) => row.email)).toContain(email);
  });

  it("cannot accept a supplied email or an arbitrary network destination", async () => {
    await expect(proveWaitlist(ports, "public-domain", "person@example.invalid")).rejects.toThrow(
      "invalid",
    );
    await expect(proveWaitlist(ports, "foreign" as "public-domain", NONCE)).rejects.toThrow(
      "invalid",
    );
    expect(submitted).toEqual([]);
  });

  it("fails if cleanup is ineffective", async () => {
    const actualQuery = ports.query;
    ports.query = (sql, values) =>
      sql.startsWith("delete") ? Promise.resolve({ rows: [] }) : actualQuery(sql, values);
    await expect(proveWaitlist(ports, "public-domain", NONCE)).rejects.toThrow("cleanup failed");
  });
});
