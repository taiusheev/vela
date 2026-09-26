import { describe, expect, inject, it } from "vitest";
import type { AiProvider, ApiSwitch, LineSwitch, MediaStorage } from "../src/config.ts";
import {
  type Command,
  cloudflareApi,
  cloudflareRequest,
  describeFailure,
  EMPTY_LINE,
  type Environment,
  fillPlaceholder,
  generateWebhookSecret,
  mergeDotEnv,
  normalizeTeamDomain,
  parseArguments,
  parseConnectionString,
  placeholdersOf,
  planSecrets,
  readDotEnv,
  readEnvironmentConfig,
  received,
  redact,
  runSetup,
  type SetupIo,
  STEPS,
  startChats,
  stepsFrom,
  stripJsonComments,
  typeInto,
  type WorkerFile,
} from "./setup-environment.ts";
import { SetupError } from "./telegram-webhook.ts";

/** Every value the founder pastes in a fake setup, each marked so a leak is easy to spot. */
const SECRETS = {
  cloudflareToken: "cfSENTINELtoken000000000000000000000000001",
  databasePassword: "npgSENTINELdatabasepassword",
  botToken: "7000000001:SENTINELbotTokenAAAAAAAAAAAAAAAAAAAAAA",
  anthropic: "sk-ant-SENTINEL-anthropic-key",
  // Clerk keys share Stripe's sk_test_/sk_live_ prefixes, so these two are joined at run time:
  // a literal would be taken for a real key by secret scanning (GitHub push protection).
  clerk: ["sk", "test", "SENTINELclerkSecretKey000000000000000"].join("_"),
  /** A production instance's key, which staging's prompt refuses. */
  clerkLive: ["sk", "live", "SENTINELclerkSecretKey000000000000000"].join("_"),
  deepgram: "SENTINELdeepgramkey00000000000000000000",
  accessAud: "5e0715e1".repeat(8),
  chatId: "8765432109",
} as const;

/** A direct string as Neon's Connect shows it for a new project: database neondb, role neondb_owner. */
const DATABASE_URL = `postgresql://neondb_owner:${SECRETS.databasePassword}@ep-quiet-sky-a1b2c3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const HYPERDRIVE_ID = "fedcba9876543210fedcba9876543210";
const TEAM_DOMAIN = "vela-founder.cloudflareaccess.com";
const START_UPDATE_ID = 41;

const ACCOUNT_NAMES: Readonly<Record<Environment, string>> = {
  staging: "Vela staging",
  production: "Vela",
};
const SUBDOMAINS: Readonly<Record<Environment, string>> = {
  staging: "vela-light-staging",
  production: "vela-light",
};
const BOT_USERNAMES: Readonly<Record<Environment, string>> = {
  staging: "VelaStagingTestBot",
  production: "VelaLightBot",
};

/**
 * What a test sets an environment's switches to, whatever the real files hold, so a test about the
 * Anthropic key, the media bucket or Clerk's key does not depend on whether that switch is on in
 * the repository today. `media` moves the `MEDIA_STORAGE` var and the r2_buckets binding together,
 * as decision M holds them: with "off" there is no binding at all. `api` is the pilot Worker's
 * `API_V1` (ADR-29). `line` moves both Workers' `LINE_CHANNEL` and the pilot Worker's inbound
 * queue binding together, as 05 §5.10 holds them.
 */
interface SwitchOverrides {
  readonly ai?: Partial<Record<Environment, AiProvider>>;
  readonly media?: Partial<Record<Environment, MediaStorage>>;
  readonly api?: Partial<Record<Environment, ApiSwitch>>;
  readonly line?: Partial<Record<Environment, LineSwitch>>;
}

/**
 * An environment's queues with LINE's inbound queue bound (a producer onto
 * `vela-inbound-<environment>` and its consumer, as the commit that turns LINE on adds them) or with
 * none of it.
 */
function withInboundQueue(queues: unknown, environment: Environment, bound: boolean): unknown {
  const queue = `vela-inbound-${environment}`;
  const record = typeof queues === "object" && queues !== null ? recordOf(queues) : {};
  const producers = (Array.isArray(record.producers) ? record.producers : []).filter(
    (producer) => recordOf(producer).binding !== "INBOUND_QUEUE",
  );
  const consumers = (Array.isArray(record.consumers) ? record.consumers : []).filter(
    (consumer) => recordOf(consumer).queue !== queue,
  );
  if (!bound) {
    return { producers, consumers };
  }
  return {
    producers: [...producers, { binding: "INBOUND_QUEUE", queue }],
    consumers: [
      ...consumers,
      {
        queue,
        max_batch_size: 10,
        max_batch_timeout: 1,
        max_retries: 3,
        retry_delay: 30,
        dead_letter_queue: `vela-dead-letter-${environment}`,
      },
    ],
  };
}

/**
 * One environment's block of a wrangler text, changed by `edit`: the text is parsed, edited and
 * written back as JSON, since a switch that also moves a binding is more than one quoted token.
 */
function editedBlock(
  text: string,
  environment: Environment,
  edit: (block: Record<string, unknown>) => void,
): string {
  const parsed = JSON.parse(stripJsonComments(text, "wrangler.jsonc")) as {
    readonly env: Partial<Record<Environment, Record<string, unknown>>>;
  };
  const block = parsed.env[environment];
  if (block === undefined) {
    throw new Error(`the text has no env.${environment}`);
  }
  edit(block);
  return JSON.stringify(parsed, null, 2);
}

/** Sets `LINE_CHANNEL` in one environment of a wrangler text, and nothing else. */
function withLineVar(text: string, environment: Environment, value: string | undefined): string {
  return editedBlock(text, environment, (block) => {
    const vars = { ...recordOf(block.vars) };
    if (value === undefined) {
      delete vars.LINE_CHANNEL;
    } else {
      vars.LINE_CHANNEL = value;
    }
    block.vars = vars;
  });
}

/**
 * Both wrangler files as JSON with comments, built from what wrangler itself read from the real
 * files (vitest.config.ts), so the fake setups run on the real names, hosts and placeholders.
 */
function wranglerTexts(overrides: SwitchOverrides = {}): {
  readonly pilot: string;
  readonly admin: string;
} {
  const configs = inject("workerConfigs");
  const text = (worker: "pilot" | "admin"): string => {
    const env = Object.fromEntries(
      (["staging", "production"] as const).map((environment) => {
        const config = configs.find((c) => c.worker === worker && c.environment === environment);
        const aiProvider = overrides.ai?.[environment];
        // MEDIA_STORAGE is the pilot Worker's var alone, and so is the binding it moves with.
        const mediaStorage = worker === "pilot" ? overrides.media?.[environment] : undefined;
        // So is API_V1: the admin Worker never serves /v1.
        const apiV1 = worker === "pilot" ? overrides.api?.[environment] : undefined;
        // LINE_CHANNEL is both Workers', and only the pilot Worker binds the inbound queue.
        const line = overrides.line?.[environment];
        return [
          environment,
          {
            name: config?.name,
            queues:
              line === undefined || worker === "admin"
                ? config?.queues
                : withInboundQueue(config?.queues, environment, line === "on"),
            r2_buckets:
              mediaStorage === undefined
                ? config?.r2Buckets
                : mediaStorage === "r2"
                  ? [{ binding: "MEDIA_BUCKET", bucket_name: `vela-media-${environment}` }]
                  : [],
            hyperdrive: [{ binding: "HYPERDRIVE", id: placeholdersOf(environment).hyperdriveId }],
            vars: {
              ...config?.vars,
              TELEGRAM_BOT_USERNAME: placeholdersOf(environment).botUsername,
              ...(aiProvider === undefined ? {} : { AI_PROVIDER: aiProvider }),
              ...(mediaStorage === undefined ? {} : { MEDIA_STORAGE: mediaStorage }),
              ...(apiV1 === undefined ? {} : { API_V1: apiV1 }),
              ...(line === undefined ? {} : { LINE_CHANNEL: line }),
            },
          },
        ];
      }),
    );
    return [
      "{",
      `  // The ${worker} Worker. See https://developers.cloudflare.com/workers/wrangler/configuration/`,
      `  "env": ${JSON.stringify(env, null, 2)} /* every environment */`,
      "}",
      "",
    ].join("\n");
  };
  return { pilot: text("pilot"), admin: text("admin") };
}

// ---------------------------------------------------------------------------------------------
// A fake Cloudflare, Neon, Telegram and terminal

interface HyperdriveConfig {
  readonly id: string;
  readonly name: string;
  readonly origin: { readonly host: string; readonly database: string; readonly user: string };
  caching: { disabled: boolean };
}

interface World {
  readonly environment: Environment;
  /** What Cloudflare calls the account, its workers.dev subdomain, and the bot getMe names. */
  accountName: string;
  subdomain: string;
  botUsername: string;
  /** Answers given once, before the usual one, to the first prompt whose text has the label. */
  firstAnswers: [label: string, answer: string][];
  readonly queues: Set<string>;
  readonly buckets: Set<string>;
  readonly hyperdrives: HyperdriveConfig[];
  /** Worker name to its secrets; a Worker exists once a secret is put or it is deployed. */
  readonly workers: Map<string, Map<string, string>>;
  readonly files: Map<WorkerFile, string>;
  gitIgnoresEnv: boolean;
  /** When set, creating the Hyperdrive configuration fails with this Cloudflare error message. */
  hyperdriveError: string | null;
  accessOn: boolean;
  adminOpenWithoutAccess: boolean;
  /** What the deployed pilot Worker's `/healthz` says. */
  health: "ok" | "stale" | "no_reconcile_yet";
  /**
   * When set, what the deployed pilot Worker's `/v1/me` answers whatever its settings say:
   * `not_found` as a deployment from before /v1 would, `unavailable` as a refused CLERK_ISSUER would,
   * `foreign_401` a plain-text 401 from something that is not the API.
   */
  apiFault: "not_found" | "unavailable" | "foreign_401" | null;
  webhook: { readonly url: string; readonly secret: string } | null;
  acknowledgedOffset: number | null;
  seed: number;
  // What the setup did, cleared by `resetLog`.
  deployed: string[];
  migrations: number;
  requests: { readonly method: string; readonly url: string }[];
  commands: Command[];
  writes: { readonly file: WorkerFile; readonly text: string }[];
  printed: string[];
  prompts: string[];
  /** Each prompt read the other way than its answer must be: a key shown, or Enter hidden. */
  misread: string[];
}

