import { useRef } from "react";

/**
 * One write is one key, so tapping again after a failure finishes the same write rather than making
 * a second one; changing what is being sent starts a new one. `prefix` names the kind of write, so
 * an ask and a reply never share a key.
 */
export function useIdempotencyKey(prefix: string): (body: unknown) => string {
  const run = useRef(Math.random().toString(36).slice(2, 12));
  const sent = useRef<{ body: string; key: string } | null>(null);
  const attempts = useRef(0);
  return (body: unknown) => {
    const serialised = JSON.stringify(body);
    if (sent.current?.body !== serialised) {
      attempts.current += 1;
      sent.current = { body: serialised, key: `${prefix}:${run.current}:${attempts.current}` };
    }
    return sent.current.key;
  };
}
