/** Private Terminal helper: create only ADR-38's isolated synthetic staging fixture. */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { localDateOf } from "@vela/core";
import {
  answers,
  connectDatabase,
  type DatabaseConnection,
  decodeContentKey,
  exchanges,
  families,
  type Member,
  members,
  replies,
  users,
  type VelaTransaction,
} from "@vela/db";
import { loadApiExchanges } from "@vela/services";
import { eq, inArray, or, sql } from "drizzle-orm";

const SOURCE_HOST = "ep-frosty-night-b31xz5dh.c-4.ap-southeast-1.aws.neon.tech";
const FAMILY_NAME = "ADR38 synthetic load fixture";
const ORGANISER_NAME = "ADR38 synthetic organiser";
const RECIPIENT_NAME = "ADR38 synthetic recipient";
const ASK = "Synthetic ADR38 test: what colour is the sample garden?";
const ANSWER = "Synthetic ADR38 test: the sample garden is green.";
const REPLY = "Synthetic ADR38 test: the sample reply is recorded.";
const DAY_MS = 86_400_000;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const receiptPath = fileURLToPath(
  new URL("../../../infra/load-tests/adr-38-staging-fixture.json", import.meta.url),
);
const receiptProvenance = {
  source: "staging-load-fixture-helper",
  environment: "staging",
  databaseHost: SOURCE_HOST,
  schemaVersion: 1,
} as const;

interface FixtureReceipt {
  source: typeof receiptProvenance.source;
  environment: typeof receiptProvenance.environment;
  databaseHost: typeof receiptProvenance.databaseHost;
  schemaVersion: typeof receiptProvenance.schemaVersion;
  /** Set only after the verified transaction has committed successfully. */
  checkedAt?: string;
  familyId?: string;
  /** Clerk's dedicated user_… identifier, not a bearer token or database user UUID. */
  userId?: string;
  created: boolean;
  fixtureVerified: boolean;
  ciphertextVerified: boolean;
  sourceKeyVerified: boolean;
  apiDecoded: boolean;
  noDeliveryRoutesVerified: boolean;
}

class FixtureRefused extends Error {}

let connection: DatabaseConnection | undefined;
let privateConnection: string | undefined;
let savedKey: string | undefined;
let decodedKey: Uint8Array | undefined;
let keyCheckChild: ChildProcess | undefined;
let cancelInput: (() => void) | undefined;
let stopping = false;
let receipt: FixtureReceipt = {
  ...receiptProvenance,
  created: false,
  fixtureVerified: false,
  ciphertextVerified: false,
  sourceKeyVerified: false,
  apiDecoded: false,
  noDeliveryRoutesVerified: false,
};

function say(message = ""): void {
  process.stdout.write(`${message}\n`);
}

function clearReceiptProofs(): void {
  receipt = {
    ...receipt,
    fixtureVerified: false,
    ciphertextVerified: false,
    sourceKeyVerified: false,
    apiDecoded: false,
    noDeliveryRoutesVerified: false,
  };
  delete receipt.checkedAt;
}

async function saveReceipt(): Promise<void> {
  await mkdir(dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  await rename(temporaryPath, receiptPath);
}

/** Inputs are read from the founder's TTY, never arguments, env files, or echoed text. */
function privateInput(prompt: string): Promise<string> {
  if (stopping) return Promise.reject(new FixtureRefused("cancelled"));
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (cancelled = false): void => {
      process.stdin.removeListener("data", onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Closing a Terminal window can remove its TTY before cleanup.
      }
      process.stdin.pause();
      cancelInput = undefined;
      say();
      if (cancelled) reject(new FixtureRefused("cancelled"));
      else resolve(value);
      value = "";
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003" || character === "\u0004") {
          finish(true);
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " " && character !== "\u001b") {
          if (value.length >= 16_384) {
            finish(true);
            return;
          }
          value += character;
        }
      }
    };
    cancelInput = () => finish(true);
    process.stdin.on("data", onData);
  });
}

