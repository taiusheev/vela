import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError, apiConfigured, openWeeklyRead } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";

interface Opening {
  actorId: string;
  readId: string;
  key: string;
  visit: number;
  inFlight: boolean;
  completed: boolean;
  controller: AbortController;
}

/**
 * Called by the visible Sunday content branch, never by the read's query. A foreground visit gets
 * one receipt; a failed/aborted request keeps its key on the next visit. Rendering, refetching and
 * changing the token callback cannot create another opening.
 */
export function useWeeklyReadOpened(readId: string | undefined): void {
  const account = useAccount();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [settled, setSettled] = useState(0);
  const keyFor = useIdempotencyKey("weekly-read.opened");
  const active = focused && foreground;
  const actorId = account.userId;
  const eligible =
    apiConfigured() &&
    account.ready &&
    account.signedIn &&
    actorId !== null &&
    readId !== undefined;
  const current = useRef({ account, active, eligible, actorId, readId, keyFor });
  current.current = { account, active, eligible, actorId, readId, keyFor };
  const lifecycle = useRef({ active: false, visit: 0 });
  const opening = useRef<Opening | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") opening.current?.controller.abort();
      setForeground(state === "active");
    });
    return () => {
      mounted.current = false;
      lifecycle.current.active = false;
      opening.current?.controller.abort();
      subscription.remove();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: settled resumes an aborted in-flight request after rapid refocus.
  useEffect(() => {
    if (!active) {
      lifecycle.current.active = false;
      opening.current?.controller.abort();
      return;
    }
    if (!lifecycle.current.active) {
      lifecycle.current.active = true;
      lifecycle.current.visit += 1;
    }
    if (!eligible || actorId === null || readId === undefined) {
      opening.current?.controller.abort();
      return;
    }
    const visit = lifecycle.current.visit;
    let attempt = opening.current;
    if (
      attempt === null ||
      attempt.actorId !== actorId ||
      attempt.readId !== readId ||
      (attempt.completed && attempt.visit !== visit)
    ) {
      attempt?.controller.abort();
      attempt = {
        actorId,
        readId,
        key: current.current.keyFor({ actorId, readId, visit }),
        visit,
        inFlight: false,
        completed: false,
        controller: new AbortController(),
      };
      opening.current = attempt;
    }
    if (attempt.completed || attempt.inFlight) return;
    // The settled state only resumes a request aborted during a rapid blur/refocus, not a failed
    // request in the same visit. Its next foreground visit is the bounded retry.
    if (attempt.controller.signal.aborted || attempt.visit !== visit) {
      attempt.controller = new AbortController();
    }
    attempt.visit = visit;
    attempt.inFlight = true;
    const captured = attempt;
    const stillVisible = () => {
      const latest = current.current;
      return (
        mounted.current &&
        !captured.controller.signal.aborted &&
        AppState.currentState === "active" &&
        latest.active &&
        latest.eligible &&
        latest.actorId === captured.actorId &&
        latest.readId === captured.readId &&
        opening.current === captured
      );
    };
    const record = async (fresh: boolean) => {
      const token = await current.current.account.token(fresh ? { fresh: true } : undefined);
      if (token === null || !stillVisible()) return false;
      const response = await openWeeklyRead(
        captured.readId,
        captured.key,
        token,
        captured.controller.signal,
      );
      return response.weekly_read_id === captured.readId && response.opened === true;
    };
    const send = async () => {
      try {
        try {
          captured.completed = await record(false);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401 || !stillVisible()) throw error;
          captured.completed = await record(true);
        }
      } catch {
        // Usage recording never replaces the family's read with an error or logs their identity.
      } finally {
        captured.inFlight = false;
        if (
          mounted.current &&
          opening.current === captured &&
          !captured.completed &&
          captured.visit !== lifecycle.current.visit
        ) {
          setSettled((value) => value + 1);
        }
      }
    };
    void send();
  }, [active, eligible, actorId, readId, settled]);
}