function newWorld(
  environment: Environment,
  switches: {
    readonly ai?: AiProvider;
    readonly media?: MediaStorage;
    readonly api?: ApiSwitch;
    readonly line?: LineSwitch;
  } = {},
): World {
  const texts = wranglerTexts({
    ...(switches.ai === undefined ? {} : { ai: { [environment]: switches.ai } }),
    ...(switches.media === undefined ? {} : { media: { [environment]: switches.media } }),
    ...(switches.api === undefined ? {} : { api: { [environment]: switches.api } }),
    ...(switches.line === undefined ? {} : { line: { [environment]: switches.line } }),
  });
  return {
    environment,
    accountName: ACCOUNT_NAMES[environment],
    subdomain: SUBDOMAINS[environment],
    botUsername: BOT_USERNAMES[environment],
    firstAnswers: [],
    queues: new Set(),
    buckets: new Set(),
    hyperdrives: [],
    workers: new Map(),
    files: new Map<WorkerFile, string>([
      ["wrangler.jsonc", texts.pilot],
      ["wrangler.admin.jsonc", texts.admin],
    ]),
    gitIgnoresEnv: true,
    hyperdriveError: null,
    accessOn: false,
    adminOpenWithoutAccess: false,
    health: "no_reconcile_yet",
    apiFault: null,
    webhook: null,
    acknowledgedOffset: null,
    seed: 7,
    deployed: [],
    migrations: 0,
    requests: [],
    commands: [],
    writes: [],
    printed: [],
    prompts: [],
    misread: [],
  };
}

