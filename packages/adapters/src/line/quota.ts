import type { ChannelQuota } from "@vela/contracts";
import type { LineClient } from "./client.ts";

/**
 * This month's allowance and use (05 §5.8). A plan without a limit reads as `null`. LINE calls the
 * use approximate, and it includes what was sent from LINE Official Account Manager.
 */
export async function readLineQuota(client: LineClient, now: () => Date): Promise<ChannelQuota> {
  const quota = await client.quota();
  const used = await client.quotaConsumption();
  return {
    limit: quota.type === "limited" ? quota.value : null,
    used,
    readAt: now().toISOString(),
  };
}
