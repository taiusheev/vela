/** Independently verified direct endpoints for database commands that can change saved data. */
const REMOTE_HOSTS = {
  staging: "ep-frosty-night-b31xz5dh.c-4.ap-southeast-1.aws.neon.tech",
  production: "ep-late-mode-b3bfn7bh.c-4.ap-southeast-1.aws.neon.tech",
} as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_SSL_MODES = new Set([
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
  "no-verify",
]);

/** A constant refusal that never repeats a connection string, password, or parser error. */
export class DatabaseMutationTargetError extends Error {
  override readonly name = "DatabaseMutationTargetError";

  constructor() {
    super(
      "Database changes stopped: the target could not be verified. Remote commands require an explicit staging or production environment and its verified direct connection. Keep the connection private and tell engineering which command stopped.",
    );
  }
}

/**
 * The environment comes from the caller, never the credential. Without it, only local development
 * is allowed. URL query options and inherited PGOPTIONS cannot override the checked target.
 */
export function validatedMutationConnectionString(
  value: string,
  expectedEnvironment: string | undefined,
  inheritedOptions: string | undefined,
): string {
  try {
    const url = new URL(value.trim());
    // pg rewrites the entire URL after a malformed percent escape, which can change how it reads
    // another component. Refuse invalid password encoding before handing the URL to that parser.
    decodeURIComponent(url.password);
    const keys = [...url.searchParams.keys()];
    const sslMode = url.searchParams.get("sslmode");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      value.includes("#") ||
      keys.some((key) => !["sslmode", "channel_binding"].includes(key)) ||
      keys.length !== new Set(keys).size ||
      (url.searchParams.has("channel_binding") &&
        url.searchParams.get("channel_binding") !== "require") ||
      (inheritedOptions !== undefined && inheritedOptions.trim() !== "")
    ) {
      throw new DatabaseMutationTargetError();
    }

    if (expectedEnvironment === undefined) {
      if (!LOCAL_HOSTS.has(url.hostname) || (sslMode !== null && !LOCAL_SSL_MODES.has(sslMode))) {
        throw new DatabaseMutationTargetError();
      }
    } else {
      if (expectedEnvironment !== "staging" && expectedEnvironment !== "production") {
        throw new DatabaseMutationTargetError();
      }
      if (
        url.hostname !== REMOTE_HOSTS[expectedEnvironment] ||
        (url.port !== "" && url.port !== "5432") ||
        decodeURIComponent(url.username) !== "neondb_owner" ||
        url.password.length === 0 ||
        url.pathname !== "/neondb" ||
        (sslMode !== "require" && sslMode !== "verify-full")
      ) {
        throw new DatabaseMutationTargetError();
      }
      url.username = "neondb_owner";
    }

    // pg falls back to PGPORT when a URL omits its port. Pin the default without changing a local
    // development port such as PGlite's 54320.
    if (url.port === "") url.port = "5432";
    return url.toString();
  } catch {
    throw new DatabaseMutationTargetError();
  }
}
