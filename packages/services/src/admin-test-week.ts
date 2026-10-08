/**
 * The test week as a checklist (launch gate 1, `plan/staging-test-script.md`): for one family,
 * which steps of the loop have happened at least once, when first, and how often, read from the
 * append-only events and a few metadata columns. Founder-only and audited like the trial counts;
 * no content, names, conversation ids or provider errors are selected. A step that happened is
 * evidence it can happen, not that it always works: failures are listed beside it.
 */
import type { EventName } from "@vela/contracts";
import { consents, events, exchanges, families, members } from "@vela/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type AdminContext, recordAdminView } from "./admin.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";

export type TestWeekGroup = "setup" | "loop" | "light" | "control";

export interface TestWeekStep {
  readonly key: string;
  readonly group: TestWeekGroup;
  readonly label: string;
  /** What to do to make it happen, for a step not seen yet. */
  readonly how: string;
  /** Part of launch gate 1's "done when". */
  readonly required: boolean;
  readonly count: number;
  readonly firstAt: Date | null;
}

export interface TestWeekReport {
  readonly familyId: string;
  readonly generatedAt: Date;
  readonly steps: readonly TestWeekStep[];
  /** Distinct parent-local days whose scheduled arrival was delivered; the script asks for seven. */
  readonly deliveredMornings: number;
  readonly problems: {
    readonly arrivalFailures: number;
    readonly droppedSends: number;
    readonly missedTicks: number;
  };
}

interface StepSpec {
  readonly key: string;
  readonly group: TestWeekGroup;
  readonly label: string;
  readonly how: string;
  readonly required: boolean;
  readonly event: EventName;
  /** Only events on this surface, or on any surface but this one (`!app`). */
  readonly surface?: string;
}

const STEPS: readonly StepSpec[] = [
  {
    key: "linked",
    group: "setup",
    label: "An organiser connected the app",
    how: "In the app: Connect existing family, then paste the code from Telegram.",
    required: false,
    event: "account_linked",
  },
  {
    key: "consent",
    group: "setup",
    label: "The parent said Yes",
    how: "Send the parent's invite and tap Yes in her chat.",
    required: true,
    event: "consent_given",
  },
  {
    key: "arrival",
    group: "loop",
    label: "A morning's ask arrived",
    how: "Write an ask in the app for tomorrow, or let the fallback arrive at her time.",
    required: true,
    event: "arrival_delivered",
  },
  {
    key: "answer",
    group: "loop",
    label: "The parent answered",
    how: "Answer in her chat: a tap, a word, a photo or a voice note.",
    required: true,
    event: "answer_recorded",
  },
  {
    key: "reply_app",
    group: "loop",
    label: "A reply from the app",
    how: "Open the exchange in the app and reply.",
    required: false,
    event: "reply_posted",
    surface: "app",
  },
  {
    key: "reply_group",
    group: "loop",
    label: "A reply from the family group",
    how: "Reply to her answer in the Telegram or LINE family group.",
    required: false,
    event: "reply_posted",
    surface: "!app",
  },
  {
    key: "readback",
    group: "loop",
    label: "Replies read back to her the next morning",
    how: "After a reply, wait for her next morning's arrival.",
    required: true,
    event: "readback_delivered",
  },
  {
    key: "quiet",
    group: "light",
    label: "A quiet notice went out",
    how: "Leave one morning unanswered past the quiet time.",
    required: true,
    event: "quiet_notice_sent",
  },
  {
    key: "quiet_resolved",
    group: "light",
    label: "A quiet notice was resolved",
    how: "Answer late, or tap She's fine on the notice.",
    required: false,
    event: "quiet_notice_resolved",
  },
  {
    key: "flag",
    group: "light",
    label: "A flag was raised",
    how: "With AI on, answer with a clear fall (synthetic words only).",
    required: false,
    event: "flag_raised",
  },
  {
    key: "away",
    group: "light",
    label: "Away was set",
    how: "Set Away in the app, or say she is away in her chat.",
    required: false,
    event: "away_set",
  },
  {
    key: "stop",
    group: "control",
    label: "She said stop",
    how: "Send stop in her chat.",
    required: true,
    event: "stop_said",
  },
  {
    key: "start",
    group: "control",
    label: "She started again",
    how: "Send start in her chat after stop.",
    required: true,
    event: "start_said",
  },
  {
    key: "weekly_drafted",
    group: "control",
    label: "A weekly read was drafted",
    how: "Wait for the end of a week with answers.",
    required: false,
    event: "weekly_read_drafted",
  },
  {
    key: "weekly_sent",
    group: "control",
    label: "A weekly read was sent",
    how: "Review the draft on the family page and send it.",
    required: true,
    event: "weekly_read_sent",
  },
];

