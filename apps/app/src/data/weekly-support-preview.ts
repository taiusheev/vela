/** Fixed synthetic week. No real sources, consent, storage, transport or background work. */
import { t } from "@lingui/core/macro";
import {
  buildWeeklySupportDraft,
  WEEKLY_SUPPORT_REVIEW_VERSION,
  type WeeklySupportContext,
  type WeeklySupportKind,
  type WeeklySupportSource,
} from "@vela/core/weekly-support";

export function weeklySupportPreview(options: {
  withdrawn: boolean;
  removed: boolean;
  corrected: boolean;
}) {
  const context: WeeklySupportContext = {
    enabled: true,
    familyId: "example-family",
    memberId: "example-parent",
    viewerId: "example-child",
    activeMemberIds: ["example-parent", "example-child"],
    organiserIds: ["example-child"],
    permission: {
      version: WEEKLY_SUPPORT_REVIEW_VERSION,
      givenAt: new Date("2026-10-19T00:00Z"),
      withdrawnAt: options.withdrawn ? new Date("2026-10-25T12:00Z") : null,
    },
    now: new Date("2026-10-25T18:00Z"),
    weekFrom: new Date("2026-10-19T00:00Z"),
    weekUntil: new Date("2026-10-26T00:00Z"),
  };
  const examples: { kind: WeeklySupportKind; text: string; date: string }[] = [
    {
      kind: "shared_interest",
      text: t`The yellow flowers opened today. I wanted to show you.`,
      date: "2026-10-20T08:00Z",
    },
    {
      kind: "company",
      text: t`I'd like you to come to the market with me next Saturday.`,
      date: "2026-10-25T08:00Z",
    },
    {
      kind: "practical_help",
      text: t`Could someone help carry my groceries home next Friday?`,
      date: "2026-10-23T08:00Z",
    },
  ];
  examples.sort(
    (a, b) => Number(b.kind === "practical_help") - Number(a.kind === "practical_help"),
  );
  const sources: WeeklySupportSource[] = examples.map((example) => ({
    id: `example-${example.kind}`,
    familyId: context.familyId,
    memberId: context.memberId,
    revision: options.corrected && example.kind === "company" ? 2 : 1,
    text: example.text,
    occurredAt: new Date(example.date),
    expiresAt: new Date("2026-11-19T00:00Z"),
    deleted: options.removed && example.kind === "practical_help",
    sensitivity: "ordinary",
    readerIds: [context.memberId, context.viewerId],
  }));
  const suggestions = buildWeeklySupportDraft(
    context,
    sources,
    examples.map((example) => ({
      sourceId: `example-${example.kind}`,
      sourceRevision: 1,
      start: 0,
      end: example.text.length,
      kind: example.kind,
      reviewerId: "example-child",
      reviewedAt: new Date("2026-10-25T12:00Z"),
      validUntil: new Date("2026-11-01T00:00Z"),
    })),
  );
  return { suggestions };
}
