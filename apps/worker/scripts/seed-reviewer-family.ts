/** Owner-only private TTY helper. Never accepts credentials from args, env files or chat. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { connectDatabase, type DatabaseConnection, decodeContentKey } from "@vela/db";
import {
  APP_REVIEW_FAMILY,
  APP_REVIEW_SUBJECT,
  prepareAppReviewFamily,
  ReviewerFixtureRefused,
} from "@vela/services";
import { validatedMutationConnectionString } from "../../../packages/db/src/mutation-target.ts";

function privateInput(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (cancelled: boolean) => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (cancelled) reject(new Error("cancelled"));
      else resolve(value);
      value = "";
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish(false);
          return;
        }
        if (character === "\u0003" || character === "\u0004" || value.length > 16_384) {
          finish(true);
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " " && character !== "\u001b") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

let connection: DatabaseConnection | undefined;
let privateConnection = "";
let privateKey = "";
try {
  if (
    process.argv.slice(2).join(" ") !== "--production" ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    throw new Error("private owner terminal and --production required");
  }
  console.log(
    "Apple Review — fictional people and sample words only. Demo Parent waits for their own consent. No contacts, deliveries, consent, or scheduled work will be added.",
  );
  console.log("Credentials stay in this process and are never printed or saved. Ctrl+C cancels.");
  privateConnection = validatedMutationConnectionString(
    await privateInput("Production Neon DIRECT connection (hidden): "),
    "production",
    process.env.PGOPTIONS,
  );
  privateKey = (await privateInput("Saved production CONTENT_KEY_V1 (hidden): ")).trim();
  decodeContentKey(privateKey);
  connection = await connectDatabase(privateConnection, privateKey);
  const result = await prepareAppReviewFamily(
    { db: connection.db, clock: { now: () => new Date() } },
    APP_REVIEW_SUBJECT,
  );
  const receipt = {
    checkedAt: new Date().toISOString(),
    source: "private-owner-app-review-fixture",
    environment: "production",
    familyId: APP_REVIEW_FAMILY,
    replayed: result.replayed,
    noRealContacts: true,
    noMessagesSent: true,
    parentAwaitingConsent: true,
    syntheticSamples: true,
    nativeApiReadVerified: false,
  };
  const target = new URL(
    "../../../../verification-2026-11-02/apple-review/private-family-receipt.json",
    import.meta.url,
  );
  await mkdir(dirname(target.pathname), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  console.log(
    "Reviewer family prepared. Engineering still needs to verify the sample in the signed-in app; this does not prove messenger delivery.",
  );
} catch (error) {
  console.error(
    error instanceof ReviewerFixtureRefused
      ? error.message
      : "Reviewer setup stopped. No private diagnostics were printed. Ask engineering to check the helper; do not paste credentials into chat.",
  );
  process.exitCode = 1;
} finally {
  privateConnection = "";
  privateKey = "";
  await connection?.close().catch(() => {
    process.exitCode = 1;
  });
}