function resetLog(world: World): void {
  world.deployed = [];
  world.migrations = 0;
  world.requests = [];
  world.commands = [];
  world.writes = [];
  world.printed = [];
  world.prompts = [];
  world.misread = [];
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function cloudflareOk(result: unknown, resultInfo?: unknown): Response {
  return json(200, { success: true, errors: [], result, result_info: resultInfo });
}

function cloudflareError(status: number, code: number, message: string): Response {
  return json(status, { success: false, errors: [{ code, message }], result: null });
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function secretsOf(world: World, worker: string): Map<string, string> {
  const secrets = world.workers.get(worker) ?? new Map<string, string>();
  world.workers.set(worker, secrets);
  return secrets;
}

function cloudflare(
  world: World,
  method: string,
  path: string,
  body: Record<string, unknown>,
  authorization: string | null,
): Response {
  if (authorization !== `Bearer ${SECRETS.cloudflareToken}`) {
    return cloudflareError(401, 10000, "Authentication error");
  }
  const account = `/accounts/${ACCOUNT_ID}`;
  const route = `${method} ${path}`;
  if (route === "GET /user/tokens/verify") {
    return cloudflareOk({ id: "token-id", status: "active" });
  }
  if (route === `GET ${account}`) {
    return cloudflareOk({ id: ACCOUNT_ID, name: world.accountName });
  }
  if (route === `GET ${account}/workers/subdomain`) {
    return cloudflareOk({ subdomain: world.subdomain });
  }
  if (route === `GET ${account}/queues`) {
    const result = [...world.queues].map((name) => ({ queue_id: `id-${name}`, queue_name: name }));
    return cloudflareOk(result, { page: 1, per_page: 100, total_pages: 1 });
  }
  if (route === `POST ${account}/queues`) {
    world.queues.add(String(body.queue_name));
    return cloudflareOk({ queue_name: body.queue_name });
  }
  const bucket = path.match(/^\/accounts\/\w+\/r2\/buckets\/(.+)$/)?.[1];
  if (method === "GET" && bucket !== undefined) {
    return world.buckets.has(decodeURIComponent(bucket))
      ? cloudflareOk({ name: bucket })
      : cloudflareError(404, 10006, "The specified bucket does not exist.");
  }
  if (route === `POST ${account}/r2/buckets`) {
    expect(body.locationHint).toBe("apac");
    world.buckets.add(String(body.name));
    return cloudflareOk({ name: body.name });
  }
  if (route === `GET ${account}/hyperdrive/configs`) {
    return cloudflareOk(world.hyperdrives, { page: 1, per_page: 100, total_pages: 1 });
  }
  const hyperdrive = world.hyperdrives.find(
    (config) => path === `${account}/hyperdrive/configs/${config.id}`,
  );
  if (method === "PATCH" && hyperdrive !== undefined) {
    hyperdrive.caching = { disabled: recordOf(body.caching).disabled === true };
    return cloudflareOk(hyperdrive);
  }
  if (route === `POST ${account}/hyperdrive/configs`) {
    if (world.hyperdriveError !== null) {
      return cloudflareError(400, 2008, world.hyperdriveError);
    }
    const origin = recordOf(body.origin);
    const created: HyperdriveConfig = {
      id: HYPERDRIVE_ID,
      name: String(body.name),
      origin: {
        host: String(origin.host),
        database: String(origin.database),
        user: String(origin.user),
      },
      caching: { disabled: recordOf(body.caching).disabled === true },
    };
    world.hyperdrives.push(created);
    return cloudflareOk(created);
  }
  const secrets = path.match(/^\/accounts\/\w+\/workers\/scripts\/([\w-]+)\/secrets$/)?.[1];
  if (method === "GET" && secrets !== undefined) {
    const worker = world.workers.get(secrets);
    return worker === undefined
      ? cloudflareError(404, 10007, "This Worker does not exist on your account.")
      : cloudflareOk([...worker.keys()].map((name) => ({ name, type: "secret_text" })));
  }
  throw new Error(`the fake Cloudflare has no ${route}`);
}

function telegram(world: World, path: string, body: Record<string, unknown>): Response {
  const [, token, method] = path.match(/^\/bot([^/]+)\/(\w+)$/) ?? [];
  if (token !== SECRETS.botToken) {
    return json(401, { ok: false, error_code: 401, description: "Unauthorized" });
  }
  const ok = (result: unknown): Response => json(200, { ok: true, result });
  switch (method) {
    case "getMe":
      return ok({
        id: 7000000001,
        is_bot: true,
        first_name: "Vela Light",
        username: world.botUsername,
        can_join_groups: true,
        can_read_all_group_messages: false,
      });
    case "getWebhookInfo":
      return ok({ url: world.webhook?.url ?? "", pending_update_count: 0 });
    case "getUpdates":
      if (world.webhook !== null) {
        return json(409, { ok: false, error_code: 409, description: "Conflict" });
      }
      if (typeof body.offset === "number") {
        world.acknowledgedOffset = body.offset;
        return ok([]);
      }
      return ok(
        (world.acknowledgedOffset ?? 0) > START_UPDATE_ID
          ? []
          : [
              {
                update_id: START_UPDATE_ID,
                message: {
                  message_id: 1,
                  chat: { id: Number(SECRETS.chatId), type: "private", first_name: "Timur" },
                  text: "/start",
                },
              },
            ],
      );
    case "setWebhook":
      world.webhook = { url: String(body.url), secret: String(body.secret_token) };
      return ok(true);
    case "setMyCommands":
      return ok(true);
    default:
      throw new Error(`the fake Telegram has no ${String(method)}`);
  }
}

/** The API's answers the check step can meet, as `src/api-runtime.ts` and `src/api-app.ts` send them. */
const API_ANSWERS = {
  unauthenticated: [401, "Sign in required."],
  not_found: [404, "Not found."],
  unavailable: [503, "Service temporarily unavailable."],
} as const;

/**
 * What the deployed pilot Worker's `/v1/me` answers without a token, as its API decides: 404 while
 * `API_V1` is off, 503 while `vela` lacks Clerk's secret key, and otherwise 401, unless the test
 * set a fault. So a whole setup passes its check only once the key is on the Worker.
 */
function apiAnswer(world: World): Response {
  if (world.apiFault === "foreign_401") {
    return new Response("Unauthorized", { status: 401 });
  }
  const code =
    world.apiFault ??
    (configOf(world).apiV1 === "off"
      ? "not_found"
      : world.workers.get("vela")?.has("CLERK_SECRET_KEY") === true
        ? "unauthenticated"
        : "unavailable");
  const [status, message] = API_ANSWERS[code];
  return json(status, { error: { code, message } }, { "cache-control": "no-store" });
}

function site(world: World, url: URL): Response {
  const pilot = `vela.${SUBDOMAINS[world.environment]}.workers.dev`;
  const admin = `vela-admin.${SUBDOMAINS[world.environment]}.workers.dev`;
  if (url.hostname === pilot && world.deployed.includes("vela")) {
    if (url.pathname === "/healthz") {
      return world.health === "ok"
        ? json(200, { status: "ok", lastReconcileAgeSeconds: 42 })
        : json(503, { status: world.health });
    }
    if (url.pathname === "/v1/me") {
      return apiAnswer(world);
    }
    return new Response("ok", { status: 200 });
  }
  if (url.hostname === admin && url.pathname === "/admin") {
    if (world.accessOn) {
      return new Response(null, {
        status: 302,
        headers: { location: `https://${TEAM_DOMAIN}/cdn-cgi/access/login` },
      });
    }
    return new Response("", { status: world.adminOpenWithoutAccess ? 200 : 401 });
  }
  return new Response("not found", { status: 404 });
}

/**
 * Each prompt by a label its text holds, the usual answer, and whether the setup must read it
 * hidden. Only Enter, yes or no, and the environment's name may be shown as typed: nodeIo echoes
 * every key of `ask`, so a key read there, or an identifier pasted while the clipboard still holds
 * one, would be on screen, which no printed line, argument or file would reveal.
 */
function promptsOf(world: World): readonly (readonly [string, string, "shown" | "hidden"])[] {
  return [
    ["send /start", "", "shown"],
    ['Is "Timur" you?', "yes", "shown"],
    ["When Access is applied", "", "shown"],
    ["This account is named", world.environment, "shown"],
    ["Account ID", ACCOUNT_ID, "hidden"],
    ["Team domain", `https://${TEAM_DOMAIN}/`, "hidden"],
    ["Cloudflare API token", SECRETS.cloudflareToken, "hidden"],
    ["Neon connection string", DATABASE_URL, "hidden"],
    ["Telegram bot token", SECRETS.botToken, "hidden"],
    ["Anthropic API key", SECRETS.anthropic, "hidden"],
    ["Clerk secret key", SECRETS.clerk, "hidden"],
    ["Deepgram API key", SECRETS.deepgram, "hidden"],
    ["Application Audience (AUD) tag", SECRETS.accessAud, "hidden"],
  ];
}

function fakeIo(world: World): SetupIo {
  const answer = (question: string, read: "shown" | "hidden"): string => {
    world.prompts.push(question);
    const found = promptsOf(world).find(([label]) => question.includes(label));
    if (found === undefined) {
      throw new Error(`unexpected prompt: ${question}`);
    }
    const [label, usual, must] = found;
    if (read !== must) {
      world.misread.push(`${label}: read ${read}, must be ${must}`);
      throw new Error(`${label} read ${read}`);
    }
    if (label === "When Access is applied") {
      world.accessOn = true;
    }
    const first = world.firstAnswers.findIndex(([once]) => question.includes(once));
    const [given] = first === -1 ? [] : world.firstAnswers.splice(first, 1);
    return given === undefined ? usual : given[1];
  };
  return {
    interactive: true,
    print: (line) => world.printed.push(line),
    ask: async (question) => answer(question, "shown"),
    askHidden: async (question) => answer(question, "hidden"),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      world.requests.push({ method: request.method, url: request.url });
      const text = request.method === "GET" ? "" : await request.text();
      const body: Record<string, unknown> = text === "" ? {} : JSON.parse(text);
      if (url.hostname === "api.cloudflare.com") {
        return cloudflare(
          world,
          request.method,
          url.pathname.replace("/client/v4", ""),
          body,
          request.headers.get("authorization"),
        );
      }
      if (url.hostname === "api.telegram.org") {
        return telegram(world, url.pathname, body);
      }
      return site(world, url);
    },
    run: async (command, onLine) => {
      world.commands.push(command);
      if (command.tool === "git") {
        expect(command.args).toEqual(["check-ignore", "--quiet", ".env"]);
        return world.gitIgnoresEnv ? 0 : 1;
      }
      if (command.tool === "migrate") {
        // A database driver's error may quote the connection string; the setup must hide it.
        onLine(`connecting with ${command.env.DATABASE_URL}`);
        world.migrations += 1;
        return 0;
      }
      if (
        command.env.CLOUDFLARE_API_TOKEN !== SECRETS.cloudflareToken ||
        command.env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT_ID ||
        command.args.at(-1) !== world.environment
      ) {
        return 1;
      }
      const worker = command.args.includes("wrangler.admin.jsonc") ? "vela-admin" : "vela";
      const [verb, action, name] = command.args;
      if (verb === "secret" && action === "put" && name !== undefined) {
        secretsOf(world, worker).set(name, command.stdin);
        onLine(`Success! Uploaded secret ${name}`);
        return 0;
      }
      if (verb === "deploy") {
        secretsOf(world, worker);
        world.deployed.push(worker);
        onLine(`Deployed ${worker}`);
        return 0;
      }
      return 1;
    },
    readFile: async (file) => world.files.get(file) ?? null,
    writeFile: async (file, text) => {
      world.files.set(file, text);
      world.writes.push({ file, text });
    },
    randomBytes: (length) =>
      Uint8Array.from({ length }, () => {
        world.seed = (world.seed * 73 + 41) % 256;
        return world.seed;
      }),
  };
}

/**
 * Every place a secret must never be, and which secret was found there, after every prompt the
 * setup read the other way than it must, since a key read at a shown prompt is on screen.
 */
function leaks(world: World): string[] {
  const secrets = [
    ...Object.values(SECRETS),
    DATABASE_URL,
    // The team domain is an identifier the resource register records (infra/README.md, section
    // 12), put as a secret only because the admin Worker reads it with ACCESS_AUD.
    ...[...world.workers.values()].flatMap((secrets) =>
      [...secrets].filter(([name]) => name !== "ACCESS_TEAM_DOMAIN").map(([, value]) => value),
    ),
    ...(world.webhook === null ? [] : [world.webhook.secret]),
  ];
  const surfaces: [string, string][] = [
    ...world.printed.map((line): [string, string] => ["printed line", line]),
    ...world.prompts.map((question): [string, string] => ["prompt", question]),
    ...world.commands.map((command): [string, string] => ["argument", command.args.join(" ")]),
    ...world.writes
      .filter((write) => !(world.environment === "staging" && write.file === ".env"))
      .map((write): [string, string] => [`file ${write.file}`, write.text]),
  ];
  return [
    ...world.misread,
    ...surfaces.flatMap(([where, text]) =>
      secrets.filter((secret) => text.includes(secret)).map((secret) => `${where}: ${secret}`),
    ),
  ];
}

function configOf(world: World): ReturnType<typeof readEnvironmentConfig> {
  return readEnvironmentConfig(
    {
      pilot: world.files.get("wrangler.jsonc") ?? "",
      admin: world.files.get("wrangler.admin.jsonc") ?? "",
    },
    world.environment,
  );
}

async function setUp(world: World, ...extra: string[]): Promise<number> {
  return runSetup(["--env", world.environment, ...extra], fakeIo(world));
}

// ---------------------------------------------------------------------------------------------

describe("a whole setup", () => {
  it("sets up staging from nothing with AI on, with every secret on the Worker that reads it", async () => {
    const world = newWorld("staging", { ai: "anthropic", media: "r2", api: "on" });

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect([...world.queues]).toEqual([
      "vela-outbound-staging",
      "vela-media-staging",
      "vela-understand-staging",
      "vela-dead-letter-staging",
    ]);
    expect([...world.buckets]).toEqual(["vela-media-staging"]);
    const hyperdrives = world.hyperdrives.map((config) => [config.name, config.caching.disabled]);
    expect(hyperdrives).toEqual([["vela-apac-staging", true]]);
    expect(world.migrations).toBe(1);
    const config = configOf(world);
    expect([
      config.pilotHyperdriveId,
      config.adminHyperdriveId,
      config.botUsername,
      config.adminBotUsername,
    ]).toEqual([HYPERDRIVE_ID, HYPERDRIVE_ID, "VelaStagingTestBot", "VelaStagingTestBot"]);
    expect(Object.fromEntries(world.workers.get("vela") ?? [])).toEqual({
      TELEGRAM_BOT_TOKEN: SECRETS.botToken,
      TELEGRAM_WEBHOOK_SECRET: world.webhook?.secret,
      ADMIN_CONVERSATION_ID: SECRETS.chatId,
      ANTHROPIC_API_KEY: SECRETS.anthropic,
      CLERK_SECRET_KEY: SECRETS.clerk,
      DEEPGRAM_API_KEY: SECRETS.deepgram,
    });
    expect(Object.fromEntries(world.workers.get("vela-admin") ?? [])).toEqual({
      ANTHROPIC_API_KEY: SECRETS.anthropic,
      ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
      ACCESS_AUD: SECRETS.accessAud,
    });
    expect(world.deployed).toEqual(["vela", "vela-admin"]);
    expect(world.webhook?.url).toBe(
      "https://vela.vela-light-staging.workers.dev/webhooks/telegram",
    );
    // The founder's /start was confirmed, so it never reaches the Worker once the webhook exists.
    expect(world.acknowledgedOffset).toBe(START_UPDATE_ID + 1);
    // The secrets step's prompts, in the order infra/README.md, section 11, step 7 lists them.
    expect(
      world.prompts
        .filter((question) => /Anthropic|Clerk|Deepgram/.test(question))
        .map((question) => question.trim()),
    ).toEqual([
      "Anthropic API key (hidden):",
      "Clerk secret key (hidden):",
      "Deepgram API key (hidden):",
    ]);
    expect(world.printed).toContain(
      "  ok     GET https://vela.vela-light-staging.workers.dev/v1/me: HTTP 401, unauthenticated: the API is served and its settings accepted",
    );
    expect(world.printed.at(-1)).toBe("check: every check passed");
    expect(world.printed.join("\n")).not.toContain("AI is off");
    expect(world.printed.join("\n")).not.toContain("The API is off");
    expect(leaks(world)).toEqual([]);
  });

  // Decision X (2026-09-18): no Anthropic credit is bought while AI is off.
  it("sets up staging with AI off without asking for an Anthropic key, and says how to switch it on", async () => {
    const world = newWorld("staging", { ai: "off", api: "on" });

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.prompts.join("\n")).not.toContain("Anthropic");
    expect([...(world.workers.get("vela")?.keys() ?? [])].sort()).toEqual([
      "ADMIN_CONVERSATION_ID",
      "CLERK_SECRET_KEY",
      "DEEPGRAM_API_KEY",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
    ]);
    expect([...(world.workers.get("vela-admin")?.keys() ?? [])].sort()).toEqual([
      "ACCESS_AUD",
      "ACCESS_TEAM_DOMAIN",
    ]);
    // The key goes on before the switch reaches main, or CI deploys staging without it.
    expect(world.printed.filter((line) => line.includes("AI is off"))).toEqual([
      '  AI is off in staging (AI_PROVIDER "off" in wrangler.jsonc and wrangler.admin.jsonc), so no Anthropic key is asked for. To switch it on later: set AI_PROVIDER to "anthropic" for staging in both files and commit, then run pnpm --filter @vela/worker run setup -- --env staging --from secrets on that commit before it is merged to main, which asks for the key and deploys. Merged first, CI would deploy staging without the key, and both Workers would refuse to run.',
    ]);
    expect(world.deployed).toEqual(["vela", "vela-admin"]);
  });

  it("asks for the Anthropic key and deploys when run from secrets once AI is switched on", async () => {
    const world = newWorld("staging", { ai: "off" });
    await setUp(world);
    for (const file of ["wrangler.jsonc", "wrangler.admin.jsonc"] as const) {
      const text = world.files.get(file) ?? "";
      world.files.set(file, text.replace('"AI_PROVIDER": "off"', '"AI_PROVIDER": "anthropic"'));
    }
    expect(configOf(world).aiProvider).toBe("anthropic");
    resetLog(world);

    const code = await setUp(world, "--from", "secrets");

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.prompts.filter((question) => question.includes("Anthropic API key"))).toHaveLength(
      1,
    );
    expect(world.workers.get("vela")?.get("ANTHROPIC_API_KEY")).toBe(SECRETS.anthropic);
    expect(world.workers.get("vela-admin")?.get("ANTHROPIC_API_KEY")).toBe(SECRETS.anthropic);
    expect(world.deployed).toEqual(["vela", "vela-admin"]);
    expect(world.printed.join("\n")).not.toContain("AI is off");
    expect(leaks(world)).toEqual([]);
  });

  // Its Workers would refuse to start: families' answers there need the flag check.
  it("refuses to set up production with AI off, before it creates anything", async () => {
    const world = newWorld("production", { ai: "off" });

    const code = await setUp(world);

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain(
      "AI_PROVIDER is off for production, which its Workers refuse to start with",
    );
    expect([world.queues.size, world.buckets.size, world.writes.length]).toEqual([0, 0, 0]);
    expect(world.prompts.join("\n")).not.toContain("Anthropic");
  });

  // Decision M (2026-09-20): R2 needs a subscription with a payment method, which only the founder
  // can add, so an account without one (staging's, until 26 September 2026) is set up with storage
  // off and nothing is stored there.
  it("sets up staging with media storage off without creating a bucket, and says how to switch it on", async () => {
    const world = newWorld("staging", { media: "off" });

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect([...world.buckets]).toEqual([]);
    expect(world.requests.filter((request) => request.url.includes("/r2/buckets"))).toEqual([]);
    expect(world.printed.filter((line) => line.includes("Media storage is off"))).toEqual([
      '  Media storage is off in staging (MEDIA_STORAGE "off" in wrangler.jsonc), so no R2 bucket is created and Vela keeps no copy of a voice note or photo: Telegram holds them, and each media row keeps only what Telegram said about the file, its id, its type and its size, with no storage key and no copy of the file itself. To switch it on later: enable R2 in the Cloudflare dashboard for the "Vela staging" account (it asks for a payment method, though the pilot\'s use stays inside the free monthly allowance), set MEDIA_STORAGE to "r2" for staging in wrangler.jsonc and add its r2_buckets binding, commit, then run pnpm --filter @vela/worker run setup -- --env staging --from resources on that commit before it is merged to main, which creates the bucket and deploys.',
    ]);
    expect(world.deployed).toEqual(["vela", "vela-admin"]);
  });

  it("creates the media bucket when run from resources once media storage is switched on", async () => {
    const world = newWorld("staging", { media: "off" });
    await setUp(world);
    const pilot = world.files.get("wrangler.jsonc") ?? "";
    world.files.set(
      "wrangler.jsonc",
      pilot
        .replace('"MEDIA_STORAGE": "off"', '"MEDIA_STORAGE": "r2"')
        .replace(
          '"r2_buckets": []',
          '"r2_buckets": [{ "binding": "MEDIA_BUCKET", "bucket_name": "vela-media-staging" }]',
        ),
    );
    expect(configOf(world).mediaStorage).toBe("r2");
    resetLog(world);

    const code = await setUp(world, "--from", "resources");

    expect(code, world.printed.join("\n")).toBe(0);
    expect([...world.buckets]).toEqual(["vela-media-staging"]);
    expect(world.printed).toContain(
      "resources: created bucket vela-media-staging; already there: vela-outbound-staging, vela-media-staging, vela-understand-staging, vela-dead-letter-staging",
    );
    expect(world.printed.join("\n")).not.toContain("Media storage is off");
    expect(world.deployed).toEqual(["vela", "vela-admin"]);
  });

  // Its Worker would refuse to start: the privacy notice promises families that media is kept in
  // Vela's own storage for 30 days and then deleted.
  it("refuses to set up production with media storage off, before it creates anything", async () => {
    const world = newWorld("production", { media: "off" });

    const code = await setUp(world);

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain(
      "MEDIA_STORAGE is off for production, which its Worker refuses to start with",
    );
    expect([world.queues.size, world.buckets.size, world.writes.length]).toEqual([0, 0, 0]);
  });

  // 05 §5.10: LINE is off in every environment the repository sets up today, so a run creates no
  // queue it did not create before; the queue comes with the commit that turns LINE on.
  it("sets up staging with LINE off without creating its inbound queue, and says how to switch it on", async () => {
    const world = newWorld("staging", { line: "off" });

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect([...world.queues]).toEqual([
      "vela-outbound-staging",
      "vela-media-staging",
      "vela-understand-staging",
      "vela-dead-letter-staging",
    ]);
    expect(world.printed.filter((line) => line.includes("LINE is off"))).toEqual([
      '  LINE is off in staging (LINE_CHANNEL "off" in wrangler.jsonc and wrangler.admin.jsonc), so no inbound queue is created, and /webhooks/line and /media answer 404 there. To switch it on later: put LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN and MEDIA_URL_SECRET on the pilot Worker, set LINE_CHANNEL to "on" for staging in both files with its LINE_BOT_BASIC_ID, add the INBOUND_QUEUE producer and the vela-inbound-staging consumer to wrangler.jsonc, commit, then run pnpm --filter @vela/worker run setup -- --env staging --from resources on that commit before it is merged to main, which creates the queue and deploys. Merged first, CI would deploy a binding to a queue that does not exist, and the deploy would fail.',
    ]);
    expect(world.deployed).toEqual(["vela", "vela-admin"]);
  });

  it("creates LINE's inbound queue when run from resources once LINE is switched on", async () => {
    const world = newWorld("staging", { line: "off" });
    await setUp(world);
    for (const [file, worker] of [
      ["wrangler.jsonc", "pilot"],
      ["wrangler.admin.jsonc", "admin"],
    ] as const) {
      world.files.set(
        file,
        editedBlock(world.files.get(file) ?? "", "staging", (block) => {
          block.vars = { ...recordOf(block.vars), LINE_CHANNEL: "on" };
          if (worker === "pilot") {
            block.queues = withInboundQueue(block.queues, "staging", true);
          }
        }),
      );
    }
    expect(configOf(world).lineChannel).toBe("on");
    resetLog(world);

    const code = await setUp(world, "--from", "resources");

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.queues.has("vela-inbound-staging")).toBe(true);
    expect(world.printed).toContain(
      "resources: created vela-inbound-staging; already there: vela-outbound-staging, vela-media-staging, vela-understand-staging, vela-dead-letter-staging, bucket vela-media-staging",
    );
    expect(world.printed.join("\n")).not.toContain("LINE is off");
    expect(world.deployed).toEqual(["vela", "vela-admin"]);
  });

  it("says production's LINE stays off until the design's last step, creating no inbound queue", async () => {
    const world = newWorld("production", { line: "off" });

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect([...world.queues].filter((queue) => queue.includes("inbound"))).toEqual([]);
    expect(world.printed.filter((line) => line.includes("LINE is off"))).toEqual([
      '  LINE is off in production (LINE_CHANNEL "off" in wrangler.jsonc and wrangler.admin.jsonc), so no inbound queue is created, and /webhooks/line and /media answer 404 there. It stays off until the LINE design\'s last step turns it on (architecture/05-line-flows.md, section 8, step 11).',
    ]);
  });

  // ADR-29: production's API stays off until a new ADR, so production is set up without a Clerk
  // production instance, and its /v1, which answers 404, is not checked.
  it("sets up production with the API off without asking for a Clerk key, says so, and never opens /v1", async () => {
    const world = newWorld("production", { api: "off" });

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.prompts.join("\n")).not.toContain("Clerk");
    expect(world.workers.get("vela")?.has("CLERK_SECRET_KEY")).toBe(false);
    expect(world.printed.filter((line) => line.includes("The API is off"))).toEqual([
      '  The API is off in production (API_V1 "off" in wrangler.jsonc), so /v1 answers 404 there and no Clerk secret key is asked for. Turning it on takes a new ADR (ADR-29): Clerk\'s production instance, on a domain Vela owns, its sk_live_ key, and a privacy notice naming Clerk. The key then goes on the pilot Worker in the Cloudflare dashboard (infra/runbooks/secrets-rotation.md, principle 5) before the release that sets API_V1 to "on"; released without it, /v1 answers 503 while every other route keeps answering.',
    ]);
    expect(world.requests.filter((request) => request.url.includes("/v1/"))).toEqual([]);
    expect(world.printed.at(-1)).toBe("check: every check passed");
    expect(leaks(world)).toEqual([]);
  });

  it("asks for the Clerk key and checks /v1/me when run from secrets once the API is switched on", async () => {
    const world = newWorld("staging", { api: "off" });
    await setUp(world);
    expect(world.printed.filter((line) => line.includes("The API is off"))).toEqual([
      '  The API is off in staging (API_V1 "off" in wrangler.jsonc), so /v1 answers 404 there and no Clerk secret key is asked for. To switch it on later: set API_V1 to "on" for staging in wrangler.jsonc, with its CLERK_ISSUER, its ratelimits and its ACCOUNT_WRITE_LIMITER binding, and commit, then run pnpm --filter @vela/worker run setup -- --env staging --from secrets on that commit before it is merged to main, which asks for the key and deploys. Merged first, CI would deploy staging without the key, and /v1 would answer 503 while every other route keeps answering.',
    ]);
    // The first "API_V1" in the pilot text is staging's, which is the environment set up here.
    const pilot = world.files.get("wrangler.jsonc") ?? "";
    world.files.set("wrangler.jsonc", pilot.replace('"API_V1": "off"', '"API_V1": "on"'));
    expect(configOf(world).apiV1).toBe("on");
    resetLog(world);

    const code = await setUp(world, "--from", "secrets");

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.prompts.filter((question) => question.includes("Clerk secret key"))).toHaveLength(
      1,
    );
    expect(world.workers.get("vela")?.get("CLERK_SECRET_KEY")).toBe(SECRETS.clerk);
    expect(world.workers.get("vela-admin")?.has("CLERK_SECRET_KEY")).toBe(false);
    expect(world.printed).toContain(
      "  ok     GET https://vela.vela-light-staging.workers.dev/v1/me: HTTP 401, unauthenticated: the API is served and its settings accepted",
    );
    expect(world.printed.join("\n")).not.toContain("The API is off");
    expect(leaks(world)).toEqual([]);
  });

  // Staging verifies the development instance's tokens and holds only test accounts (ADR-29).
  it("refuses a production Clerk key at staging's prompt without showing it, and puts the development one", async () => {
    const world = newWorld("staging", { api: "on" });
    world.firstAnswers = [["Clerk secret key", SECRETS.clerkLive]];

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.printed).toContain(
      "  Clerk dashboard (dashboard.clerk.com), application Vela Light, Development instance: API keys > Secret keys, and copy the secret key, which starts sk_test_ (infra/README.md, section 9a). It goes on the pilot Worker, for the API's live session check on every write.",
    );
    expect(world.printed).toContain(
      "  Staging takes only the Development instance's secret key, which starts sk_test_: copy that one",
    );
    expect(world.prompts.filter((question) => question.includes("Clerk secret key"))).toHaveLength(
      2,
    );
    expect(world.workers.get("vela")?.get("CLERK_SECRET_KEY")).toBe(SECRETS.clerk);
    expect(leaks(world)).toEqual([]);
  });

  it("fails the check when /v1/me answers 503, 404, or a 401 that is not the API's, without a token", async () => {
    const world = newWorld("staging", { api: "on" });
    await setUp(world);
    world.workers.get("vela")?.delete("CLERK_SECRET_KEY");
    resetLog(world);
    // The Workers stay deployed from the first run; the log reset forgets that.
    world.deployed.push("vela");

    expect(await setUp(world, "--from", "check")).toBe(1);
    expect(world.printed).toContain(
      "  FAILED GET https://vela.vela-light-staging.workers.dev/v1/me: HTTP 503, unavailable, expected 401 unauthenticated without a token: a 503 is the API refusing its own settings, and its log line api_config_refused names the variable",
    );
    expect(world.printed).toContain("1 of 5 checks failed (above)");

    world.apiFault = "not_found";
    resetLog(world);
    world.deployed.push("vela");

    expect(await setUp(world, "--from", "check")).toBe(1);
    expect(world.printed).toContain(
      "  FAILED GET https://vela.vela-light-staging.workers.dev/v1/me: HTTP 404, not_found, expected 401 unauthenticated without a token: a 404 is a deployed Worker with API_V1 off, or one from before /v1",
    );

    // A 401 without the API's own error body is something else answering on the API's path.
    world.apiFault = "foreign_401";
    resetLog(world);
    world.deployed.push("vela");

    expect(await setUp(world, "--from", "check")).toBe(1);
    expect(world.printed).toContain(
      "  FAILED GET https://vela.vela-light-staging.workers.dev/v1/me: HTTP 401, expected 401 unauthenticated without a token",
    );
  });

  it("lets no secret reach a printed line, a prompt, a command-line argument or a written file", async () => {
    const world = newWorld("staging");

    await setUp(world);
    // A second run takes the other paths: the saved token, kept secrets, a new webhook secret.
    const firstWebhookSecret = world.webhook?.secret ?? "";
    resetLog(world);
    await setUp(world);

    expect(world.printed.join("\n")).toContain("connecting with [hidden]");
    expect(leaks(world)).toEqual([]);
    expect(world.printed.join("\n")).not.toContain(firstWebhookSecret);
  });

  it("writes the staging token and account id to apps/worker/.env, and nothing else secret", async () => {
    const world = newWorld("staging");

    await setUp(world);

    expect(readDotEnv(world.files.get(".env") ?? "")).toEqual({
      CLOUDFLARE_API_TOKEN: SECRETS.cloudflareToken,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    });
    expect(world.writes.filter((write) => write.file === ".env")).toHaveLength(1);
  });

  it("refuses to save the staging token when git does not ignore apps/worker/.env", async () => {
    const world = newWorld("staging");
    world.gitIgnoresEnv = false;

    const code = await setUp(world);

    expect(code).toBe(1);
    expect(world.files.has(".env")).toBe(false);
    expect(world.queues.size).toBe(0);
    expect(world.printed.join("\n")).toContain("git does not ignore apps/worker/.env");
    expect(leaks(world)).toEqual([]);
  });

  it("saves nothing for production, warns that production deploys go through CI, and leaks nothing", async () => {
    const world = newWorld("production");

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.writes.map((write) => write.file)).not.toContain(".env");
    expect(world.commands.filter((command) => command.tool === "git")).toEqual([]);
    expect(world.printed.join("\n")).toContain("go through the GitHub deploy workflow");
    expect([...world.queues]).toContain("vela-dead-letter-production");
    expect(world.webhook?.url).toBe("https://vela.vela-light.workers.dev/webhooks/telegram");
    expect(leaks(world)).toEqual([]);
  });

  it("flags, as a leak, a key read at a prompt that shows it, and refuses Enter read hidden", async () => {
    const world = newWorld("staging");
    const io = fakeIo(world);

    await expect(io.ask("  Cloudflare API token: ")).rejects.toThrow();
    await expect(io.askHidden("  When Access is applied, press Enter: ")).rejects.toThrow();

    expect(leaks(world)).toEqual([
      "Cloudflare API token: read shown, must be hidden",
      "When Access is applied: read hidden, must be shown",
    ]);
  });

  // Cloudflare shows the token once, so the clipboard still holds it at the Account ID prompt.
  it("never shows a token pasted at the Account ID prompt, and shows the account id once checked", async () => {
    const world = newWorld("production");
    world.firstAnswers = [["Account ID", SECRETS.cloudflareToken]];

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.printed).toContain("  An account ID is 32 characters of 0-9 and a-f");
    expect(world.printed).toContain(`  Account ID: ${ACCOUNT_ID}`);
    expect(world.printed).toContain(`  Team domain: ${TEAM_DOMAIN}`);
    expect(leaks(world)).toEqual([]);
  });

  it("goes on in an account with another name only when the environment's name is typed", async () => {
    const world = newWorld("staging");
    world.accountName = "Timur's own account";
    world.firstAnswers = [["This account is named", "yes"]];

    const refused = await setUp(world);

    expect(refused).toBe(1);
    expect(world.printed.join("\n")).toContain(
      `Stopped: "Timur's own account" is not the staging account`,
    );
    expect(world.writes).toEqual([]);
    expect(world.queues.size).toBe(0);

    resetLog(world);
    expect(await setUp(world), world.printed.join("\n")).toBe(0);
  });

  it("stops when the account's workers.dev subdomain is not the wrangler files', saving nothing", async () => {
    const world = newWorld("staging");
    world.subdomain = "someone-else";

    const code = await setUp(world);

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain(
      "The account's workers.dev subdomain is someone-else, but the wrangler files are built on vela-light-staging",
    );
    expect(world.writes).toEqual([]);
    expect(world.files.has(".env")).toBe(false);
    expect(world.queues.size).toBe(0);
  });

  // Reading the chat id needs getUpdates, which Telegram answers only once the webhook is gone.
  it("stops rather than read the chat id of a bot that already has a webhook, which it leaves as it was", async () => {
    const world = newWorld("staging");
    const webhook = {
      url: "https://vela.vela-light-staging.workers.dev/webhooks/telegram",
      secret: "families-webhook-secret",
    };
    world.webhook = webhook;

    const code = await setUp(world);

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain("@VelaStagingTestBot already has a webhook");
    expect(world.prompts.filter((question) => question.includes("send /start"))).toEqual([]);
    expect(world.requests.filter((request) => request.url.endsWith("/getUpdates"))).toEqual([]);
    expect(world.webhook).toEqual(webhook);
    expect(world.workers.has("vela")).toBe(false);
    expect(leaks(world)).toEqual([]);
  });

  // --from webhook skips the telegram step, whose placeholder fill would also refuse another bot.
  it("refuses, from the webhook step, a token for another bot than wrangler.jsonc names, and changes nothing", async () => {
    const world = newWorld("staging");
    await setUp(world);
    const webhook = world.webhook;
    const secrets = new Map(world.workers.get("vela"));
    world.botUsername = BOT_USERNAMES.production;
    resetLog(world);

    const code = await setUp(world, "--from", "webhook");

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain(
      "This token belongs to @VelaLightBot, but wrangler.jsonc names @VelaStagingTestBot for staging",
    );
    expect(world.commands).toEqual([]);
    expect(world.requests.filter((request) => /\/set\w+$/.test(request.url))).toEqual([]);
    expect(world.webhook).toEqual(webhook);
    expect(world.workers.get("vela")).toEqual(secrets);
  });

  it("says pending updates were kept, and names no flag the setup's own arguments refuse", async () => {
    const world = newWorld("staging");

    await setUp(world);

    expect(world.printed).toContain("  Pending updates: kept");
    expect(world.printed.join("\n")).not.toContain("--drop-pending-updates");
    expect(() => parseArguments(["--env", "staging", "--drop-pending-updates"])).toThrow(
      SetupError,
    );
  });

  it("refuses production credentials that apps/worker/.env holds", async () => {
    const world = newWorld("production");
    world.files.set(".env", `CLOUDFLARE_ACCOUNT_ID=${ACCOUNT_ID}\n`);

    const code = await setUp(world);

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain("must never be on this machine");
    expect(world.queues.size).toBe(0);
  });

  // The line below lists the resources of a staging with media storage off, which is said here
  // rather than taken from the repository's own files: staging's storage there is on since 26
  // September 2026, so a first run that reads them creates a bucket too, and this test is not about
  // that.
  it("skips every resource, placeholder and secret that already exists when run again", async () => {
    const world = newWorld("staging", { media: "off" });
    await setUp(world);
    resetLog(world);

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    expect(
      world.requests.filter(
        (request) =>
          request.method !== "GET" && request.url.startsWith("https://api.cloudflare.com/"),
      ),
    ).toEqual([]);
    expect(world.writes).toEqual([]);
    expect(world.prompts.map((question) => question.trim())).toEqual([
      "Neon connection string (hidden):",
      "Telegram bot token (hidden):",
    ]);
    expect(
      world.commands
        .filter((command) => command.args[0] === "secret")
        .map((command) => command.args[2]),
    ).toEqual(["TELEGRAM_WEBHOOK_SECRET"]);
    // The webhook secret the Worker checks is the one Telegram now sends.
    expect(world.workers.get("vela")?.get("TELEGRAM_WEBHOOK_SECRET")).toBe(world.webhook?.secret);
    // No bucket: media storage is off above, so none was created the first time either.
    expect(world.printed).toContain(
      "resources: already there: vela-outbound-staging, vela-media-staging, vela-understand-staging, vela-dead-letter-staging",
    );
    expect(world.printed.filter((line) => line.includes("nothing to do"))).toHaveLength(2);
  });

  it("turns caching off on a Hyperdrive configuration that already exists with it on", async () => {
    const world = newWorld("staging");
    await setUp(world);
    for (const config of world.hyperdrives) {
      config.caching = { disabled: false };
    }
    resetLog(world);

    const code = await setUp(world, "--from", "database");

    expect(code, world.printed.join("\n")).toBe(0);
    expect(world.hyperdrives.map((config) => config.caching.disabled)).toEqual([true]);
  });

  it("resumes at the step named by --from", async () => {
    const world = newWorld("staging");
    await setUp(world);
    resetLog(world);

    const code = await setUp(world, "--from", "deploy");

    expect(code).toBe(0);
    expect(
      world.printed.filter((line) => /^\w+: /.test(line)).map((line) => line.split(":")[0]),
    ).toEqual(["deploy", "access", "webhook", "check"]);
    expect(world.migrations).toBe(0);
    expect(world.requests.map((request) => request.url).join("\n")).not.toMatch(
      /queues|hyperdrive|r2/,
    );
    expect(world.commands.map((command) => command.args.slice(0, 2).join(" "))).toEqual([
      "deploy --env",
      "deploy -c",
      "secret put",
    ]);
  });

  it("hides a secret that a failing service quotes in its refusal, and says where to resume", async () => {
    const world = newWorld("staging");
    world.hyperdriveError = `password authentication failed for ${DATABASE_URL}`;

    const code = await setUp(world);

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain("password authentication failed for [hidden]");
    expect(world.printed.at(-1)).toBe(
      "When it is fixed, resume: pnpm --filter @vela/worker run setup -- --env staging --from database",
    );
    expect(leaks(world)).toEqual([]);
  });

  it("fails the check when the admin Worker answers 200 without Access", async () => {
    const world = newWorld("staging");
    await setUp(world);
    world.accessOn = false;
    world.adminOpenWithoutAccess = true;
    resetLog(world);

    const code = await setUp(world, "--from", "check");

    expect(code).toBe(1);
    expect(world.printed.join("\n")).toContain(
      "FAILED GET https://vela-admin.vela-light-staging.workers.dev/admin: HTTP 200",
    );
  });

  // A Worker deployed minutes ago may not have reconciled yet; one that reconciled and stopped has.
  it("passes /healthz before the first reconciliation, says when to look again, and names the watchdog", async () => {
    const world = newWorld("staging");

    const code = await setUp(world);

    expect(code, world.printed.join("\n")).toBe(0);
    const printed = world.printed.join("\n");
    expect(printed).toContain(
      "ok     GET https://vela.vela-light-staging.workers.dev/healthz: HTTP 503, no_reconcile_yet: the first reconciliation comes within 15 minutes of the deploy",
    );
    expect(printed).toContain(
      `set staging's "enabled" to true in .github/watchdog.json, so the watchdog emails you when it stops`,
    );
    expect(printed).not.toMatch(/healthchecks/i);
    expect(world.prompts.join("\n")).not.toMatch(/healthchecks|ping url/i);
  });

  // Two Neon projects, not two branches of one: staging's string can never open production's data.
  it.each([
    ["staging", "vela-staging"],
    ["production", "vela"],
  ] as const)(
    "sends %s's founder to its own Neon project, %s, on Neon's default branch, database and role",
    async (environment, project) => {
      const world = newWorld(environment);

      const code = await setUp(world);

      expect(code, world.printed.join("\n")).toBe(0);
      expect(world.printed).toContain(
        `  Neon console (console.neon.tech), project ${project} (${environment}'s own project): select Connect.`,
      );
      expect(world.printed).toContain(
        "  Keep the default branch the dialog selects (production or main), database neondb and role neondb_owner, turn Connection pooling off, and copy the connection string.",
      );
      expect(world.printed).toContain(`  Applying the migrations to the Neon project ${project}.`);
      expect(world.printed.join("\n")).not.toMatch(/branch staging|staging branch/);
    },
  );

  it("ends staging with the dogfooding week, and production with the first family living in Taiwan once that week has passed", async () => {
    const staging = newWorld("staging");
    const production = newWorld("production");

    expect(await setUp(staging), staging.printed.join("\n")).toBe(0);
    expect(await setUp(production), production.printed.join("\n")).toBe(0);

    const stagingNext = staging.printed.slice(staging.printed.indexOf("  Next:"));
    const productionNext = production.printed.slice(production.printed.indexOf("  Next:"));
    expect(stagingNext[1]).toBe(
      `  1. The dogfooding week (build plan 1.10): from your own Telegram account, open @VelaStagingTestBot and send /start to set up the test family as its organiser. The kept-light member is your second Telegram account, or a friend living in Taiwan once the data processing terms are done, with scripted test content only (plan/materials/pilot/README.md, "Before any family").`,
    );
    expect(productionNext[1]).toBe(
      `  1. No family yet: the first family living in Taiwan is onboarded only once the dogfooding week on staging has passed and the checks in plan/materials/pilot/README.md, "Before any family", are done. Its organiser sends /start to @VelaLightBot ("Onboarding a family, in order").`,
    );
    expect([...stagingNext, ...productionNext].join("\n")).not.toMatch(/your own family/);
  });

  it("passes /healthz once reconciliation runs, and fails it when reconciliation stopped", async () => {
    const world = newWorld("staging");
    await setUp(world);
    world.health = "ok";
    resetLog(world);
    // The Workers stay deployed from the first run; the log reset forgets that.
    world.deployed.push("vela");

    expect(await setUp(world, "--from", "check"), world.printed.join("\n")).toBe(0);
    expect(world.printed).toContain(
      "  ok     GET https://vela.vela-light-staging.workers.dev/healthz: HTTP 200, ok: reconciliation is running",
    );

    world.health = "stale";
    resetLog(world);
    world.deployed.push("vela");

    expect(await setUp(world, "--from", "check")).toBe(1);
    expect(world.printed).toContain(
      "  FAILED GET https://vela.vela-light-staging.workers.dev/healthz: HTTP 503, stale, expected 200 ok, or 503 no_reconcile_yet before the first reconciliation",
    );
  });

  // The admin Worker's invite links open the same bot the pilot Worker's webhook belongs to.
  it("writes the bot's username to both wrangler files, and fills the admin file from the pilot file on a later run", async () => {
    const world = newWorld("staging");
    await setUp(world);
    const placeholder = "PLACEHOLDER_STAGING_BOT_USERNAME";
    const admin = world.files.get("wrangler.admin.jsonc") ?? "";
    world.files.set(
      "wrangler.admin.jsonc",
      admin.replace('"VelaStagingTestBot"', `"${placeholder}"`),
    );
    resetLog(world);

    const code = await setUp(world, "--from", "telegram");

    expect(code, world.printed.join("\n")).toBe(0);
    expect(configOf(world).adminBotUsername).toBe("VelaStagingTestBot");
    expect(world.writes.map((write) => write.file)).toEqual(["wrangler.admin.jsonc"]);
    expect(
      world.prompts.filter((question) => question.includes("Telegram bot token")),
    ).toHaveLength(1);
    expect(world.printed).toContain(
      "telegram: @VelaStagingTestBot written to wrangler.admin.jsonc; vela already holds its token, webhook secret and your chat id",
    );
  });

  it("refuses to deploy while a placeholder for the environment is left", async () => {
    const world = newWorld("staging");

    const code = await setUp(world, "--from", "deploy");

    expect(code).toBe(1);
    expect(world.deployed).toEqual([]);
    expect(world.printed.join("\n")).toContain("PLACEHOLDER_HYPERDRIVE_ID_STAGING");
  });

  it("refuses to prompt in a terminal that cannot hide what is typed", async () => {
    const world = newWorld("staging");

    const code = await runSetup(["--env", "staging"], { ...fakeIo(world), interactive: false });

    expect(code).toBe(1);
    expect(world.prompts).toEqual([]);
  });
});

