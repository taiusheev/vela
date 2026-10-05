/** Opens one real sealed value without printing the family's words; used by restore drill #2. */
import { Client } from "pg";
import {
  ANSWER_PAYLOAD_SEALING,
  decodeContentKey,
  decodeSealedJsonb,
  EXCHANGE_OPTIONS_SEALING,
  OUTBOUND_PAYLOAD_SEALING,
  openContent,
} from "../src/index.ts";

function required(name: "DATABASE_URL" | "CONTENT_KEY_V1"): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const key = decodeContentKey(required("CONTENT_KEY_V1"));
  const client = new Client({ connectionString: required("DATABASE_URL") });
  try {
    await client.connect();
    const scalarColumns = [
      "answers.transcript",
      "answers.summary",
      "answers.flag_reason",
      "replies.text",
      "exchanges.text",
      "translations.text",
      "suggestions.text",
      "stories.question",
      "stories.transcript",
      "recipes.title",
      "memory_facts.text",
      "reminders.text",
      "weekly_reads.suggestion",
      "weekly_reads.sent_suggestion",
    ] as const;
    for (const qualified of scalarColumns) {
      const [table, column] = qualified.split(".") as [string, string];
      const result = await client.query<{ value: unknown }>(
        `select "${column}" as value from "${table}" where "${column}" is not null and "${column}" <> '' limit 1`,
      );
      const value = result.rows[0]?.value;
      if (typeof value === "string") {
        reportOpenAttempt(() => openContent(value, qualified, key));
        return;
      }
    }

    const arrayCandidates = [
      {
        query:
          "select item.value as value from answers cross join lateral unnest(mood_words) as item(value) where item.value <> '' limit 1",
        column: "answers.mood_words",
      },
      {
        query:
          "select item.value as value from chips cross join lateral unnest(chips) as item(value) where item.value <> '' limit 1",
        column: "chips.chips",
      },
    ] as const;
    for (const candidate of arrayCandidates) {
      const result = await client.query<{ value: unknown }>(candidate.query);
      const value = result.rows[0]?.value;
      if (typeof value === "string") {
        reportOpenAttempt(() => openContent(value, candidate.column, key));
        return;
      }
    }

    const jsonCandidates = [
      {
        query:
          "select payload as value from answers where jsonb_typeof(payload -> 'text') = 'string' or jsonb_typeof(payload -> 'choice') = 'string' limit 1",
        column: "answers.payload",
        policy: ANSWER_PAYLOAD_SEALING,
      },
      {
        query:
          "select payload as value from outbound where jsonb_typeof(payload #> '{message,lang}') = 'string' or jsonb_typeof(payload #> '{message,text}') = 'string' or jsonb_typeof(payload #> '{reply,token}') = 'string' limit 1",
        column: "outbound.payload",
        policy: OUTBOUND_PAYLOAD_SEALING,
      },
      {
        query:
          "select options as value from exchanges where case when jsonb_typeof(options -> 'vote_options') = 'array' then jsonb_path_exists(options -> 'vote_options', '$.** ? (@.type() == \"string\")') else false end or jsonb_typeof(options -> 'caption') = 'string' or jsonb_typeof(options -> 'word') = 'string' or jsonb_typeof(options -> 'word_to_teach') = 'string' limit 1",
        column: "exchanges.options",
        policy: EXCHANGE_OPTIONS_SEALING,
      },
      {
        query:
          "select result as value from api_request_receipts where result is not null and (jsonb_typeof(result -> 'body') = 'string' or jsonb_path_exists(result, '$.body.** ? (@.type() == \"string\")')) limit 1",
        column: "api_request_receipts.result",
        policy: undefined,
      },
      {
        query:
          "select output as value from ai_calls where output is not null and (jsonb_typeof(output) = 'string' or jsonb_path_exists(output, '$.** ? (@.type() == \"string\")')) limit 1",
        column: "ai_calls.output",
        policy: undefined,
      },
      {
        query:
          "select ask_to_check as value from quiet_events where jsonb_path_exists(ask_to_check, '$.** ? (@.type() == \"string\")') limit 1",
        column: "quiet_events.ask_to_check",
        policy: undefined,
      },
      {
        query:
          "select mentions as value from answers where jsonb_path_exists(mentions, '$.** ? (@.type() == \"string\")') limit 1",
        column: "answers.mentions",
        policy: undefined,
      },
      {
        query:
          "select card as value from recipes where jsonb_path_exists(card, '$.** ? (@.type() == \"string\")') limit 1",
        column: "recipes.card",
        policy: undefined,
      },
      {
        query:
          "select lines as value from weekly_reads where jsonb_path_exists(lines, '$.** ? (@.type() == \"string\")') limit 1",
        column: "weekly_reads.lines",
        policy: undefined,
      },
      {
        query:
          "select stats as value from weekly_reads where jsonb_path_exists(stats, '$.** ? (@.type() == \"string\")') limit 1",
        column: "weekly_reads.stats",
        policy: undefined,
      },
      {
        query:
          "select sent_lines as value from weekly_reads where sent_lines is not null and jsonb_path_exists(sent_lines, '$.** ? (@.type() == \"string\")') limit 1",
        column: "weekly_reads.sent_lines",
        policy: undefined,
      },
    ] as const;
    for (const candidate of jsonCandidates) {
      const result = await client.query<{ value: unknown }>(candidate.query);
      const value = result.rows[0]?.value;
      if (value !== undefined) {
        reportOpenAttempt(() => decodeSealedJsonb(value, candidate.column, candidate.policy, key));
        return;
      }
    }
    console.log("no sealed value available");
    process.exitCode = 1;
  } catch {
    // Connection and query errors are not evidence that the saved key is wrong. Keep provider
    // diagnostics (which can contain connection details) out of the terminal output.
    console.log("restore check could not read the restored branch");
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => {});
  }
}

function reportOpenAttempt(open: () => unknown): void {
  try {
    open();
    console.log("opens");
  } catch {
    console.log("does not open");
    process.exitCode = 1;
  }
}

await main();
