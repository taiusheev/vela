/**
 * The digest that proves a deletion (flows §3.15): `deletions.content_hash` is written by the
 * retention job and by the admin actions, and a family asking what was deleted compares the two, so
 * both must hash the same way. One implementation, so a later edit cannot move only one of them.
 */

/** The SHA-256 of the text, lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