function acceptedConnection(value: string): boolean {
  try {
    const url = new URL(value);
    const keys = [...url.searchParams.keys()];
    return (
      ["postgresql:", "postgres:"].includes(url.protocol) &&
      url.hostname === SOURCE_HOST &&
      (url.port === "" || url.port === "5432") &&
      decodeURIComponent(url.username) === "neondb_owner" &&
      url.password.length > 0 &&
      url.pathname === "/neondb" &&
      url.hash === "" &&
      !value.includes("#") &&
      keys.every((key) => ["sslmode", "channel_binding"].includes(key)) &&
      keys.length === new Set(keys).size &&
      ["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "") &&
      (url.searchParams.get("channel_binding") === null ||
        url.searchParams.get("channel_binding") === "require")
    );
  } catch {
    return false;
  }
}

function requireFixture(condition: boolean): asserts condition {
  if (!condition) throw new FixtureRefused("fixture_is_not_isolated");
}

/** The private child proves this key opens existing source data, without returning its value. */
function opensExistingCiphertext(connectionString: string, encodedKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn(process.execPath, ["packages/db/scripts/seal-check.ts"], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        DATABASE_URL: connectionString,
        CONTENT_KEY_V1: encodedKey,
      },
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    keyCheckChild = child;
    const finish = (verified: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      output = "";
      keyCheckChild = undefined;
      resolve(verified);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false);
    }, 30_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 16_384) {
        child.kill("SIGTERM");
        finish(false);
      }
    });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && output.trim() === "opens"));
  });
}

function safeMember(member: Member): boolean {
  return (
    member.language === "en" &&
    member.tz === "Asia/Taipei" &&
    member.country === "TW" &&
    member.primarySurface === "app" &&
    member.billing === false &&
    member.turnsIn === false &&
    member.lightOn === false &&
    member.lightConsentedAt === null &&
    member.lightConsentText === null &&
    member.lightStartsOn === null &&
    member.nextWakeAt === null &&
    member.leftAt === null &&
    member.addressForm === null &&
    member.ageBand === null &&
    member.learningUntil === null &&
    member.wakeTime === null &&
    member.arrivalTime === "08:00" &&
    member.quietAfterMin === 360 &&
    Object.keys(member.answerStats).length === 0
  );
}

/** Check routes by existence only: never select tokens, addresses, or message content. */
async function hasNoDeliveryRoutes(
  tx: VelaTransaction,
  familyId: string,
  userId: string,
  memberIds: string[],
  exchangeId: string,
): Promise<boolean> {
  const familyTables = [
    "family_channels",
    "invites",
    "nearby_contacts",
    "media",
    "turns",
    "suggestions",
    "stories",
    "recipes",
    "reminders",
    "weekly_reads",
    "book_entries",
    "message_refs",
    "api_request_receipts",
  ];
  const memberTables = ["channel_links", "quiet_events", "away_periods", "memory_facts"];
  const absent = [
    ...familyTables.map(
      (table) =>
        sql`NOT EXISTS (SELECT 1 FROM public.${sql.identifier(table)} WHERE family_id = ${familyId})`,
    ),
    ...memberTables.map(
      (table) =>
        sql`NOT EXISTS (SELECT 1 FROM public.${sql.identifier(table)} WHERE member_id IN (${sql.join(
          memberIds.map((id) => sql`${id}`),
          sql`, `,
        )}))`,
    ),
    sql`NOT EXISTS (SELECT 1 FROM public.push_devices WHERE user_id = ${userId})`,
    sql`NOT EXISTS (SELECT 1 FROM public.account_link_challenges WHERE user_id = ${userId} OR family_id = ${familyId})`,
    sql`NOT EXISTS (SELECT 1 FROM public.outbound WHERE member_id IN (${sql.join(
      memberIds.map((id) => sql`${id}`),
      sql`, `,
    )}) OR actor_id IN (${sql.join(
      memberIds.map((id) => sql`${id}`),
      sql`, `,
    )}) OR exchange_id = ${exchangeId})`,
    sql`NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE family_id = ${familyId} OR payer_user_id = ${userId} OR member_id IN (${sql.join(
      memberIds.map((id) => sql`${id}`),
      sql`, `,
    )}))`,
    sql`NOT EXISTS (SELECT 1 FROM public.consents WHERE member_id IN (${sql.join(
      memberIds.map((id) => sql`${id}`),
      sql`, `,
    )}) OR subject_ref IN (${sql.join(
      memberIds.map((id) => sql`${`member:${id}`}`),
      sql`, `,
    )}))`,
    sql`NOT EXISTS (SELECT 1 FROM public.ai_calls WHERE family_id = ${familyId})`,
    sql`NOT EXISTS (SELECT 1 FROM public.chips WHERE exchange_id = ${exchangeId})`,
  ];
  const result = await tx.execute<{ isolated: boolean }>(
    sql`SELECT ${sql.join(absent, sql` AND `)} AS isolated`,
  );
  return result.rows.length === 1 && result.rows[0]?.isolated === true;
}

