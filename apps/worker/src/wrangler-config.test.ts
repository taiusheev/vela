import { describe, expect, inject, it } from "vitest";
import { API_ADDRESS_LIMIT } from "./api-runtime.ts";
import { AI_OFF_EFFECTS, MEDIA_OFF_EFFECTS } from "./deps.ts";
import { NOTICE_LANGS, NOTICE_PATHS, type NoticeLang } from "./notices.ts";
import { NIGHTLY_CRON, RECONCILE_CRON } from "./pilot-worker.ts";

/**
 * The workers.dev subdomain each Cloudflare account chose at sign-up (H3). This is the test's one
 * copy of it: every host below is derived from it, so if an account's subdomain turns out
 * different, this table changes, and the tests then fail on every other place that names it: the
 * three URL vars of that environment in wrangler.jsonc, PUBLIC_BASE_URL in wrangler.admin.jsonc,
 * and every workers.dev link in the Markdown of plan/materials/pilot, the two privacy notices'
 * links to each other included, after which `pnpm --filter @vela/worker notices` regenerates
 * src/notices.generated.ts (src/notices.test.ts fails until it does). No test sees the privacy
 * policy link in @BotFather, the Telegram webhook, which the setup script's `webhook` step
 * registers again (`pnpm --filter @vela/worker run setup -- --env <environment> --from webhook`),
 * the watchdog's URL in .github/watchdog.json, or the documents that write the hosts out. The
 * header of wrangler.jsonc keeps the same list.
 */
const WORKERS_DEV_SUBDOMAINS = {
  staging: "vela-light-staging",
  production: "vela-light",
} as const;

const NAMES = { pilot: "vela", admin: "vela-admin" } as const;
const DEV_NAMES = { pilot: "vela-dev", admin: "vela-admin-dev" } as const;

const DEPLOYED = ["staging", "production"] as const;

/**
 * A deployed Worker's one address (H3): `https://<Worker name>.<subdomain>.workers.dev`, which is
 * what families, Telegram, and the founder's browser are sent to.
 */
function hostOf(worker: keyof typeof NAMES, environment: (typeof DEPLOYED)[number]): string {
  return `https://${NAMES[worker]}.${WORKERS_DEV_SUBDOMAINS[environment]}.workers.dev`;
}

/**
 * A Hyperdrive id once the founder has created the configuration: 32 lowercase hex characters, like
 * the id `wrangler hyperdrive create` prints in Cloudflare's Hyperdrive get-started guide.
 */
const HYPERDRIVE_ID = /^[0-9a-f]{32}$/;

/**
 * The vars that may still hold a placeholder in a deployed environment, until the founder creates
 * what they name. Filled is allowed too: infra/README.md section 11 fills them before the first
 * deploy, and config.ts refuses to start the Worker while one is left.
 */
const MAY_BE_PLACEHOLDERS: Readonly<Record<keyof typeof NAMES, readonly string[]>> = {
  pilot: ["TELEGRAM_BOT_USERNAME"],
  admin: ["TELEGRAM_BOT_USERNAME"],
};

/** The var that links each notice, as the pilot Worker's `Config` reads it (config.ts). */
const NOTICE_URL_VARS: Readonly<Record<NoticeLang, string>> = {
  en: "PRIVACY_NOTICE_URL_EN",
  "zh-TW": "PRIVACY_NOTICE_URL_ZH_TW",
};

/**
 * A workers.dev address as the pilot pack writes one, in either scheme and any case, ending before
 * the punctuation around it.
 */
const WORKERS_DEV_URL = /https?:\/\/[\w.-]+\.workers\.dev[\w/-]*/gi;

function workersDevUrls(text: string): string[] {
  return [...text.matchAll(WORKERS_DEV_URL)].map((match) => match[0]);
}

const configs = inject("workerConfigs");

