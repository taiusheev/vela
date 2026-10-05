/**
 * Re-seals pre-codec development or synthetic staging rows in one transaction before deploying
 * ADR-38's Drizzle codecs. Development may use an ignored local environment file; remote inputs
 * arrive through the setup child's private environment and are never saved locally.
 * Remote runs also require the caller's explicit VELA_DATABASE_ENVIRONMENT.
 */
import { Client } from "pg";
import {
  ANSWER_PAYLOAD_SEALING,
  decodeContentKey,
  EXCHANGE_OPTIONS_SEALING,
  isV1ContentEnvelope,
  type JsonSealingPolicy,
  OUTBOUND_PAYLOAD_SEALING,
  openContent,
  resealJsonb,
  sealContent,
} from "../src/index.ts";
import { validatedMutationConnectionString } from "../src/mutation-target.ts";

type FieldSpec = {
  readonly table: string;
  readonly keys: readonly string[];
  readonly column: string;
  readonly kind: "text" | "text[]" | "jsonb";
  readonly policy?: JsonSealingPolicy;
};

const fields: readonly FieldSpec[] = [
  { table: "answers", keys: ["id"], column: "transcript", kind: "text" },
  {
    table: "answers",
    keys: ["id"],
    column: "payload",
    kind: "jsonb",
    policy: ANSWER_PAYLOAD_SEALING,
  },
  { table: "answers", keys: ["id"], column: "summary", kind: "text" },
  { table: "answers", keys: ["id"], column: "flag_reason", kind: "text" },
  { table: "answers", keys: ["id"], column: "mentions", kind: "jsonb" },
  { table: "answers", keys: ["id"], column: "mood_words", kind: "text[]" },
  { table: "replies", keys: ["id"], column: "text", kind: "text" },
  { table: "exchanges", keys: ["id"], column: "text", kind: "text" },
  {
    table: "exchanges",
    keys: ["id"],
    column: "options",
    kind: "jsonb",
    policy: EXCHANGE_OPTIONS_SEALING,
  },
  { table: "chips", keys: ["exchange_id"], column: "chips", kind: "text[]" },
  { table: "suggestions", keys: ["id"], column: "text", kind: "text" },
  {
    table: "translations",
    keys: ["object_type", "object_id", "lang"],
    column: "text",
    kind: "text",
  },
  { table: "stories", keys: ["id"], column: "question", kind: "text" },
  { table: "stories", keys: ["id"], column: "transcript", kind: "text" },
  { table: "recipes", keys: ["id"], column: "title", kind: "text" },
  { table: "recipes", keys: ["id"], column: "card", kind: "jsonb" },
  { table: "memory_facts", keys: ["id"], column: "text", kind: "text" },
  { table: "reminders", keys: ["id"], column: "text", kind: "text" },
  { table: "quiet_events", keys: ["id"], column: "ask_to_check", kind: "jsonb" },
  { table: "weekly_reads", keys: ["id"], column: "lines", kind: "jsonb" },
  { table: "weekly_reads", keys: ["id"], column: "suggestion", kind: "text" },
  { table: "weekly_reads", keys: ["id"], column: "stats", kind: "jsonb" },
  { table: "weekly_reads", keys: ["id"], column: "sent_lines", kind: "jsonb" },
  { table: "weekly_reads", keys: ["id"], column: "sent_suggestion", kind: "text" },
  { table: "ai_calls", keys: ["id"], column: "output", kind: "jsonb" },
  {
    table: "outbound",
    keys: ["id"],
    column: "payload",
    kind: "jsonb",
    policy: OUTBOUND_PAYLOAD_SEALING,
  },
  { table: "api_request_receipts", keys: ["id"], column: "result", kind: "jsonb" },
];

function required(name: "DATABASE_URL" | "CONTENT_KEY_V1"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required; see infra/README.md, section 9a`);
  }
  return value;
}

function sealText(value: unknown, column: string, key: Uint8Array): string {
  if (typeof value !== "string") {
    throw new Error(`Expected text at ${column}`);
  }
  if (value.length === 0) return value;
  if (value.startsWith("v1.")) {
    if (!isV1ContentEnvelope(value)) {
      throw new Error(`Malformed v1 envelope at ${column}`);
    }
    openContent(value, column, key);
    return value;
  }
  return sealContent(value, column, key);
}

function sealArray(value: unknown, column: string, key: Uint8Array): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected a text array at ${column}`);
  }
  return value.map((entry) => sealText(entry, column, key));
}

function quote(identifier: string): string {
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  const connectionString = validatedMutationConnectionString(
    required("DATABASE_URL"),
    process.env.VELA_DATABASE_ENVIRONMENT,
    process.env.PGOPTIONS,
  );
  const key = decodeContentKey(required("CONTENT_KEY_V1"));
  const client = new Client({ connectionString });
  await client.connect();
  const counts: string[] = [];
  try {
    await client.query("begin");
    const tables = [...new Set(fields.map((field) => field.table))].sort();
    for (const table of tables) {
      await client.query(`lock table ${quote(table)} in share row exclusive mode`);
    }
    for (const field of fields) {
      const columns = [
        ...field.keys.map((keyColumn) => `${quote(keyColumn)} as ${quote(`key_${keyColumn}`)}`),
        `${quote(field.column)} as value`,
      ];
      const selected = await client.query<Record<string, unknown>>(
        `select ${columns.join(", ")} from ${quote(field.table)} where ${quote(field.column)} is not null`,
      );
      let changed = 0;
      for (const row of selected.rows) {
        const keyValues = field.keys.map((keyColumn) => row[`key_${keyColumn}`]);
        let value: unknown;
        if (field.kind === "text") {
          value = sealText(row.value, `${field.table}.${field.column}`, key);
        } else if (field.kind === "text[]") {
          value = sealArray(row.value, `${field.table}.${field.column}`, key);
        } else {
          value = resealJsonb(row.value, `${field.table}.${field.column}`, field.policy, key);
        }
        const setCast =
          field.kind === "jsonb" ? "::jsonb" : field.kind === "text[]" ? "::text[]" : "";
        const conditions = field.keys
          .map((keyColumn, index) => `${quote(keyColumn)} = $${index + 2}`)
          .join(" and ");
        await client.query(
          `update ${quote(field.table)} set ${quote(field.column)} = $1${setCast} where ${conditions}`,
          [value, ...keyValues],
        );
        changed += 1;
      }
      counts.push(`${field.table}.${field.column}: ${changed}`);
    }
    await client.query("commit");
    for (const count of counts) console.log(count);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

await main();