describe("the arguments", () => {
  it("take the environment and a step to start from, past pnpm's --", () => {
    expect(parseArguments(["--", "--env", "production", "--from", "webhook"])).toEqual({
      kind: "run",
      environment: "production",
      from: "webhook",
    });
    expect(parseArguments(["--env", "staging"])).toEqual({
      kind: "run",
      environment: "staging",
      from: "account",
    });
    expect(parseArguments(["--help"])).toEqual({ kind: "help" });
  });

  it.each([
    [[]],
    [["--env", "development"]],
    [["--env", "staging", "--from", "everything"]],
    [["--env", "staging", "--env", "production"]],
  ])("refuse %j", (argv) => {
    expect(() => parseArguments(argv)).toThrow(SetupError);
  });

  // A secret pasted onto the command line by mistake must not be printed back as well.
  it("refuse an unknown argument without quoting it", () => {
    let message = "";
    try {
      parseArguments(["--env", "staging", SECRETS.botToken]);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("Argument 3");
    expect(message).not.toContain(SECRETS.botToken);
  });

  it("resume a plan at the step named, in order", () => {
    expect(stepsFrom("account")).toEqual(STEPS);
    expect(stepsFrom("webhook")).toEqual(["webhook", "check"]);
  });
});

describe("the wrangler files", () => {
  it("lose their comments but keep // inside strings", () => {
    const text = '{\n  // a comment\n  "url": "https://x.workers.dev/a", /* block */ "n": 1\n}';

    expect(JSON.parse(stripJsonComments(text, "test.jsonc"))).toEqual({
      url: "https://x.workers.dev/a",
      n: 1,
    });
  });

  // `aiProvider` is left out here: pinning staging's switch against the real files would make the
  // commit that switches it on red, and that commit has to pass CI before it can be deployed and
  // merged. `mediaStorage` and its buckets are left out too, and given below for both environments
  // as src/wrangler-config.test.ts pins them; both values of staging's switches are read from
  // built texts further down.
  it.each(["staging", "production"] as const)(
    "give %s's queues, Workers and hosts as wrangler reads them",
    (environment) => {
      const config = readEnvironmentConfig(wranglerTexts(), environment);

      expect(config).toMatchObject({
        pilotWorker: "vela",
        adminWorker: "vela-admin",
        queues: [
          `vela-outbound-${environment}`,
          `vela-media-${environment}`,
          `vela-understand-${environment}`,
          `vela-dead-letter-${environment}`,
        ],
        pilotOrigin: `https://vela.${SUBDOMAINS[environment]}.workers.dev`,
        adminOrigin: `https://vela-admin.${SUBDOMAINS[environment]}.workers.dev`,
        workersDevSubdomain: SUBDOMAINS[environment],
      });
    },
  );

  // Both environments keep media, each in a bucket of its own: production because config.ts refuses
  // to start it with storage off, staging since R2 was enabled on its account on 26 September 2026.
  // The bucket each names has to be the one the resources step creates.
  it.each(["staging", "production"] as const)(
    "give %s's media storage and the bucket it keeps media in",
    (environment) => {
      expect(readEnvironmentConfig(wranglerTexts(), environment)).toMatchObject({
        mediaStorage: "r2",
        buckets: [`vela-media-${environment}`],
      });
    },
  );

  it.each(["anthropic", "off"] as const)(
    "give staging's AI_PROVIDER when both Workers set it to %s",
    (provider) => {
      expect(
        readEnvironmentConfig(wranglerTexts({ ai: { staging: provider } }), "staging").aiProvider,
      ).toBe(provider);
    },
  );

  // One Worker calling Anthropic while the other is off would need a key the setup never asked for.
  it("refuse Workers whose AI_PROVIDER differs, or is neither anthropic nor off", () => {
    const texts = wranglerTexts({ ai: { staging: "off" } });
    const differing = {
      ...texts,
      admin: texts.admin.replace('"AI_PROVIDER": "off"', '"AI_PROVIDER": "anthropic"'),
    };
    const unknown = {
      pilot: texts.pilot.replace('"AI_PROVIDER": "off"', '"AI_PROVIDER": "gemini"'),
      admin: texts.admin.replace('"AI_PROVIDER": "off"', '"AI_PROVIDER": "gemini"'),
    };

    for (const broken of [differing, unknown]) {
      expect(() => readEnvironmentConfig(broken, "staging")).toThrow(
        /must set AI_PROVIDER for staging to the same value, one of anthropic, off/,
      );
    }
  });

  it.each(["r2", "off"] as const)(
    "give staging's MEDIA_STORAGE, and the bucket it agrees with, when it is %s",
    (storage) => {
      const config = readEnvironmentConfig(
        wranglerTexts({ media: { staging: storage } }),
        "staging",
      );

      expect(config.mediaStorage).toBe(storage);
      expect(config.buckets).toEqual(storage === "r2" ? ["vela-media-staging"] : []);
    },
  );

  // A binding to a bucket that does not exist fails the deploy, and "r2" without one would leave
  // the Worker refusing to start, so the var and the binding are read as one.
  it("refuse a MEDIA_STORAGE that disagrees with the r2_buckets binding, or is neither r2 nor off", () => {
    const off = wranglerTexts({ media: { staging: "off" } });
    const on = wranglerTexts({ media: { staging: "r2" } });
    const boundWhileOff = {
      ...off,
      pilot: off.pilot.replace(
        '"r2_buckets": []',
        '"r2_buckets": [{ "binding": "MEDIA_BUCKET", "bucket_name": "vela-media-staging" }]',
      ),
    };
    // The first r2_buckets in either text is staging's, which is the environment read below.
    const unboundWhileOn = {
      ...on,
      pilot: on.pilot.replace(/"r2_buckets": \[[^\]]*\]/, '"r2_buckets": []'),
    };
    const unknown = {
      ...off,
      pilot: off.pilot.replace('"MEDIA_STORAGE": "off"', '"MEDIA_STORAGE": "s3"'),
    };

    expect(() => readEnvironmentConfig(boundWhileOff, "staging")).toThrow(
      /MEDIA_STORAGE is off for staging, so wrangler.jsonc must bind no R2 bucket/,
    );
    expect(() => readEnvironmentConfig(unboundWhileOn, "staging")).toThrow(
      /MEDIA_STORAGE is r2 for staging, so wrangler.jsonc must bind exactly one R2 bucket/,
    );
    expect(() => readEnvironmentConfig(unknown, "staging")).toThrow(
      /must set MEDIA_STORAGE for staging to one of r2, off/,
    );
  });

  // Unlike the switches above, both environments' API_V1 are pinned already, by
  // src/wrangler-config.test.ts (ADR-29): staging on, production off until a new ADR.
  it("give each environment's API_V1 as the real files set it: staging on, production off", () => {
    expect(readEnvironmentConfig(wranglerTexts(), "staging").apiV1).toBe("on");
    expect(readEnvironmentConfig(wranglerTexts(), "production").apiV1).toBe("off");
  });

  it.each(["on", "off"] as const)(
    "give staging's API_V1 when the pilot file sets it to %s",
    (apiV1) => {
      expect(
        readEnvironmentConfig(wranglerTexts({ api: { staging: apiV1 } }), "staging").apiV1,
      ).toBe(apiV1);
    },
  );

  // The Worker would answer every /v1 request with 503 (ConfigError:API_V1).
  it("refuse an API_V1 that is missing, or neither on nor off", () => {
    const texts = wranglerTexts({ api: { staging: "on" } });
    // The first API_V1 in the pilot text is staging's, which is the environment read below.
    const missing = { ...texts, pilot: texts.pilot.replace('"API_V1": "on"', '"API_V2": "on"') };
    const unknown = { ...texts, pilot: texts.pilot.replace('"API_V1": "on"', '"API_V1": "yes"') };

    for (const broken of [missing, unknown]) {
      expect(() => readEnvironmentConfig(broken, "staging")).toThrow(
        /wrangler.jsonc must set API_V1 for staging to one of on, off/,
      );
    }
  });

  // Both are off until the staging loop (05 §8, step 8), and production is pinned off by
  // src/wrangler-config.test.ts; the commit that turns staging on changes this with the files.
  it("give each environment's LINE_CHANNEL as the real files set it: off in staging and production", () => {
    expect(readEnvironmentConfig(wranglerTexts(), "staging").lineChannel).toBe("off");
    expect(readEnvironmentConfig(wranglerTexts(), "production").lineChannel).toBe("off");
  });

  it.each(["on", "off"] as const)(
    "give staging's LINE_CHANNEL %s, with LINE's inbound queue among the queues exactly when on",
    (line) => {
      const config = readEnvironmentConfig(wranglerTexts({ line: { staging: line } }), "staging");

      expect(config.lineChannel).toBe(line);
      expect(config.queues.includes("vela-inbound-staging")).toBe(line === "on");
    },
  );

  // A binding to a queue that does not exist fails the deploy, and LINE on without one leaves the
  // Worker refusing to start (ConfigError:INBOUND_QUEUE), so the var and the binding are one.
  it("refuse a LINE_CHANNEL that disagrees with the inbound queue binding", () => {
    const off = wranglerTexts({ line: { staging: "off" } });
    const on = wranglerTexts({ line: { staging: "on" } });
    const unboundWhileOn = {
      pilot: withLineVar(off.pilot, "staging", "on"),
      admin: withLineVar(off.admin, "staging", "on"),
    };
    const boundWhileOff = {
      pilot: withLineVar(on.pilot, "staging", "off"),
      admin: withLineVar(on.admin, "staging", "off"),
    };
    const boundToAnotherQueue = {
      ...on,
      pilot: editedBlock(on.pilot, "staging", (block) => {
        block.queues = JSON.parse(
          JSON.stringify(block.queues).replaceAll("vela-inbound-staging", "vela-inbound"),
        );
      }),
    };

    for (const broken of [unboundWhileOn, boundToAnotherQueue]) {
      expect(() => readEnvironmentConfig(broken, "staging")).toThrow(
        /LINE_CHANNEL is on for staging, so wrangler.jsonc must bind INBOUND_QUEUE to vela-inbound-staging and consume it/,
      );
    }
    expect(() => readEnvironmentConfig(boundWhileOff, "staging")).toThrow(
      /LINE_CHANNEL is off for staging, so wrangler.jsonc must bind no inbound queue/,
    );
  });

  // One Worker naming LINE's account while the other does not speak it would send invite links to
  // an account whose webhook answers 404.
  it("refuse Workers whose LINE_CHANNEL differs, is missing, or is neither on nor off", () => {
    const texts = wranglerTexts({ line: { staging: "off" } });
    const broken = [
      { ...texts, admin: withLineVar(texts.admin, "staging", "on") },
      { ...texts, admin: withLineVar(texts.admin, "staging", undefined) },
      {
        pilot: withLineVar(texts.pilot, "staging", undefined),
        admin: withLineVar(texts.admin, "staging", undefined),
      },
      {
        pilot: withLineVar(texts.pilot, "staging", "maybe"),
        admin: withLineVar(texts.admin, "staging", "maybe"),
      },
    ];

    for (const candidate of broken) {
      expect(() => readEnvironmentConfig(candidate, "staging")).toThrow(
        /must set LINE_CHANNEL for staging to the same value, one of on, off/,
      );
    }
  });

  const commented = [
    "{",
    "  // Every id the founder has not created yet is a PLACEHOLDER.",
    '  "env": {',
    '    "staging": { "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "PLACEHOLDER_HYPERDRIVE_ID_STAGING" }] },',
    "    // Production binds its own configuration.",
    '    "production": { "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION" }] }',
    "  }",
    "}",
  ].join("\n");
  const fill = {
    file: "wrangler.jsonc",
    text: commented,
    environment: "staging",
    current: "PLACEHOLDER_HYPERDRIVE_ID_STAGING",
    placeholder: "PLACEHOLDER_HYPERDRIVE_ID_STAGING",
    value: HYPERDRIVE_ID,
    what: "Hyperdrive id",
  } as const;

  it("get the created value over that environment's placeholder, comments and all", () => {
    const result = fillPlaceholder(fill);

    expect(result.changed).toBe(true);
    expect(result.text).toBe(commented.replace("PLACEHOLDER_HYPERDRIVE_ID_STAGING", HYPERDRIVE_ID));
    expect(result.text).toContain("PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION");
  });

  it("stay as they are when they already hold the value", () => {
    expect(fillPlaceholder({ ...fill, current: HYPERDRIVE_ID })).toEqual({
      text: commented,
      changed: false,
    });
  });

  it("are not overwritten when the placeholder is gone and a different id is there", () => {
    expect(() => fillPlaceholder({ ...fill, current: "0000000000000000000000000000beef" })).toThrow(
      /already holds a different Hyperdrive id for staging/,
    );
  });

  it("refuse a value another environment already uses", () => {
    const production = commented.replace("PLACEHOLDER_HYPERDRIVE_ID_PRODUCTION", HYPERDRIVE_ID);

    expect(() => fillPlaceholder({ ...fill, text: production })).toThrow(
      /already uses this Hyperdrive id for another environment/,
    );
  });
});