function surfaceFilter(surface: string | undefined) {
  if (surface === undefined) return undefined;
  return surface.startsWith("!")
    ? sql`coalesce(${events.surface}, '') <> ${surface.slice(1)}`
    : eq(events.surface, surface);
}

export async function loadAdminTestWeek(
  deps: Deps,
  ctx: AdminContext,
  familyId: string,
): Promise<TestWeekReport | null> {
  if (
    !z.uuid().safeParse(familyId).success ||
    (ctx.familyId !== undefined && ctx.familyId !== familyId)
  ) {
    throw new VelaError("invalid_payload", "Invalid test week scope");
  }
  const [family] = await deps.db
    .select({ id: families.id })
    .from(families)
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)));
  if (family === undefined) return null;
  await recordAdminView(deps, ctx, {
    familyIds: [familyId],
    memberId: null,
    what: `/admin/families/${familyId}/test-week`,
  });

  const steps: TestWeekStep[] = [];
  for (const spec of STEPS) {
    const [row] = await deps.db
      .select({ count: sql<number>`count(*)::int`, firstAt: sql<Date | null>`min(${events.at})` })
      .from(events)
      .where(
        and(
          eq(events.familyId, familyId),
          eq(events.name, spec.event),
          surfaceFilter(spec.surface),
        ),
      );
    const firstAt = row?.firstAt ?? null;
    steps.push({
      key: spec.key,
      group: spec.group,
      label: spec.label,
      how: spec.how,
      required: spec.required,
      count: row?.count ?? 0,
      firstAt: firstAt === null ? null : new Date(firstAt),
    });
  }

  // Her separate health-words choice, either answer, is its own consent row (no event names it).
  const [health] = await deps.db
    .select({
      count: sql<number>`count(*)::int`,
      firstAt: sql<Date | null>`min(${consents.givenAt})`,
    })
    .from(consents)
    .innerJoin(members, eq(members.id, consents.memberId))
    .where(and(eq(members.familyId, familyId), eq(consents.kind, "health_words")));
  steps.splice(2, 0, {
    key: "health_words",
    group: "setup",
    label: "Her health-words choice was recorded",
    how: "After Yes, answer the separate health-words question in her chat.",
    required: false,
    count: health?.count ?? 0,
    firstAt: health?.firstAt == null ? null : new Date(health.firstAt),
  });

  const [mornings] = await deps.db
    .select({
      days: sql<number>`count(distinct (${exchanges.recipientId}, ${exchanges.scheduledFor}))::int`,
    })
    .from(exchanges)
    .where(and(eq(exchanges.familyId, familyId), isNotNull(exchanges.deliveredAt)));

  const countOf = async (name: EventName) => {
    const [row] = await deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(and(eq(events.familyId, familyId), eq(events.name, name)));
    return row?.count ?? 0;
  };

  return {
    familyId,
    generatedAt: deps.clock.now(),
    steps,
    deliveredMornings: mornings?.days ?? 0,
    problems: {
      arrivalFailures: await countOf("arrival_delivery_failed"),
      droppedSends: await countOf("gateway_dropped"),
      missedTicks: await countOf("scheduler_missed"),
    },
  };
}
