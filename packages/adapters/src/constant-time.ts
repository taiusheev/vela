/**
 * The one constant-time comparison the channels share, so every webhook check trusts the same
 * implementation.
 */

const encoder = new TextEncoder();

/**
 * Compares two strings in time that depends only on the length of `expected`. There is no early
 * return on a length mismatch or on the first differing byte: every byte of `expected` is visited,
 * and a length difference is folded into the same accumulator as the byte differences.
 */
export function constantTimeEqual(received: string, expected: string): boolean {
  const receivedBytes = encoder.encode(received);
  const expectedBytes = encoder.encode(expected);
  let difference = receivedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (receivedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  // An empty configured secret would accept an empty header; treat it as matching nothing.
  return difference === 0 && expectedBytes.length > 0;
}
