/**
 * The digest behind every proof services keep (`proofs.ts`): the hash of a consent text a person saw,
 * and the hash that proves a deletion. A family asking what was agreed or deleted compares the stored
 * value with one computed again, so everything that writes one must hash the same way.
 */

/** The SHA-256 of the text, lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
