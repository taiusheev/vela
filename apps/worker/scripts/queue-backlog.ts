import { SetupError } from "./telegram-webhook.ts";

const NEXT_ACTION =
  "Setup must not rewrite saved messages yet. Keep the test app and bot unused, and report the seal step to engineering.";

function cannotVerify(): SetupError {
  return new SetupError(
    `Could not confirm that Vela's background jobs have finished. ${NEXT_ACTION}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Refuse the rewrite unless every required queue reports no waiting background jobs.
 * Callbacks supply Cloudflare's unwrapped result values, never message bodies.
 */
export async function assertQueueBacklogsEmpty(
  queueNames: readonly string[],
  listQueues: () => Promise<unknown[]>,
  readMetrics: (queueId: string) => Promise<unknown>,
): Promise<void> {
  if (queueNames.length === 0) {
    throw cannotVerify();
  }
  let inventory: unknown;
  try {
    inventory = await listQueues();
  } catch {
    throw cannotVerify();
  }
  if (!Array.isArray(inventory)) {
    throw cannotVerify();
  }

  const queueIds: string[] = [];
  for (const name of new Set(queueNames)) {
    if (name.trim() === "") {
      throw cannotVerify();
    }
    const matches = inventory.filter((queue) => isRecord(queue) && queue.queue_name === name);
    if (matches.length !== 1) {
      throw cannotVerify();
    }
    const queue = matches[0];
    const queueId = isRecord(queue) ? queue.queue_id : undefined;
    if (typeof queueId !== "string" || queueId.trim() === "") {
      throw cannotVerify();
    }
    queueIds.push(queueId);
  }

  for (const queueId of queueIds) {
    let metrics: unknown;
    try {
      metrics = await readMetrics(queueId);
    } catch {
      throw cannotVerify();
    }
    const backlog = isRecord(metrics) ? metrics.backlog_count : undefined;
    if (
      typeof backlog !== "number" ||
      !Number.isFinite(backlog) ||
      !Number.isInteger(backlog) ||
      backlog < 0
    ) {
      throw cannotVerify();
    }
    if (backlog > 0) {
      throw new SetupError(`Vela still has background jobs waiting to finish. ${NEXT_ACTION}`);
    }
  }
}