describe("secrets on screen", () => {
  it("are confirmed by their length only", () => {
    expect(received("a1-密碼")).toBe("received, 5 characters");
  });

  it("are replaced wherever a line quotes them, as typed or URL-encoded", () => {
    const secret = "a b/c";

    expect(redact(`x ${secret} y ${encodeURIComponent(secret)}`, [secret])).toBe(
      "x [hidden] y [hidden]",
    );
  });

  it("are typed as keys: a paste, Backspace, arrows and bracketed paste markers, then Enter", () => {
    let line = typeInto(EMPTY_LINE, "[200~abc[201~");
    line = typeInto(line, "d[De");

    expect(line).toEqual({ value: "abce", state: "typing" });
    expect(typeInto(line, "\r")).toEqual({ value: "abce", state: "entered" });
    expect(typeInto(line, "")).toEqual({ value: "", state: "cancelled" });
  });

  it("include a webhook secret of 48 letters and digits that skips biased bytes", () => {
    const bytes = [255, 250, 248, 0, 61, 62];
    let call = 0;
    const secret = generateWebhookSecret((length) =>
      Uint8Array.from({ length }, () => bytes[call++ % bytes.length] ?? 0),
    );

    expect(secret).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(secret.startsWith("A9A")).toBe(true);
  });

  it("are refused, without being quoted, when a connection string is the pooled one", () => {
    const pooled = DATABASE_URL.replace("ep-quiet-sky-a1b2c3", "ep-quiet-sky-a1b2c3-pooler");

    expect(parseConnectionString(DATABASE_URL)).toEqual({
      scheme: "postgresql",
      host: "ep-quiet-sky-a1b2c3.ap-southeast-1.aws.neon.tech",
      port: 5432,
      database: "neondb",
      user: "neondb_owner",
      password: SECRETS.databasePassword,
    });
    expect(() => parseConnectionString(pooled)).toThrow(/pooled/);
    expect(() => parseConnectionString(pooled)).not.toThrow(SECRETS.databasePassword);
  });

  it("travel to Cloudflare in the Authorization header, never in the URL", () => {
    const request = cloudflareRequest(SECRETS.cloudflareToken, cloudflareApi.account(ACCOUNT_ID));

    expect(request.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`);
    expect(new Headers(request.init.headers).get("authorization")).toBe(
      `Bearer ${SECRETS.cloudflareToken}`,
    );
  });

  it("are not in a failure that is not the script's own: only its class and code are", () => {
    const failure = describeFailure(new TypeError(`fetch ${SECRETS.botToken}`), []);

    expect(failure).toBe("Setup failed: TypeError");
  });
});

describe("the values the setup keeps", () => {
  it("merge into an existing .env without touching other lines", () => {
    const merged = mergeDotEnv("# mine\nOTHER=1\nCLOUDFLARE_API_TOKEN=old\n", {
      CLOUDFLARE_API_TOKEN: "new",
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    });

    expect(merged).toBe(
      `# mine\nOTHER=1\nCLOUDFLARE_API_TOKEN=new\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT_ID}\n`,
    );
    expect(readDotEnv(mergeDotEnv(null, { A: "1" }))).toEqual({ A: "1" });
  });

  // The `git check-ignore` the account step runs sees only the one name it writes. A founder who
  // copies that file to read the token elsewhere (.env.txt, .env.bak) makes a file git never
  // matched against `.env`, and `git add -A` would then commit the staging token with it, so
  // apps/worker/.gitignore covers the whole family of names rather than the single one.
  it("keep the token where git ignores every .env of this Worker, not only the name it writes", () => {
    const rules = inject("workerIgnoreRules");

    expect(rules).toContain(".env");
    expect(rules).toContain(".env.*");
  });

  it("put this run's Telegram values, keep what Workers hold, and prompt the rest for every reader", () => {
    const plan = planSecrets(
      {
        pilot: new Set(["DEEPGRAM_API_KEY", "ANTHROPIC_API_KEY"]),
        admin: new Set<string>(),
      },
      new Map([["TELEGRAM_BOT_TOKEN", "token"]]),
      "anthropic",
      "on",
    );

    expect(plan.map((entry) => [entry.name, entry.source, entry.workers])).toEqual([
      ["TELEGRAM_BOT_TOKEN", "run", ["pilot"]],
      ["TELEGRAM_WEBHOOK_SECRET", "missing", ["pilot"]],
      ["ADMIN_CONVERSATION_ID", "missing", ["pilot"]],
      ["ANTHROPIC_API_KEY", "prompt", ["pilot", "admin"]],
      ["CLERK_SECRET_KEY", "prompt", ["pilot"]],
      ["DEEPGRAM_API_KEY", "kept", []],
    ]);
  });

  it("neither ask for nor put the Anthropic key while AI is off, even on a Worker without it", () => {
    const plan = planSecrets(
      { pilot: new Set(["DEEPGRAM_API_KEY"]), admin: new Set<string>() },
      new Map(),
      "off",
      "on",
    );

    expect(plan.find((entry) => entry.name === "ANTHROPIC_API_KEY")).toEqual({
      name: "ANTHROPIC_API_KEY",
      workers: [],
      source: "ai_off",
    });
    expect(plan.find((entry) => entry.name === "DEEPGRAM_API_KEY")?.source).toBe("kept");
  });

  // ADR-29: only the pilot Worker serves /v1, and with API_V1 off nothing reads Clerk's key.
  it("ask for the Clerk key for the pilot Worker alone while the API is on, and neither ask for nor put it while off", () => {
    const clerk = (pilot: readonly string[], apiV1: ApiSwitch) =>
      planSecrets(
        { pilot: new Set(pilot), admin: new Set<string>() },
        new Map(),
        "anthropic",
        apiV1,
      ).find((entry) => entry.name === "CLERK_SECRET_KEY");

    expect(clerk([], "off")).toEqual({ name: "CLERK_SECRET_KEY", workers: [], source: "api_off" });
    expect(clerk(["CLERK_SECRET_KEY"], "off")).toEqual({
      name: "CLERK_SECRET_KEY",
      workers: [],
      source: "api_off",
    });
    expect(clerk([], "on")).toEqual({
      name: "CLERK_SECRET_KEY",
      workers: ["pilot"],
      source: "prompt",
    });
    expect(clerk(["CLERK_SECRET_KEY"], "on")).toEqual({
      name: "CLERK_SECRET_KEY",
      workers: [],
      source: "kept",
    });
  });

  it("read the private chats that sent /start, newest first and once each, and the last update", () => {
    const update = (id: number, chat: number, type: string, text: string, firstName: string) => ({
      update_id: id,
      message: { chat: { id: chat, type, first_name: firstName }, text },
    });

    expect(
      startChats([
        update(1, 10, "private", "/start", "Timur"),
        update(2, -20, "group", "/start", "Family"),
        update(3, 30, "private", "hello", "Chatty"),
        update(4, 40, "private", "/start", "Stranger"),
        update(5, 10, "private", "/start", "Timur"),
        { update_id: 6, my_chat_member: {} },
      ]),
    ).toEqual({
      chats: [
        { chatId: "10", firstName: "Timur" },
        { chatId: "40", firstName: "Stranger" },
      ],
      lastUpdateId: 6,
    });
  });

  it("accept an Access team domain pasted as a link", () => {
    expect(normalizeTeamDomain(`https://${TEAM_DOMAIN}/`)).toBe(TEAM_DOMAIN);
    expect(() => normalizeTeamDomain("vela.example.com")).toThrow(SetupError);
  });
});