function configOf(
  worker: "pilot" | "admin",
  environment: "development" | "staging" | "production",
): (typeof configs)[number] {
  const found = configs.find(
    (config) => config.worker === worker && config.environment === environment,
  );
  if (found === undefined) {
    throw new Error(`no ${worker} configuration for ${environment}`);
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The entries of an array field, each a record, or none. */
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function doBindings(config: (typeof configs)[number]): Record<string, unknown>[] {
  return isRecord(config.durableObjects) ? records(config.durableObjects.bindings) : [];
}

function producers(config: (typeof configs)[number]): Record<string, unknown>[] {
  return isRecord(config.queues) ? records(config.queues.producers) : [];
}

function consumers(config: (typeof configs)[number]): Record<string, unknown>[] {
  return isRecord(config.queues) ? records(config.queues.consumers) : [];
}

/**
 * The opening comment of wrangler.jsonc, everything before its first key, as one line of prose:
 * without the `//` markers and line breaks, a phrase reads the same wherever its lines wrap.
 */
function pilotHeader(): string {
  const source = inject("pilotConfigSource");
  const firstKey = source.indexOf('"$schema"');
  if (firstKey === -1) {
    throw new Error("wrangler.jsonc has no $schema key to end its header");
  }
  return source
    .slice(0, firstKey)
    .split("\n")
    .map((line) => line.trim().replace(/^\/\/\s*/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
}

describe("the two Workers' configurations", () => {
  it("cover both Workers in every environment deploy.yml deploys, and development", () => {
    expect(configs.map(({ worker, environment }) => `${worker}:${environment}`)).toEqual([
      "pilot:development",
      "pilot:staging",
      "pilot:production",
      "admin:development",
      "admin:staging",
      "admin:production",
    ]);
  });

  it.each(DEPLOYED)("name the Workers vela and vela-admin in %s", (environment) => {
    expect(configOf("pilot", environment).name).toBe(NAMES.pilot);
    expect(configOf("admin", environment).name).toBe(NAMES.admin);
  });

  it("run the pilot and admin entry modules", () => {
    for (const environment of ["development", ...DEPLOYED] as const) {
      expect(String(configOf("pilot", environment).main)).toMatch(/\/src\/index\.ts$/);
      expect(String(configOf("admin", environment).main)).toMatch(/\/src\/admin-worker\.ts$/);
    }
  });

  // Each deployed Worker answers on its workers.dev address and nowhere else: no route, no custom
  // domain, and no preview URL, because every hostname a Worker answers on is one more to reason
  // about (Access on the admin Worker would cover a preview URL too).
  it.each(DEPLOYED)("serve %s on workers.dev only", (environment) => {
    for (const worker of ["pilot", "admin"] as const) {
      const config = configOf(worker, environment);
      expect(config.workersDev, worker).toBe(true);
      expect(config.previewUrls, worker).toBe(false);
      expect(config.routes ?? [], worker).toEqual([]);
    }
  });

  // `workers_dev` defaults to true and is inherited, and `wrangler deploy` without --env deploys the
  // top level, which is development: there a request with no Access token passes as the admin
  // `development`, and config.ts refuses no placeholder. A stray deploy must get no address.
  it("give development no address a stray deploy could publish, in either Worker", () => {
    for (const worker of ["pilot", "admin"] as const) {
      const config = configOf(worker, "development");
      expect(config.workersDev, worker).toBe(false);
      expect(config.previewUrls, worker).toBe(false);
      expect(config.routes ?? [], worker).toEqual([]);
    }
  });

  it.each(DEPLOYED)(
    "hold the %s hosts: each Worker's name on the account's subdomain",
    (environment) => {
      const pilot = configOf("pilot", environment).vars;
      // Admin links in the founder's chat open the admin Worker; the notices are the pilot's pages.
      expect(pilot.PUBLIC_BASE_URL).toBe(hostOf("admin", environment));
      for (const lang of NOTICE_LANGS) {
        expect(pilot[NOTICE_URL_VARS[lang]], lang).toBe(
          `${hostOf("pilot", environment)}${NOTICE_PATHS[lang]}`,
        );
      }
      // A form may be posted only from the admin Worker's own origin.
      expect(configOf("admin", environment).vars.PUBLIC_BASE_URL).toBe(
        hostOf("admin", environment),
      );
    },
  );

  it("links a notice path for every language a notice is written in", () => {
    expect(NOTICE_LANGS.map((lang) => NOTICE_PATHS[lang])).toEqual(["/privacy", "/privacy/zh-TW"]);
  });

  // H5: the founder's personal chat id is a secret, never a value in a committed file. The
  // heartbeat needs no value at all (W5): the watchdog reads /healthz. Clerk's secret key is a
  // secret only the founder puts (ADR-29).
  it("never holds ADMIN_CONVERSATION_ID, CLERK_SECRET_KEY, or a heartbeat ping URL as a var, in either Worker or any environment", () => {
    for (const config of configs) {
      const names = Object.keys(config.vars);
      expect(names, `${config.worker}:${config.environment}`).not.toContain(
        "ADMIN_CONVERSATION_ID",
      );
      expect(names, `${config.worker}:${config.environment}`).not.toContain("CLERK_SECRET_KEY");
      expect(
        names.filter((name) => /HEALTHCHECK|PING/.test(name)),
        `${config.worker}:${config.environment}`,
      ).toEqual([]);
    }
  });

  // create_invite's link, made by the admin Worker, must open the bot whose webhook the pilot
  // Worker serves, or the new member's /start never reaches Vela.
  it.each(["development", ...DEPLOYED] as const)(
    "name the same bot in both Workers in %s",
    (environment) => {
      const bot = configOf("pilot", environment).vars.TELEGRAM_BOT_USERNAME;

      expect(typeof bot).toBe("string");
      expect(configOf("admin", environment).vars.TELEGRAM_BOT_USERNAME).toBe(bot);
    },
  );

  // Decision X (2026-09-18): one setting per environment, so the admin Worker never calls Anthropic
  // while the pilot Worker is off, or needs a key the pilot Worker does not.
  it.each(["development", ...DEPLOYED] as const)(
    "set AI_PROVIDER to anthropic or off, the same in both Workers, in %s",
    (environment) => {
      const provider = configOf("pilot", environment).vars.AI_PROVIDER;

      expect(["anthropic", "off"]).toContain(provider);
      expect(configOf("admin", environment).vars.AI_PROVIDER).toBe(provider);
    },
  );

  // config.ts refuses to start production with AI off: families' answers need the flag check.
  it("run production with AI on in both Workers", () => {
    expect(configOf("pilot", "production").vars.AI_PROVIDER).toBe("anthropic");
    expect(configOf("admin", "production").vars.AI_PROVIDER).toBe("anthropic");
  });

  // Local work needs no Anthropic key.
  it("run development with AI off in both Workers", () => {
    expect(configOf("pilot", "development").vars.AI_PROVIDER).toBe("off");
    expect(configOf("admin", "development").vars.AI_PROVIDER).toBe("off");
  });

  // wrangler.admin.jsonc sends a reader to the pilot header for what "off" means and how to switch
  // it on, so it lists all that the ai_off line lists, and puts the key on before main, since CI
  // deploys staging from main and both Workers refuse to run with AI on and no key.
  it("say in the pilot header what AI off leaves out, and to put the key on before main", () => {
    const header = pilotHeader();

    expect(header).toContain(AI_OFF_EFFECTS);
    expect(header).toContain("on that commit before it is merged to main");
  });

  // Decision M (2026-09-20): where media is kept is the pilot Worker's alone, since the admin
  // Worker stores none and its reads never open a stored object.
  it.each(["development", ...DEPLOYED] as const)(
    "set MEDIA_STORAGE to r2 or off in the pilot Worker alone in %s",
    (environment) => {
      expect(["r2", "off"]).toContain(configOf("pilot", environment).vars.MEDIA_STORAGE);
      expect(Object.keys(configOf("admin", environment).vars)).not.toContain("MEDIA_STORAGE");
    },
  );

  // config.ts refuses to start production with storage off: the privacy notice promises families
  // that media is kept in Vela's own storage for 30 days and then deleted. Staging keeps media too
  // since 26 September 2026, when the founder enabled R2 on its account, so photo asks and
  // voice-note copies run there as they will in production; a commit that turns it off again
  // changes this pin with the var and the binding. Local work keeps nothing, so no laptop needs R2.
  it("keep media in staging and production and keep none on this laptop", () => {
    expect(
      (["development", ...DEPLOYED] as const).map(
        (environment) => configOf("pilot", environment).vars.MEDIA_STORAGE,
      ),
    ).toEqual(["off", "r2", "r2"]);
  });

  // A binding to a bucket that does not exist fails the deploy, and storage "r2" without one would
  // lose every object it was meant to keep, so the var and the binding move together.
  it.each(["development", ...DEPLOYED] as const)(
    "bind the media bucket in %s exactly when MEDIA_STORAGE is r2",
    (environment) => {
      const pilot = configOf("pilot", environment);
      const suffix = environment === "development" ? "" : `-${environment}`;

      expect(records(pilot.r2Buckets)).toEqual(
        pilot.vars.MEDIA_STORAGE === "r2"
          ? [{ binding: "MEDIA_BUCKET", bucket_name: `vela-media${suffix}` }]
          : [],
      );
    },
  );

  // The header is the one place that says what storage off leaves out and how to turn it on, and
  // the bucket has to exist before the switch reaches main, or CI deploys a Worker that refuses
  // to run (ConfigError:MEDIA_BUCKET).
  it("say in the pilot header what media storage off leaves out, and to create the bucket before main", () => {
    const header = pilotHeader();

    expect(header).toContain(MEDIA_OFF_EFFECTS);
    // Since ADR-33 "off" also switches off the app's photo asks, and the header says how.
    expect(MEDIA_OFF_EFFECTS).toContain("a photo from the app has nowhere to be kept");
    expect(MEDIA_OFF_EFFECTS).toContain("503 with media_storage_off");
    expect(header).toContain("--from resources` on that commit before it is merged to main");
  });

  // A placeholder may stay only where the founder has not created the thing yet, and filling it in
  // (infra/README.md section 11, steps 2 and 3) must keep this test green, or no deploy passes CI.
  it.each(DEPLOYED)(
    "leave nothing but the Hyperdrive ids and bot usernames as placeholders in %s",
    (environment) => {
      for (const worker of ["pilot", "admin"] as const) {
        const config = configOf(worker, environment);
        const unchosen = Object.entries(config.vars)
          .filter(([, value]) => typeof value === "string" && value.includes("PLACEHOLDER_"))
          .map(([name]) => name);
        expect(
          unchosen.filter((name) => !MAY_BE_PLACEHOLDERS[worker].includes(name)),
          worker,
        ).toEqual([]);

        const ids = records(config.hyperdrive).map((binding) => binding.id);
        expect(ids, worker).toHaveLength(1);
        for (const id of ids) {
          const placeholder = `PLACEHOLDER_HYPERDRIVE_ID_${environment.toUpperCase()}`;
          expect(
            id === placeholder || (typeof id === "string" && HYPERDRIVE_ID.test(id)),
            `${worker}: ${String(id)} is neither ${placeholder} nor a Hyperdrive id`,
          ).toBe(true);
        }
      }
    },
  );
});

describe("the links written into the pilot pack", () => {
  const materials = inject("pilotMaterials");

  // The texts in plan/materials/pilot are sent as written. A link left on an old subdomain would
  // lead a nearby contact nowhere, or to someone else's Worker, when they are asked to consent.
  it("name no workers.dev address but a deployed pilot Worker's notice page", () => {
    const noticeUrls = DEPLOYED.flatMap((environment) =>
      NOTICE_LANGS.map((lang) => configOf("pilot", environment).vars[NOTICE_URL_VARS[lang]]),
    );
    const links = Object.entries(materials).flatMap(([file, text]) =>
      workersDevUrls(text).map((url) => ({ file, url })),
    );

    expect(links.length).toBeGreaterThan(0);
    expect(links.filter(({ url }) => !noticeUrls.includes(url))).toEqual([]);
  });

  it.each(NOTICE_LANGS)(
    "give a nearby contact the production notice in the message's own language (%s)",
    (lang) => {
      const text = materials[`nearby-contact-consent.${lang}.md`];
      const production = configOf("pilot", "production").vars[NOTICE_URL_VARS[lang]];

      expect(text, `nearby-contact-consent.${lang}.md`).toBeDefined();
      const links = workersDevUrls(text ?? "");
      expect(links.length).toBeGreaterThan(0);
      expect([...new Set(links)]).toEqual([production]);
    },
  );
});

describe("the pilot Worker's bindings", () => {
  // Named environments inherit no binding, so each repeats its objects: without the heartbeat,
  // /healthz could never answer ok there and the watchdog would email all day (W1). The write
  // limiter is bound where the API is served, below.
  it.each(["development", ...DEPLOYED] as const)(
    "own the scheduler class, the heartbeat object, and the queue consumers in %s",
    (environment) => {
      const pilot = configOf("pilot", environment);

      expect(doBindings(pilot).slice(0, 2)).toEqual([
        { name: "MEMBER_SCHEDULER", class_name: "MemberScheduler" },
        { name: "RECONCILE_HEARTBEAT", class_name: "ReconcileHeartbeat" },
      ]);
      const suffix = environment === "development" ? "" : `-${environment}`;
      expect(consumers(pilot).map((consumer) => consumer.queue)).toEqual([
        `vela-outbound${suffix}`,
        `vela-media${suffix}`,
        `vela-understand${suffix}`,
      ]);
    },
  );

  // The scheduled handler picks its work by comparing `controller.cron` with these constants and
  // only logs `cron_unknown` for anything else: a trigger that is not one of them runs nothing.
  it.each(["development", ...DEPLOYED] as const)(
    "trigger exactly the crons the scheduled handler dispatches on in %s",
    (environment) => {
      expect(configOf("pilot", environment).crons).toEqual([RECONCILE_CRON, NIGHTLY_CRON]);
    },
  );

  // ADR-29: production's API stays off until a Clerk production instance, a production key, a
  // privacy notice naming Clerk, and a new ADR, which changes this pin.
  it("serve the API in development and staging, and not in production", () => {
    expect(
      (["development", ...DEPLOYED] as const).map(
        (environment) => configOf("pilot", environment).vars.API_V1,
      ),
    ).toEqual(["on", "on", "off"]);
  });

  // Staging holds only synthetic families and test accounts, so it verifies tokens from the same
  // development instance as a laptop; production names none while its API is off.
  it("verify tokens from Clerk's development instance in development and staging, and name no issuer in production", () => {
    expect(configOf("pilot", "development").vars.CLERK_ISSUER).toBe(
      "https://ideal-vulture-9262.clerk.accounts.dev",
    );
    expect(configOf("pilot", "staging").vars.CLERK_ISSUER).toBe(
      configOf("pilot", "development").vars.CLERK_ISSUER,
    );
    expect(Object.keys(configOf("pilot", "production").vars)).not.toContain("CLERK_ISSUER");
  });

  // Named environments inherit no binding, so each environment that serves the API repeats both
  // limits: the address limiter, the one Rate Limiting binding, and the write limiter's objects.
  // Production binds neither while its API is off, and config.ts refuses to turn it on without them.
  it("bind both of the API's limits in development and staging, and neither in production", () => {
    for (const environment of ["development", "staging"] as const) {
      const pilot = configOf("pilot", environment);

      expect(pilot.ratelimits, environment).toEqual([API_ADDRESS_LIMIT]);
      expect(doBindings(pilot).slice(2), environment).toEqual([
        { name: "ACCOUNT_WRITE_LIMITER", class_name: "AccountWriteLimiter" },
      ]);
    }
    const production = configOf("pilot", "production");
    expect(production.ratelimits ?? []).toEqual([]);
    expect(doBindings(production).map((binding) => binding.name)).toEqual([
      "MEMBER_SCHEDULER",
      "RECONCILE_HEARTBEAT",
    ]);
  });

  // A migration once deployed is never rewritten: each class arrives with one of its own. Every
  // environment inherits them, production included, where the write limiter's class is declared
  // and never bound while its API is off.
  it.each(["development", ...DEPLOYED] as const)(
    "declare the migrations of the scheduler, the heartbeat and the write limiter in %s, which only the Worker exporting the classes may",
    (environment) => {
      expect(configOf("pilot", environment).migrations).toEqual([
        { tag: "v1", new_sqlite_classes: ["MemberScheduler"] },
        { tag: "v2", new_sqlite_classes: ["ReconcileHeartbeat"] },
        { tag: "v3", new_sqlite_classes: ["AccountWriteLimiter"] },
      ]);
    },
  );
});

describe("the admin Worker's bindings", () => {
  // H2: the admin Worker reaches the pilot Worker's scheduler objects across scripts, so a wake it
  // asks for (an away period, a departure) lands on the same object the alarms run in.
  it.each(["development", ...DEPLOYED] as const)(
    "bind the pilot Worker's MemberScheduler class by script_name in %s",
    (environment) => {
      const pilotName = environment === "development" ? DEV_NAMES.pilot : NAMES.pilot;

      expect(configOf("pilot", environment).name).toBe(pilotName);
      expect(doBindings(configOf("admin", environment))).toEqual([
        { name: "MEMBER_SCHEDULER", class_name: "MemberScheduler", script_name: pilotName },
      ]);
    },
  );

  it.each(DEPLOYED)(
    "produce onto the pilot Worker's outbound queue and read its database in %s",
    (environment) => {
      const admin = configOf("admin", environment);
      const pilot = configOf("pilot", environment);
      const pilotOutbound = producers(pilot).find(
        (producer) => producer.binding === "OUTBOUND_QUEUE",
      );

      expect(producers(admin)).toEqual([pilotOutbound]);
      expect(records(admin.hyperdrive)).toEqual(records(pilot.hyperdrive));
    },
  );

  it.each(["development", ...DEPLOYED] as const)(
    "run nothing of the pilot Worker's in %s: no consumer, cron, bucket, migration, limiter, API var, or chat id",
    (environment) => {
      const admin = configOf("admin", environment);

      expect(consumers(admin)).toEqual([]);
      expect(admin.crons ?? []).toEqual([]);
      expect(records(admin.r2Buckets)).toEqual([]);
      expect(records(admin.migrations)).toEqual([]);
      expect(records(admin.ratelimits)).toEqual([]);
      expect(Object.keys(admin.vars).sort()).toEqual([
        "AI_PROVIDER",
        "ENVIRONMENT",
        "PUBLIC_BASE_URL",
        "TELEGRAM_BOT_USERNAME",
      ]);
    },
  );
});
