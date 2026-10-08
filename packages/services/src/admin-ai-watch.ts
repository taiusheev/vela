/** Content-free AI telemetry for the protected overview. UTC calendar days, never prompts/outputs. */
import { aiCalls } from "@vela/db";
import { and, gte, lte, sql } from "drizzle-orm";
import type { Deps } from "./deps.ts";

export interface AiWatchCounts {
  calls: number;
  failures: number;
  knownCostUsd: number;
  costRecorded: number;
  latencyRecorded: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
}
export interface AdminAiWatch {
  asOf: Date;
  days: (AiWatchCounts & { day: string })[];
  byCall: (AiWatchCounts & { call: string })[];
}
const DAY_MS = 86_400_000;

/** Only known call categories are returned; even an unexpected database value cannot carry text. */
const category = sql<string>`case when ${aiCalls.call} in
  ('understand','flag','chips','translate','suggest','readback','hello','weekly_read','recipe','transcribe')
  then ${aiCalls.call} else 'other' end`;
const counts = {
  calls: sql<number>`count(*)::int`,
  failures: sql<number>`count(*) filter (where not ${aiCalls.ok})::int`,
  knownCostUsd: sql<number>`coalesce(sum(${aiCalls.costUsd}) filter (where ${aiCalls.costUsd} >= 0),0)::float8`,
  costRecorded: sql<number>`count(*) filter (where ${aiCalls.costUsd} >= 0)::int`,
  latencyRecorded: sql<number>`count(*) filter (where ${aiCalls.latencyMs} >= 0)::int`,
  averageLatencyMs: sql<
    number | null
  >`avg(${aiCalls.latencyMs}) filter (where ${aiCalls.latencyMs} >= 0)::float8`,
  p95LatencyMs: sql<
    number | null
  >`percentile_cont(0.95) within group (order by ${aiCalls.latencyMs}) filter (where ${aiCalls.latencyMs} >= 0)::float8`,
};
const empty: AiWatchCounts = {
  calls: 0,
  failures: 0,
  knownCostUsd: 0,
  costRecorded: 0,
  latencyRecorded: 0,
  averageLatencyMs: null,
  p95LatencyMs: null,
};

export async function loadAdminAiWatch(deps: Pick<Deps, "db" | "clock">): Promise<AdminAiWatch> {
  const asOf = deps.clock.now();
  const today = new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const first = new Date(today.getTime() - 6 * DAY_MS);
  const day = sql<string>`to_char(${aiCalls.at} at time zone 'UTC', 'YYYY-MM-DD')`;
  const daily = await deps.db
    .select({ day, ...counts })
    .from(aiCalls)
    .where(and(gte(aiCalls.at, first), lte(aiCalls.at, asOf)))
    .groupBy(day);
  const byCall = await deps.db
    .select({ call: category, ...counts })
    .from(aiCalls)
    .where(and(gte(aiCalls.at, today), lte(aiCalls.at, asOf)))
    .groupBy(category)
    .orderBy(category);
  return {
    asOf,
    days: Array.from({ length: 7 }, (_, i) => {
      const key = new Date(first.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      return daily.find((row) => row.day === key) ?? { day: key, ...empty };
    }).reverse(),
    byCall,
  };
}
