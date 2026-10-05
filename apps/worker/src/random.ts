import type { Random } from "@vela/services";

const BASE64URL_UNSAFE = /[+/=]/g;
const BASE64URL_REPLACEMENTS: Record<string, string> = { "+": "-", "/": "_", "=": "" };

/**
 * Invite tokens: the platform's CSPRNG, base64url so the token survives a Telegram deep link. In a
 * module of its own, with nothing from the Workers runtime, so a Node script such as the local API
 * server can make tokens the same way the Workers do.
 */
export function createRandom(): Random {
  return {
    token(bytes = 32) {
      const buffer = new Uint8Array(bytes);
      crypto.getRandomValues(buffer);
      let binary = "";
      for (const byte of buffer) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary).replace(BASE64URL_UNSAFE, (char) => BASE64URL_REPLACEMENTS[char] ?? "");
    },
  };
}
