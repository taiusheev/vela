/**
 * Everything the platform hands the Worker: the vars in wrangler.jsonc, the secrets in
 * `.dev.vars` (locally) or the environment's deploy secrets, and the bindings.
 *
 * Secrets are typed `string | undefined` because a missing one only shows up at runtime;
 * `src/deps.ts` refuses to build anything until each is present and says which is missing.
 */
import type { MediaJob, OutboundJob, UnderstandJob } from "@vela/services";
import type { MemberScheduler } from "./scheduler.ts";

export interface Env {
  // Vars (wrangler.jsonc).
  readonly ENVIRONMENT: string;
  readonly TELEGRAM_BOT_USERNAME: string;
  /** The founder's chat with the bot; empty sends no admin messages. */
  readonly ADMIN_CONVERSATION_ID: string;
  /** The Worker's public origin; admin links are this plus `/admin/...`. */
  readonly PUBLIC_BASE_URL: string;
  readonly PRIVACY_NOTICE_URL_EN: string;
  readonly PRIVACY_NOTICE_URL_ZH_TW: string;
  /** The regions whose database exists in this environment, comma separated; the pilot is `apac`. */
  readonly REGIONS: string;

  // Secrets (.dev.vars.example lists them all).
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly TELEGRAM_WEBHOOK_SECRET?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly DEEPGRAM_API_KEY?: string;
  readonly HEALTHCHECKS_PING_URL?: string;
  /** The Cloudflare Access team domain, `<team>.cloudflareaccess.com`. */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag for `/admin`. */
  readonly ACCESS_AUD?: string;

  // Bindings.
  readonly HYPERDRIVE: Hyperdrive;
  readonly MEMBER_SCHEDULER: DurableObjectNamespace<MemberScheduler>;
  readonly OUTBOUND_QUEUE: Queue<OutboundJob>;
  readonly MEDIA_QUEUE: Queue<MediaJob>;
  readonly UNDERSTAND_QUEUE: Queue<UnderstandJob>;
  readonly MEDIA_BUCKET: R2Bucket;
}
