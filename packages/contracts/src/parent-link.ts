import { z } from "zod";

/** A parent link is private to an organiser; preparing it never sends a message or gives consent. */
export const InviteMessenger = z.enum(["telegram", "line"]);
export type InviteMessenger = z.infer<typeof InviteMessenger>;
/**
 * `messenger` is the organiser switching her invitation to the other messenger before she answers;
 * it is remembered for every later share. Absent, the family's own choice is used.
 */
export const ParentLinkRequest = z.strictObject({ messenger: InviteMessenger.optional() });
export const ApiParentLink = z.object({
  kind: z.enum(["invite", "chat"]),
  /** The messenger the link opens; servers before 11 November 2026 leave it out. */
  messenger: InviteMessenger.optional(),
  url: z.url(),
  text: z.string(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
});
export type ApiParentLink = z.infer<typeof ApiParentLink>;

export const ApiParentConnection = z.strictObject({
  state: z.enum(["waiting", "opened", "connected", "paused", "declined", "unavailable"]),
});
export type ApiParentConnection = z.infer<typeof ApiParentConnection>;
