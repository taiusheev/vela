/** Clipboard line breaks and spaces are not part of Vela's case-sensitive connection code. */
export function connectionCode(value: string): string {
  return value.replace(/\s/g, "");
}
