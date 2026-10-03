/**
 * Recipe cards (spec §10, ADR-41). Her answers to a recipe ask are written down by the model as one
 * card (`ai.recipe`): ingredients, steps and her tips, in her own words. She is shown the card with
 * "Keep it" and "Not this one". A card she keeps goes into the family book and stays until the family
 * leaves; one she does not want is deleted at once, and a card she never answers is deleted with
 * the 30 days of the words it came from. Only where the family book is on (`BOOK`).
 */
import type { RecipeCard } from "@vela/ai";
import type { Channel, InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { encodeButton, outboundKey } from "@vela/core";
import { type Exchange, exchanges, type Member, members, recipes } from "@vela/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { fitMessageText } from "./format.ts";
import { type InsertResult, insertOutbound } from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import { channelLinkOfMember, memberByChannelUser, type Queryable } from "./repo.ts";

/** A card the model could write: a title and at least one step. Anything less offers nothing. */
export function isCard(card: RecipeCard): boolean {
  return card.title.trim().length > 0 && card.steps.length > 0;
}

/** The card as she reads it, in her language, under short headings. */
export function renderCard(card: RecipeCard, lang: Member["language"]): string {
  const block = (key: "recipe.ingredients" | "recipe.steps" | "recipe.remarks", lines: string[]) =>
    lines.length === 0 ? [] : [[t(lang, key), ...lines.map((line) => `• ${line}`)].join("\n")];
  return [
    ...block("recipe.ingredients", card.ingredients),
    ...block("recipe.steps", card.steps),
    ...block("recipe.remarks", card.remarks),
  ].join("\n\n");
}

/**
 * Writes her card for a recipe exchange and offers it to her: one card per exchange, made by her
 * first answer and rewritten by later ones while it is a draft, under the exchange's row lock so two
 * answers understood at once make one card. A kept card is not rewritten. The offer is keyed by the
 * card's content, so the same card is offered once and a changed one again. Returns the rows to hand
 * to the delivery queue after the commit.
 */
export async function offerRecipe(
  deps: Deps,
  input: { exchange: Exchange; member: Member; answerChannel: Channel },
  card: RecipeCard,
): Promise<InsertResult[]> {
  if (!deps.config.book || !isCard(card)) return [];
  const { exchange, member } = input;
  const link = await channelLinkOfMember(deps.db, member.id, input.answerChannel);
  const lang = member.language;
  const fingerprint = (await sha256Hex(JSON.stringify(card))).slice(0, 16);
  return deps.db.transaction(async (tx) => {
    await tx
      .select({ id: exchanges.id })
      .from(exchanges)
      .where(eq(exchanges.id, exchange.id))
      .for("update");
    const [existing] = await tx
      .select()
      .from(recipes)
      .where(
        and(
          eq(recipes.familyId, exchange.familyId),
          sql`${recipes.exchangeIds} @> array[${exchange.id}]::uuid[]`,
        ),
      )
      .limit(1);
    if (existing?.status === "confirmed") return [];
    const fields = {
      title: card.title,
      card: { ingredients: card.ingredients, steps: card.steps, remarks: card.remarks },
    };
    const recipe =
      existing === undefined
        ? (
            await tx
              .insert(recipes)
              .values({
                familyId: exchange.familyId,
                memberId: member.id,
                exchangeIds: [exchange.id],
                status: "draft",
                ...fields,
              })
              .returning()
          )[0]
        : (await tx.update(recipes).set(fields).where(eq(recipes.id, existing.id)).returning())[0];
    if (recipe === undefined) throw new Error("recipe vanished under its exchange's lock");
    if (link === null || link.blockedAt !== null) return [];
    const offer = await insertOutbound(deps, tx, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: link.externalId,
        suffix: `recipe:${recipe.id}:${fingerprint}`,
      }),
      memberId: member.id,
      channel: link.channel,
      conversationId: link.externalId,
      exchangeId: exchange.id,
      lang,
      text: fitMessageText(
        t(lang, "recipe.offer", {
          address: member.addressForm ?? member.displayName,
          title: card.title,
          card: renderCard(card, lang),
        }),
      ),
      buttons: [
        [
          {
            id: encodeButton({ type: "recipe_keep", recipeId: recipe.id, keep: true }),
            label: t(lang, "recipe.keep"),
          },
          {
            id: encodeButton({ type: "recipe_keep", recipeId: recipe.id, keep: false }),
            label: t(lang, "recipe.not_this"),
          },
        ],
      ],
    });
    return [offer];
  });
}

/**
 * Her "Keep it" or "Not this one" (spec §10): only the one whose recipe it is, from her own chat.
 * Keeping confirms the card; not keeping deletes it at once. She is told which.
 */
export async function handleRecipeKeepButton(
  deps: Deps,
  event: InboundEvent,
  action: { recipeId: string; keep: boolean },
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (sender === null || event.conversation.kind !== "private") {
    deps.logger.warn("recipe_keep_ignored", { known: sender !== null });
    return;
  }
  const done = await deps.db.transaction(async (tx) => {
    const [recipe] = await tx
      .select()
      .from(recipes)
      .where(eq(recipes.id, action.recipeId))
      .for("update")
      .limit(1);
    if (recipe === undefined || recipe.memberId !== sender.member.id) return null;
    if (action.keep) {
      await tx.update(recipes).set({ status: "confirmed" }).where(eq(recipes.id, recipe.id));
    } else {
      await tx.delete(recipes).where(eq(recipes.id, recipe.id));
    }
    return recipe;
  });
  if (event.messageId !== undefined) {
    await adapter.closeButtons(event.conversation.externalId, event.messageId);
  }
  if (done !== null) {
    const lang = sender.member.language;
    try {
      await adapter.send({
        kind: "system",
        idempotencyKey: outboundKey("system", {
          conversationId: event.conversation.externalId,
          suffix: `recipe_keep:${done.id}:${action.keep ? "k" : "n"}`,
        }),
        lang,
        to: { channel: event.channel, conversationId: event.conversation.externalId },
        text: action.keep
          ? t(lang, "recipe.kept", { title: done.title })
          : t(lang, "recipe.dropped"),
      });
    } catch (error) {
      deps.logger.warn("recipe_keep_reply_failed", { error: errorLabel(error) });
    }
  }
  deps.logger.info("recipe_keep", { kept: done !== null && action.keep, found: done !== null });
}

/** One kept recipe, as the family book shows it. */
export interface ApiBookRecipe {
  id: string;
  member_id: string;
  member_name: string;
  title: string;
  ingredients: string[];
  steps: string[];
  remarks: string[];
  kept_at: string;
}

/** The family's kept recipes, newest first, for the book. */
export async function keptRecipes(db: Queryable, familyId: string): Promise<ApiBookRecipe[]> {
  const rows = await db
    .select({ recipe: recipes, her: members })
    .from(recipes)
    .innerJoin(members, eq(members.id, recipes.memberId))
    .where(and(eq(recipes.familyId, familyId), eq(recipes.status, "confirmed")))
    .orderBy(asc(recipes.createdAt));
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return rows.reverse().map(({ recipe, her }) => {
    const card = recipe.card as { ingredients?: unknown; steps?: unknown; remarks?: unknown };
    return {
      id: recipe.id,
      member_id: her.id,
      member_name: her.displayName,
      title: recipe.title,
      ingredients: list(card.ingredients),
      steps: list(card.steps),
      remarks: list(card.remarks),
      kept_at: recipe.createdAt.toISOString(),
    };
  });
}
