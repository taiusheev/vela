/**
 * Everything the platform hands each Worker: the vars in its wrangler config, the secrets in
 * `.dev.vars` (locally) or the Worker's own secrets in its account, and the bindings.
 *
 * Secrets are typed `string | undefined` because a missing one only shows up at runtime;
 * `src/config.ts` refuses to build anything until each is present and says which is missing.
 */
import type { MediaJob, OutboundJob, UnderstandJob } from "@vela/services";
import type { ReconcileHeartbeat } from "./heartbeat.ts";
import type { MemberScheduler } from "./scheduler.ts";

/** What both Workers are given: the environment, the admin origin, and the admin's reach. */
interface SharedEnv {
  readonly ENVIRONMENT: string;
  /**
   * The admin Worker's origin. The pilot Worker puts it in front of `/admin/...` in the links of
   * admin messages; the admin Worker accepts a form only from it.
   */
  readonly PUBLIC_BASE_URL: string;
  /**
   * Where AI calls go: "anthropic", or "off", when none is made (`config.ts`, `readAiProvider`).
   * The same in both Workers of an environment; production refuses "off".
   */
  readonly AI_PROVIDER: string;
  /** Read only while `AI_PROVIDER` is "anthropic", and required then. */
  readonly ANTHROPIC_API_KEY?: string;

  readonly HYPERDRIVE: Hyperdrive;
  readonly MEMBER_SCHEDULER: DurableObjectNamespace<MemberScheduler>;
  readonly OUTBOUND_QUEUE: Queue<OutboundJob>;
}

/**
 * The pilot Worker `vela` (wrangler.jsonc): webhooks, notices, queues, cron, the scheduler, and
 * the heartbeat.
 */
export interface PilotEnv extends SharedEnv {
  // Vars.
  readonly TELEGRAM_BOT_USERNAME: string;
  readonly PRIVACY_NOTICE_URL_EN: string;
  readonly PRIVACY_NOTICE_URL_ZH_TW: string;
  /** The regions whose database exists in this environment, comma separated; the pilot is `apac`. */
  readonly REGIONS: string;
  /**
   * Where media is kept: "r2", or "off", when no copy is made (`config.ts`, `readMediaStorage`).
   * Production refuses "off". Only this Worker stores media, so the admin Worker has no such var.
   */
  readonly MEDIA_STORAGE: string;

  // Secrets (.dev.vars.example lists them all).
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly TELEGRAM_WEBHOOK_SECRET?: string;
  readonly DEEPGRAM_API_KEY?: string;
  /** The founder's personal chat with the bot; left out on a laptop, which sends no admin messages. */
  readonly ADMIN_CONVERSATION_ID?: string;

  // Bindings.
  readonly MEDIA_QUEUE: Queue<MediaJob>;
  readonly UNDERSTAND_QUEUE: Queue<UnderstandJob>;
  /**
   * Optional, because an environment whose `MEDIA_STORAGE` is "off" binds no bucket: binding one
   * that does not exist would fail its deploy. `deps.ts` builds the media port only when it is
   * bound, and refuses to start while `MEDIA_STORAGE` is "r2" and it is not.
   */
  readonly MEDIA_BUCKET?: R2Bucket;
  /** The one object that records when reconciliation last finished, for `/healthz`. */
  readonly RECONCILE_HEARTBEAT: DurableObjectNamespace<ReconcileHeartbeat>;
}

/**
 * The admin Worker `vela-admin` (wrangler.admin.jsonc): the admin pages and forms, behind
 * Cloudflare Access. Its scheduler binding reaches the `MemberScheduler` class in the pilot Worker.
 */
export interface AdminEnv extends SharedEnv {
  /**
   * The pilot Worker's bot in the same environment: the link `create_invite` sends an organiser
   * opens a chat with it.
   */
  readonly TELEGRAM_BOT_USERNAME: string;
  /** The Cloudflare Access team domain, `<team>.cloudflareaccess.com`. */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /** The audience tag of the Access application that covers this Worker. */
  readonly ACCESS_AUD?: string;
}
