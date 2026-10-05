/** Public, content-free deployment checks. Never send a credential or follow a redirect. */
export type ReleaseEnvironment = "staging" | "production";

export interface SmokeCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly http_status: number | null;
}

export interface SmokeResult {
  readonly environment: ReleaseEnvironment;
  readonly checked_at_utc: string;
  readonly passed: boolean;
  readonly checks: readonly SmokeCheck[];
}

const TRIAL_CAPABILITIES: Readonly<Record<string, boolean>> = {
  pilot: true,
  telegram_first: true,
  english_only: true,
  memory: false,
  book: false,
  parent_app: false,
  billing: false,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
    throw new Error("Unexpected response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw new Error("Response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The login location may contain a signed query; only return a boolean, never the URL. */
function protectedAdmin(response: Response): boolean {
  if (![301, 302, 303, 307, 308].includes(response.status)) return false;
  try {
    const location = new URL(response.headers.get("location") ?? "");
    return (
      location.protocol === "https:" &&
      location.hostname.endsWith(".cloudflareaccess.com") &&
      location.pathname.startsWith("/cdn-cgi/access/login") &&
      location.username === "" &&
      location.password === ""
    );
  } catch {
    return false;
  }
}

export async function releaseSmoke(
  environment: ReleaseEnvironment,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<SmokeResult> {
  const subdomain = environment === "staging" ? "vela-light-staging" : "vela-light";
  const pilot = `https://vela.${subdomain}.workers.dev`;
  const admin = `https://vela-admin.${subdomain}.workers.dev`;
  const specs: readonly {
    name: string;
    url: string;
    verify: (response: Response) => boolean | Promise<boolean>;
  }[] = [
    {
      name: "reconcile_heartbeat",
      url: `${pilot}/healthz`,
      verify: async (response) => {
        if (response.status !== 200) return false;
        const body = await boundedJson(response);
        return (
          record(body) &&
          body.status === "ok" &&
          typeof body.lastReconcileAgeSeconds === "number" &&
          Number.isFinite(body.lastReconcileAgeSeconds) &&
          body.lastReconcileAgeSeconds >= 0 &&
          body.lastReconcileAgeSeconds <= 35 * 60
        );
      },
    },
    ...["/privacy", "/privacy/zh-TW"].map((path) => ({
      name: path === "/privacy" ? "english_privacy_public" : "existing_privacy_public",
      url: `${pilot}${path}`,
      verify: (response: Response) =>
        response.status === 200 &&
        (response.headers.get("content-type")?.includes("text/html") ?? false),
    })),
    {
      name: "api_requires_authentication",
      url: `${pilot}/v1/me`,
      verify: (response) => response.status === 401,
    },
    {
      name: "pilot_has_no_admin",
      url: `${pilot}/admin`,
      verify: (response) => response.status === 404,
    },
    { name: "admin_access_login", url: `${admin}/admin`, verify: protectedAdmin },
    {
      name: environment === "production" ? "english_trial_capabilities" : "capabilities_available",
      url: `${pilot}/v1/capabilities`,
      verify: async (response) => {
        if (response.status !== 200) return false;
        const body = await boundedJson(response);
        return (
          record(body) &&
          Object.entries(TRIAL_CAPABILITIES).every(
            ([key, expected]) =>
              typeof body[key] === "boolean" &&
              (environment !== "production" || body[key] === expected),
          )
        );
      },
    },
  ];
  const checks = await Promise.all(
    specs.map(async ({ name, url, verify }): Promise<SmokeCheck> => {
      const controller = new AbortController();
      let response: Response | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Bound the body read as well as fetch, including transports which ignore abort.
        const timedOut = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Check timed out"));
          }, timeoutMs);
        });
        const check = async () => {
          response = await fetcher(url, {
            redirect: "manual",
            signal: controller.signal,
            headers: { Accept: "application/json, text/html" },
          });
          if (controller.signal.aborted) {
            await response.body?.cancel().catch(() => {});
            return false;
          }
          return verify(response);
        };
        const passed = await Promise.race([check(), timedOut]);
        return { name, passed, http_status: response?.status ?? null };
      } catch {
        // Do not log exception text: providers can put URLs, signatures or bodies in errors.
        return { name, passed: false, http_status: response?.status ?? null };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
        void response?.body?.cancel().catch(() => {});
      }
    }),
  );
  return {
    environment,
    checked_at_utc: new Date().toISOString(),
    passed: checks.every((check) => check.passed),
    checks,
  };
}
