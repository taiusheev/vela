import {
  type ApiExchangePage,
  type ApiExchangeSummary,
  EXCHANGE_LIST_DAYS,
  EXCHANGE_PAGE_SIZE,
  MAX_EXCHANGE_PAGE_SIZE,
} from "@vela/contracts";
import { exchanges, type Member, members } from "@vela/db";
import { and, desc, eq, gte, isNotNull, lt, ne } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { exchangeRow } from "./api-today.ts";
import type { Queryable } from "./repo.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApiExchangePageQuery {
  /** The id the last page ended on; anything else is ignored rather than trusted. */
  cursor?: string | undefined;
  limit?: number | undefined;
}

function pageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) return EXCHANGE_PAGE_SIZE;
  return Math.min(limit, MAX_EXCHANGE_PAGE_SIZE);
}

/**
 * The Exchanges list (`GET /v1/families/:familyId/exchanges`, API contract §4, spec §14.1 A8):
 * the family's days, newest first, each with the ask, her answer, the replies and the receipt.
 *
 * Only days that happened: an ask still waiting for its morning belongs on Today's tomorrow card,
 * and a withdrawn one belongs nowhere. The list reaches back thirty days and then stops, which is
 * where the family book takes over — and is also where retention clears an exchange's words, so a
 * longer list would be a list of blanks. That floor is applied to every page, not only the first,
 * so a cursor invented by the caller cannot walk past the end the route promises.
 *
 * Paging is on the id, which is uuidv7 and so already in the order the list reads.
 * `scheduled_for` is not: it is nullable, its index is `desc nulls first`, and two exchanges in one
 * family can share a day, so it has no total order to page on.
 */
export async function loadApiExchanges(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  now: Date,
  query: ApiExchangePageQuery = {},
): Promise<ApiExchangePage | null> {
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted") return null;

  const size = pageSize(query.limit);
  const floor = new Date(now.getTime() - EXCHANGE_LIST_DAYS * DAY_MS);
  const after = query.cursor !== undefined && UUID.test(query.cursor) ? query.cursor : null;

  const rows = await db
    .select({ exchange: exchanges, recipient: members })
    .from(exchanges)
    .innerJoin(members, eq(members.id, exchanges.recipientId))
    .where(
      and(
        // The family is in the query itself: membership is not permission to read a nested id.
        eq(exchanges.familyId, familyId),
        ne(exchanges.state, "withdrawn"),
        isNotNull(exchanges.deliveredAt),
        gte(exchanges.deliveredAt, floor),
        ...(after === null ? [] : [lt(exchanges.id, after)]),
      ),
    )
    .orderBy(desc(exchanges.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const summaries: ApiExchangeSummary[] = [];
  for (const row of page) {
    const recipient: Member = row.recipient;
    summaries.push({
      ...(await exchangeRow(db, row.exchange, recipient)),
      scheduled_for: row.exchange.scheduledFor,
      delivered_at: row.exchange.deliveredAt?.toISOString() ?? null,
    });
  }
  return {
    exchanges: summaries,
    next_cursor: rows.length > size ? (page[page.length - 1]?.exchange.id ?? null) : null,
  };
}
