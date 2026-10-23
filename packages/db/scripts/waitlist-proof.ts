/** Run through the protected workflow, never with production credentials on a laptop. */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { validatedMutationConnectionString } from "../src/mutation-target.ts";
import { proveWaitlist, WAITLIST_PROOF_ORIGINS } from "../src/waitlist-proof.ts";

let client: Client | undefined;
try {
  const target = process.env.WAITLIST_PROOF_TARGET;
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.VELA_DATABASE_ENVIRONMENT !== "production" ||
    (target !== "public-domain" && target !== "production-worker")
  ) {
    throw new Error("protected production workflow required");
  }
  const connectionString = validatedMutationConnectionString(
    process.env.DATABASE_URL ?? "",
    "production",
    process.env.PGOPTIONS,
  );
  client = new Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  client.on("error", () => {
    /* Provider diagnostics must remain private. */
  });
  await client.connect();
  const connected = client;
  await proveWaitlist(
    {
      query: (sql, parameters) => connected.query(sql, parameters),
      submit: async (origin, email, language) => {
        if (
          !Object.values(WAITLIST_PROOF_ORIGINS).includes(
            origin as (typeof WAITLIST_PROOF_ORIGINS)["public-domain"],
          )
        ) {
          return false;
        }
        const response = await fetch(`${origin}/waitlist`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: {
            origin,
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ email, lang: language, website: "" }),
        });
        return (
          response.status === 200 &&
          ((await response.json()) as { joined?: unknown }).joined === true
        );
      },
    },
    target,
    randomUUID().replaceAll("-", ""),
  );
  console.log(
    JSON.stringify({
      check: "public_waitlist",
      target,
      languages: 2,
      saved: true,
      duplicateSafe: true,
      syntheticRowsRemoved: true,
      passed: true,
    }),
  );
} catch {
  // An HTTP acknowledgement alone is never evidence of persistence. Do not echo SQL or emails.
  console.error(
    "Public waitlist proof FAILED. Keep campaign on hold; inspect routing and synthetic cleanup privately. No family data was queried.",
  );
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {
    process.exitCode = 1;
  });
}
