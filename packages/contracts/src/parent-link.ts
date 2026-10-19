import { z } from "zod";

/** A parent link is private to an organiser; preparing it never sends a message or gives consent. */
export const ParentLinkRequest = z.strictObject({});
export const ApiParentLink = z.object({
  kind: z.enum(["invite", "chat"]),
  url: z.url(),
  text: z.string(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
});
export type ApiParentLink = z.infer<typeof ApiParentLink>;

export const ApiParentConnection = z.strictObject({
  state: z.enum(["waiting", "opened", "connected", "paused", "declined", "unavailable"]),
});
export type ApiParentConnection = z.infer<typeof ApiParentConnection>;
