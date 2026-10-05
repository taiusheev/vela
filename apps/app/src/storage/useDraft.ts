import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../auth/clerk.tsx";
import { sessionScope } from "../data/live-state.ts";
import { clearDraft, type PrivateDraft, readDraft, saveDraft } from "./drafts.ts";

/** A native encrypted text draft, manually retried with the same write identity. */
export function useDraft(name: string, initial = "") {
  const account = useAccount();
  const scope = sessionScope(account);
  const [text, setText] = useState(initial);
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const value = useRef<PrivateDraft>({ text: initial });
  useEffect(() => {
    let current = true;
    setReady(false);
    setText(initial);
    void readDraft(scope, name).then((draft) => {
      if (!current) return;
      value.current = draft ?? { text: initial };
      setText(value.current.text);
      setReady(true);
    });
    return () => {
      current = false;
    };
  }, [scope, name, initial]);
  const changeText = useCallback(
    (next: string) => {
      setText(next);
      value.current = { ...value.current, text: next };
      void saveDraft(scope, name, value.current)
        .then(() => setSaveFailed(false))
        .catch(() => setSaveFailed(true));
    },
    [scope, name],
  );
  return {
    text,
    ready,
    saveFailed,
    savedBody: <T>(): T | null => {
      try {
        return value.current.attempt === undefined
          ? null
          : (JSON.parse(value.current.attempt.body) as T);
      } catch {
        return null;
      }
    },
    setText: changeText,
    keyFor: async (body: unknown) => {
      const serialised = JSON.stringify(body);
      if (value.current.attempt?.body !== serialised) {
        value.current = {
          ...value.current,
          attempt: {
            body: serialised,
            key: `${name}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`,
          },
        };
      }
      const attempt = value.current.attempt;
      if (attempt === undefined) throw new Error("No write identity");
      await saveDraft(scope, name, value.current);
      return attempt.key;
    },
    clearAttempt: async () => {
      value.current = { text: value.current.text };
      await saveDraft(scope, name, value.current);
    },
    clear: async () => {
      value.current = { text: "" };
      setText("");
      await clearDraft(scope, name);
    },
  };
}