async function prepareFixture(
  tx: VelaTransaction,
  authSubject: string,
  now: Date,
): Promise<FixtureReceipt> {
  await tx.execute(sql`SET LOCAL search_path = public, pg_catalog`);
  await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${FAMILY_NAME}, 0))`);
  const namedFamilies = await tx.select().from(families).where(eq(families.name, FAMILY_NAME));
  const accounts = await tx.select().from(users).where(eq(users.authSubject, authSubject));
  requireFixture(namedFamilies.length <= 1 && accounts.length <= 1);
  const created = accounts.length === 0 && namedFamilies.length === 0;
  if (!created) requireFixture(accounts.length === 1 && namedFamilies.length === 1);

  if (created) {
    const [account] = await tx
      .insert(users)
      .values({
        authSubject,
        displayName: ORGANISER_NAME,
        language: "en",
        tz: "Asia/Taipei",
        oneMomentADay: false,
      })
      .returning();
    requireFixture(account !== undefined);
    const [family] = await tx
      .insert(families)
      .values({
        name: FAMILY_NAME,
        region: "apac",
        country: "TW",
        language: "en",
        plan: "free",
        turnsEnabled: false,
        createdBy: account.id,
      })
      .returning();
    requireFixture(family !== undefined);
    const [organiser] = await tx
      .insert(members)
      .values({
        familyId: family.id,
        userId: account.id,
        role: "organiser",
        displayName: ORGANISER_NAME,
        language: "en",
        tz: "Asia/Taipei",
        country: "TW",
        status: "active",
        turnsIn: false,
        primarySurface: "app",
        lightOn: false,
      })
      .returning();
    const [recipient] = await tx
      .insert(members)
      .values({
        familyId: family.id,
        role: "member",
        displayName: RECIPIENT_NAME,
        language: "en",
        tz: "Asia/Taipei",
        country: "TW",
        status: "paused",
        turnsIn: false,
        primarySurface: "app",
        lightOn: false,
      })
      .returning();
    requireFixture(organiser !== undefined && recipient !== undefined);
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    const [exchange] = await tx
      .insert(exchanges)
      .values({
        familyId: family.id,
        recipientId: recipient.id,
        askerId: organiser.id,
        type: "question",
        state: "read_back",
        text: ASK,
        textLang: "en",
        scheduledFor: localDateOf(ago(8), "Asia/Taipei"),
        createdAt: ago(10),
        deliveredAt: ago(8),
        seenAt: ago(7),
        answeredAt: ago(6),
        repliedAt: ago(4),
        readBackAt: ago(3),
      })
      .returning();
    requireFixture(exchange !== undefined);
    await tx.insert(answers).values({
      exchangeId: exchange.id,
      memberId: recipient.id,
      kind: "text",
      channel: "app",
      payload: { text: ANSWER },
      receivedAt: ago(6),
      understoodAt: ago(6),
    });
    await tx.insert(replies).values({
      exchangeId: exchange.id,
      memberId: organiser.id,
      kind: "text",
      text: REPLY,
      channel: "app",
      toRecipient: false,
      createdAt: ago(4),
      readBackAt: ago(3),
    });
  }

  // A repeat verifies the entire fixture and leaves it unchanged.
  const [account] = await tx.select().from(users).where(eq(users.authSubject, authSubject));
  const [family] = await tx.select().from(families).where(eq(families.name, FAMILY_NAME));
  requireFixture(account !== undefined && family !== undefined);
  requireFixture(
    account.displayName === ORGANISER_NAME &&
      account.email === null &&
      account.phone === null &&
      account.deletedAt === null &&
      account.language === "en" &&
      account.tz === "Asia/Taipei" &&
      account.oneMomentADay === false &&
      family.createdBy === account.id &&
      family.deletedAt === null &&
      family.region === "apac" &&
      family.country === "TW" &&
      family.language === "en" &&
      family.plan === "free" &&
      family.storyDay === 0 &&
      family.turnsEnabled === false,
  );
  const memberships = await tx.select().from(members).where(eq(members.userId, account.id));
  const familyMembers = await tx.select().from(members).where(eq(members.familyId, family.id));
  requireFixture(memberships.length === 1 && familyMembers.length === 2);
  const organiser = familyMembers.find((member) => member.userId === account.id);
  const recipient = familyMembers.find((member) => member.userId === null);
  requireFixture(organiser !== undefined && recipient !== undefined);
  requireFixture(
    organiser.id === memberships[0]?.id &&
      organiser.role === "organiser" &&
      organiser.status === "active" &&
      organiser.displayName === ORGANISER_NAME &&
      recipient.role === "member" &&
      recipient.status === "paused" &&
      recipient.displayName === RECIPIENT_NAME &&
      safeMember(organiser) &&
      safeMember(recipient),
  );
  const memberIds = [organiser.id, recipient.id];
  const exchangeRows = await tx
    .select()
    .from(exchanges)
    .where(
      or(
        eq(exchanges.familyId, family.id),
        inArray(exchanges.recipientId, memberIds),
        inArray(exchanges.askerId, memberIds),
      ),
    );
  requireFixture(exchangeRows.length === 1);
  const exchange = exchangeRows[0];
  requireFixture(exchange !== undefined);
  requireFixture(
    exchange.familyId === family.id &&
      exchange.recipientId === recipient.id &&
      exchange.askerId === organiser.id &&
      exchange.type === "question" &&
      exchange.state === "read_back" &&
      exchange.text === ASK &&
      exchange.textLang === "en" &&
      exchange.onBehalfOf === null &&
      exchange.options === null &&
      exchange.mediaIds.length === 0 &&
      exchange.voiceHelloId === null &&
      exchange.whenRule === "tomorrow" &&
      exchange.scheduledFor !== null &&
      exchange.deliveredAt !== null &&
      exchange.deliveredAt.getTime() >= now.getTime() - 30 * DAY_MS &&
      exchange.deliveredAt.getTime() <= now.getTime() &&
      exchange.answeredAt !== null &&
      exchange.readBackAt !== null &&
      exchange.deliveryFailedAt === null &&
      exchange.deliveryLate === false &&
      exchange.archivedAt === null,
  );
  const answerRows = await tx
    .select()
    .from(answers)
    .where(or(eq(answers.exchangeId, exchange.id), inArray(answers.memberId, memberIds)));
  const replyRows = await tx
    .select()
    .from(replies)
    .where(or(eq(replies.exchangeId, exchange.id), inArray(replies.memberId, memberIds)));
  requireFixture(answerRows.length === 1 && replyRows.length === 1);
  const answer = answerRows[0];
  const reply = replyRows[0];
  requireFixture(answer !== undefined && reply !== undefined);
  requireFixture(
    answer.exchangeId === exchange.id &&
      answer.memberId === recipient.id &&
      answer.kind === "text" &&
      answer.channel === "app" &&
      answer.externalId === null &&
      answer.payload.text === ANSWER &&
      Object.keys(answer.payload).length === 1 &&
      answer.mediaId === null &&
      answer.transcript === null &&
      answer.transcriptLang === null &&
      answer.summary === null &&
      answer.moodWords.length === 0 &&
      Object.keys(answer.mentions).length === 0 &&
      answer.flag === false &&
      answer.flagReason === null &&
      answer.awayUntil === null &&
      answer.understoodAt !== null &&
      answer.processingAttempts === 0 &&
      reply.exchangeId === exchange.id &&
      reply.memberId === organiser.id &&
      reply.kind === "text" &&
      reply.channel === "app" &&
      reply.externalId === null &&
      reply.text === REPLY &&
      reply.mediaId === null &&
      reply.toRecipient === false &&
      reply.readBackAt !== null &&
      reply.reactedMessageIds.length === 0,
  );
  requireFixture(await hasNoDeliveryRoutes(tx, family.id, account.id, memberIds, exchange.id));

  const raw = await tx.execute<{ ask: boolean; answer: boolean; reply: boolean }>(sql`
    SELECT e.text LIKE 'v1.%' AND e.text <> ${ASK} AS ask,
           a.payload->>'text' LIKE 'v1.%' AND a.payload->>'text' <> ${ANSWER} AS answer,
           r.text LIKE 'v1.%' AND r.text <> ${REPLY} AS reply
    FROM public.exchanges e
    JOIN public.answers a ON a.exchange_id = e.id
    JOIN public.replies r ON r.exchange_id = e.id
    WHERE e.id = ${exchange.id}
  `);
  requireFixture(
    raw.rows.length === 1 &&
      raw.rows[0]?.ask === true &&
      raw.rows[0]?.answer === true &&
      raw.rows[0]?.reply === true,
  );
  // This calls the API's actual read service, not a second hand-written projection.
  const page = await loadApiExchanges(
    tx,
    { authSubject, sessionId: "adr38-local-fixture-verification" },
    family.id,
    now,
    { limit: 50 },
  );
  requireFixture(
    page !== null &&
      page.next_cursor === null &&
      page.exchanges.length === 1 &&
      page.exchanges[0]?.id === exchange.id &&
      page.exchanges[0]?.ask === ASK &&
      page.exchanges[0]?.answer?.text === ANSWER &&
      page.exchanges[0]?.replies.length === 1 &&
      page.exchanges[0]?.replies[0]?.text === REPLY,
  );
  return {
    ...receiptProvenance,
    familyId: family.id,
    userId: authSubject,
    created,
    fixtureVerified: true,
    ciphertextVerified: true,
    sourceKeyVerified: true,
    apiDecoded: true,
    noDeliveryRoutesVerified: true,
  };
}

async function clearPrivateState(): Promise<void> {
  cancelInput?.();
  process.stdin.pause();
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // The private Terminal may already be closed.
    }
  }
  privateConnection = undefined;
  savedKey = undefined;
  decodedKey?.fill(0);
  decodedKey = undefined;
  keyCheckChild?.kill("SIGTERM");
  keyCheckChild = undefined;
  await connection?.close().catch(() => {});
  connection = undefined;
}

async function signalExit(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearReceiptProofs();
  await saveReceipt().catch(() => {});
  await Promise.race([
    clearPrivateState(),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  process.exit(code);
}

process.once("SIGINT", () => void signalExit(130));
process.once("SIGTERM", () => void signalExit(143));
process.once("SIGHUP", () => void signalExit(129));

async function main(): Promise<void> {
  await saveReceipt();
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length !== 2) {
    say("Open the synthetic-test preparation launcher in your own Terminal window.");
    process.exitCode = 1;
    return;
  }
  say("Prepare Vela’s separate synthetic family for the traffic test");
  say();
  say("Use a dedicated test sign-in that has never joined or created a real Vela family.");
  say("This adds only artificial test messages. It creates no contacts or message deliveries.");
  say("An existing account is accepted only if it is this exact isolated test fixture.");
  say("Keep the test app and bot unused during preparation.");
  say(
    "Connections and the saved key stay in this private window. No characters appear when pasted.",
  );
  say();
  say("1. Open console.neon.tech → vela-staging → Connect.");
  say("2. Keep the default branch, database neondb, and role neondb_owner.");
  say("3. Turn Connection pooling OFF, click Copy, then paste below and press Return.");
  privateConnection = (await privateInput("Test-system connection (hidden): ")).trim();
  if (!acceptedConnection(privateConnection)) {
    throw new FixtureRefused("connection_not_accepted");
  }
  say();
  say("4. Copy your existing password-manager entry:");
  say("   Vela — test system — content encryption key (CONTENT_KEY_V1)");
  savedKey = (await privateInput("Saved message-protection key (hidden): ")).trim();
  try {
    decodedKey = decodeContentKey(savedKey);
  } catch {
    throw new FixtureRefused("saved_key_not_accepted");
  }
  say();
  say("5. Enter the dedicated Clerk test user's account ID (starts user_).");
  const authSubject = (await privateInput("Dedicated test account ID (hidden): ")).trim();
  if (!/^user_[A-Za-z0-9]{1,120}$/.test(authSubject)) {
    throw new FixtureRefused("account_id_not_accepted");
  }
  receipt = { ...receipt, userId: authSubject };
  await saveReceipt();
  say("Checking that the saved key opens the test system's existing protected messages.");
  if (!(await opensExistingCiphertext(privateConnection, savedKey))) {
    throw new FixtureRefused("source_key_not_verified");
  }
  if (stopping) throw new FixtureRefused("cancelled");
  receipt = { ...receipt, sourceKeyVerified: true };
  await saveReceipt();
  connection = await connectDatabase(privateConnection, savedKey);
  if (stopping) throw new FixtureRefused("cancelled");
  const verifiedReceipt = await connection.db.transaction(
    (tx) => prepareFixture(tx, authSubject, new Date()),
    {
      isolationLevel: "serializable",
    },
  );
  if (stopping) throw new FixtureRefused("cancelled");
  receipt = { ...verifiedReceipt, checkedAt: new Date().toISOString() };
  await saveReceipt();
  say();
  say(
    receipt.created
      ? "The synthetic family is ready."
      : "The existing synthetic family is verified.",
  );
  say(`Synthetic family ID: ${receipt.familyId}`);
  say(
    "The receipt records the test database, IDs, check time, and results only. No messages, connection, or key were saved.",
  );
  say('Tell Codex: "synthetic family ready".');
}

try {
  await main();
} catch (error) {
  clearReceiptProofs();
  await saveReceipt().catch(() => {});
  if (error instanceof FixtureRefused) {
    if (error.message === "connection_not_accepted")
      say("That connection is not Vela's fixed test database.");
    else if (error.message === "saved_key_not_accepted")
      say("The saved key was not accepted. Do not make a new key.");
    else if (error.message === "account_id_not_accepted")
      say("That is not a dedicated Clerk test account ID.");
    else if (error.message === "source_key_not_verified")
      say(
        "The saved key could not be verified against existing test messages. No fixture was inserted.",
      );
    else if (error.message === "cancelled") say("Synthetic-family preparation was cancelled.");
    else
      say(
        "That account or family is not an unchanged isolated test fixture. Engineering must review it.",
      );
  } else {
    say("Synthetic-family preparation could not complete. Engineering must review the setup.");
  }
  say('Tell Codex: "synthetic family preparation stopped". Keep this window private.');
  process.exitCode = 1;
} finally {
  await clearPrivateState();
}
