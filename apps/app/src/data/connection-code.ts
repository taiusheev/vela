/**
 * Vela's connection code from whatever was pasted. Telegram's Copy takes the bot's whole message
 * ("Enter this code in Vela to connect your Telegram account: <code> Keep it private…"), so when
 * the paste holds exactly one run of 22 code characters, that run is the code (founder, 18 October
 * 2026: "I cannot tap the button"). Otherwise clipboard line breaks and spaces are removed, since
 * they are not part of the case-sensitive code; a longer run is never cut down to a valid-looking one.
 */
export function connectionCode(value: string): string {
  const runs = value.split(/[^A-Za-z0-9_-]+/).filter((run) => run.length === 22);
  if (runs.length === 1 && runs[0] !== undefined) return runs[0];
  return value.replace(/\s/g, "");
}
