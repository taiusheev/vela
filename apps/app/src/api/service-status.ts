/** Public heartbeat only: no session, cookies, family identifiers or provider content. */
export type ServiceStatus = "responding" | "degraded" | "unreachable" | "unconfigured";

export async function readServiceStatus(
  base: string | undefined,
  signal?: AbortSignal,
): Promise<ServiceStatus> {
  if (!base) return "unconfigured";
  if (signal?.aborted) return "unreachable";
  const controller = new AbortController();
  let finishCancellation: (status: ServiceStatus) => void = () => {};
  const cancelled = new Promise<ServiceStatus>((resolve) => {
    finishCancellation = resolve;
  });
  const cancel = () => {
    controller.abort();
    finishCancellation("unreachable");
  };
  signal?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<ServiceStatus>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("unreachable");
      }, 8_000);
    });
    const read = async (): Promise<ServiceStatus> => {
      const url = new URL("/healthz", base);
      if (url.username || url.password) return "unreachable";
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null || !("status" in body)) {
        return "unreachable";
      }
      if (
        response.status === 200 &&
        body.status === "ok" &&
        "lastReconcileAgeSeconds" in body &&
        typeof body.lastReconcileAgeSeconds === "number" &&
        Number.isFinite(body.lastReconcileAgeSeconds) &&
        body.lastReconcileAgeSeconds >= 0 &&
        body.lastReconcileAgeSeconds <= 35 * 60
      ) {
        return "responding";
      }
      return response.status === 503 &&
        (body.status === "stale" || body.status === "no_reconcile_yet")
        ? "degraded"
        : "unreachable";
    };
    return await Promise.race([read(), timeout, cancelled]);
  } catch {
    return "unreachable";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
