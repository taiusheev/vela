/** An optional direct-dial number, never sent to Vela's server or copied from phone contacts. */
export function callingNumber(input: string): string | null {
  const normal = input.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normal) ? normal : null;
}
