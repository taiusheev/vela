# API contract, v2

2026-09-18 (written 2026-09-13; §10's health check revised 2026-09-18 to the pilot Worker as built). The contract between the Expo app (and the web admin) and the worker, plus the inbound webhooks. Every endpoint maps to spec v2 (`product/05-product-spec-v2.md`); every request and response is a Zod schema in `packages/contracts`, shared by the worker and the app, so a change breaks the build before it breaks a family.

Conventions: JSON over HTTPS; `Authorization: Bearer <session>`; ids are uuids; times are ISO-8601 with offset; every mutating call accepts an `Idempotency-Key` header and returns the first result on replay; errors are `{error: {code, message, details?}}` with codes `unauthenticated`, `forbidden`, `not_found`, `invalid`, `conflict`, `budget`, `rate_limited`; pagination by cursor (`?cursor=&limit=`); all text fields are returned in the caller's language with `original` alongside when translated.

## 1. Auth and account

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | /auth/start | Start sign-in by phone or email | Sends OTP or magic link through the auth provider |
| POST | /auth/verify | Exchange code for a session | Returns `{session, user}` |
| POST | /auth/apple, /auth/google | Sign in with Apple / Google | |
| GET | /me | Current user, memberships, plan states | The app's first call |
| PATCH | /me | display_name, language, tz | |
| DELETE | /me | Leave every family and delete the account | Retention rules apply (spec §17) |

## 2. Families and members

| Method | Path | Purpose |
|---|---|---|
| POST | /families | Create a family: `{name, country, kept_light_member: {display_name, address_form, language, tz, wake_time, city}}` → family, member rows, region set |
| GET | /families/:id | Family, members with light states (§2.2), nearby contacts, plan |
| PATCH | /families/:id | name, story_day, turns_enabled |
| DELETE | /families/:id | Schedules deletion within 24 h |
| POST | /families/:id/members | Add a member (self-invite accepted, or organiser adds a kept-light member) |
| PATCH | /families/:id/members/:mid | address_form, language, tz, wake_time, turns_in, primary_surface, role |
| POST | /families/:id/members/:mid/light | `{on: boolean}` — for oneself: consent implicit; for another: requires their consent flow |
| POST | /families/:id/members/:mid/pause | Pause or resume (`{paused: boolean}`) |
| POST | /families/:id/members/:mid/left | Member leaves |
| POST | /families/:id/members/:mid/deceased | Any member marks it; every schedule stops within the hour |
| POST | /families/:id/invites | `{channel: link|line|whatsapp|telegram|sms|email, for_member_id?}` → `{url, token, expires_at, invite_text}` |
| POST | /invites/:token/accept | Accept into the family |
| GET | /families/:id/members/:mid/what-family-sees | The last 7 summaries and the last weekly read, in her language (symmetry, §9) |

## 3. Nearby contacts

| Method | Path | Purpose |
|---|---|---|
| POST | /families/:id/members/:mid/nearby | `{name, relation, phone, channel?}` → consent request sent in the organiser's name |
| DELETE | /families/:id/nearby/:cid | |
| POST | /nearby/:token/consent | Consent or decline (from the contact's message) |

## 4. Exchanges (the core)

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/today | The Today screen (A6): lights, today's exchange per kept-light member, tomorrow's turn and suggestion |
| GET | /families/:id/exchanges?cursor= | Exchanges newest first (A8), with answers, replies, receipts, translations |
| GET | /exchanges/:id | One exchange in full |
| POST | /families/:id/exchanges | Compose an ask: `{recipient_id, type, text?, options?, media_ids?, voice_hello_id?, when: tomorrow|date|whenever, date?, on_behalf_of?}` → exchange (state composed). `409 conflict` with `{taken_by}` if that date already has an ask; body may include `date_alternative` |
| DELETE | /exchanges/:id | Withdraw before delivery only |
| POST | /exchanges/:id/seen | Parent surface: she opened it |
| POST | /exchanges/:id/answer | Parent surface: `{kind: voice|chip|photo_pick|vote|heart|text|fine, media_id?, payload?}` → lights the light synchronously, enqueues understanding |
| POST | /exchanges/:id/replies | `{kind: heart|laugh|hug|text|voice|photo, text?, media_id?}` |
| POST | /exchanges/:id/read-back | Parent surface: she heard yesterday's replies |
| GET | /families/:id/suggestions?for=me | The turn holder's suggestion(s) for tomorrow |
| POST | /suggestions/:id/use | Marks used; returns a prefilled compose body |

## 5. The light and the quiet ladder

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/lights | Per kept-light member: state, answered_at, usual_time, quiet_event? (widget endpoint; cheap, cacheable 60 s) |
| POST | /quiet/:qid/fine | "She's fine, I know why" → resolves with outcome fine_known |
| POST | /quiet/:qid/wait | Wait 2 hours |
| POST | /quiet/:qid/ask-to-check | `{contact_id}` → nearby_ask sent in the caller's name (actor required) |
| POST | /quiet/:qid/useful | `{useful: boolean}` one-tap verdict for the precision page |
| POST | /families/:id/members/:mid/away | `{from, to?}` or `{until_back: true}` |
| DELETE | /families/:id/members/:mid/away | End away mode |
| GET | /families/:id/precision | Notices, outcomes, shares (the precision page) |

## 6. Story day, the family book, memory

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/book | Stories and recipes, with play URLs |
| POST | /families/:id/book/questions | Add or vote a story question |
| POST | /stories/:id/keep | `{kept: boolean}` (her "don't keep that one") |
| POST | /families/:id/book/export | Vela Light: PDF export job → `{job_id}`; GET /jobs/:id |
| GET | /families/:id/reminders | Suggested and created reminders |
| POST | /families/:id/reminders | Create from a suggestion (only after a tap) |

## 7. Weekly read, settings, billing

| Method | Path | Purpose |
|---|---|---|
| GET | /families/:id/weekly-reads?member= | Reads; free plan returns the seven lights and a `locked` flag |
| POST | /weekly-reads/:id/opened | Event only |
| GET | /me/notifications | The one-a-day setting and hour |
| PATCH | /me/notifications | `{hour}` only; frequency cannot be raised |
| GET | /families/:id/plan | Plan, trial, per-member subscription states |
| POST | /families/:id/plan/trial | Start the 30 days (after her first answer) |
| POST | /families/:id/plan/checkout | Web checkout session (provider decided later) |
| POST | /webhooks/billing/:provider | Provider events |

## 8. Media

| Method | Path | Purpose |
|---|---|---|
| POST | /media/upload-url | `{kind, mime, bytes, duration_ms?}` → signed PUT URL and media_id (R2, region bucket) |
| POST | /media/:id/complete | Marks uploaded; triggers transcoding if needed |
| GET | /media/:id/url | Signed GET URL, 15 minutes |

## 9. Inbound webhooks (channels)

| Path | Verification | Events parsed |
|---|---|---|
| POST /webhooks/line | X-Line-Signature (HMAC-SHA256, channel secret) | message (text, audio, image, sticker), postback (chip/photo/vote/consent), follow, unfollow; read receipts not available |
| POST /webhooks/whatsapp | X-Hub-Signature-256 (app secret); GET verify challenge | messages (text, audio, image, button/interactive replies), statuses (sent, delivered, read) |
| POST /webhooks/telegram | secret token header | message (text, voice, photo, sticker), callback_query, message_reaction, my_chat_member (blocked) |
| POST /webhooks/voice/:provider | provider signature | call status, DTMF digit, recording ready |

Rule: verify, parse into `InboundEvent[]`, acknowledge within 1 s, do all work from the queue. The answer path (light, cancel repeat, resolve quiet) runs before the queue for kept-light members because it is a single indexed write.

## 10. Internal and admin

| Method | Path | Purpose |
|---|---|---|
| POST | /internal/tick | Cron entry: due arrivals, repeats, quiet notices, turn prompts, weekly reads, retention; protected by a worker-internal secret |
| GET | /admin/families?q= | Search (admin allow-list; every read logged) |
| GET | /admin/families/:id | The family as the co-founder sees it: exchanges, AI outputs, quiet events, deliveries |
| GET | /admin/metrics?from=&to= | metrics_daily rollups |
| GET | /admin/ai-calls?call=&version= | Prompt outputs by version for evals |
| POST | /admin/flags | Feature flags |
| GET | /healthz | On the pilot Worker, as built (`apps/worker/src/app.ts`, `heartbeat.ts`): whether reconciliation is running, for the GitHub watchdog outside Cloudflare. It reads the time of the last successful reconcile from the `ReconcileHeartbeat` Durable Object and never touches the database. 200 `{status: "ok", lastReconcileAgeSeconds}` while that reconcile finished at most 35 minutes ago; otherwise 503 `{status: "stale"}`, or 503 `{status: "no_reconcile_yet"}` before the first. `cache-control: no-store`; no content and no ids; no authentication. There is no `/readyz` |

## 11. Core types (Zod, `packages/contracts`)

```ts
export const Lang = z.enum(["en", "zh-TW", "ja", "de", "hi", "ru"]);
export const ExchangeType = z.enum(["question","photo_choice","voice_note","word","story","recipe","memory_photo","vote","hello"]);
export const ExchangeState = z.enum(["composed","scheduled","delivered","seen","answered","replied","read_back","archived","withdrawn"]);
export const LightState = z.enum(["resting","lit","quiet","away","paused","none"]);

export const MemberLight = z.object({
  member_id: z.string().uuid(), display_name: z.string(), state: LightState,
  answered_at: z.string().datetime().nullable(), usual_time: z.string().nullable(),
  away_until: z.string().date().nullable(), quiet_event_id: z.string().uuid().nullable(),
});

export const ComposeExchange = z.object({
  recipient_id: z.string().uuid(), type: ExchangeType,
  text: z.string().max(500).optional(), options: z.record(z.unknown()).optional(),
  media_ids: z.array(z.string().uuid()).max(2).default([]), voice_hello_id: z.string().uuid().optional(),
  when: z.enum(["tomorrow","date","whenever"]), date: z.string().date().optional(), on_behalf_of: z.string().max(60).optional(),
});

export const Answer = z.object({
  kind: z.enum(["voice","chip","photo_pick","vote","heart","text","fine"]),
  media_id: z.string().uuid().optional(), payload: z.record(z.unknown()).optional(),
});

export const Exchange = z.object({
  id: z.string().uuid(), family_id: z.string().uuid(), recipient: MemberLight.pick({member_id: true, display_name: true}),
  asker: z.object({member_id: z.string().uuid().nullable(), display_name: z.string(), on_behalf_of: z.string().nullable()}),
  type: ExchangeType, state: ExchangeState, text: z.string().nullable(), original: z.object({lang: Lang, text: z.string()}).nullable(),
  media: z.array(z.object({id: z.string().uuid(), kind: z.enum(["audio","image"]), url: z.string().url(), duration_ms: z.number().optional()})),
  scheduled_for: z.string().date().nullable(), delivered_at: z.string().datetime().nullable(), seen_at: z.string().datetime().nullable(),
  answer: z.object({kind: z.string(), transcript: z.string().nullable(), summary: z.string().nullable(), media: z.any().nullable(), received_at: z.string().datetime()}).nullable(),
  replies: z.array(z.object({member: z.string(), kind: z.string(), text: z.string().nullable(), media: z.any().nullable(), created_at: z.string().datetime()})),
  receipts: z.object({seen: z.string().datetime().nullable(), answered: z.string().datetime().nullable(), read_back: z.string().datetime().nullable()}),
});
```

## 12. Channel adapter contract (worker-internal)

```ts
export interface ChannelAdapter {
  readonly id: "line" | "whatsapp" | "telegram" | "voice" | "app";
  readonly capabilities: { buttons: boolean; voiceIn: boolean; voiceOut: boolean; readReceipts: boolean; images: boolean; templatesOutsideWindow: boolean };
  send(link: ChannelLink, msg: OutboundMessage): Promise<{ externalId: string }>;      // must be idempotent on msg.idempotencyKey
  verify(req: Request): Promise<boolean>;
  parse(req: Request): Promise<InboundEvent[]>;
  resolveIdentity(ev: InboundEvent): Promise<ChannelLink | null>;
}
export type OutboundMessage = {
  kind: "arrival" | "repeat" | "ack" | "consent" | "nearby_ask" | "system";
  text: string; lang: Lang; media?: MediaRef[]; voice?: MediaRef; buttons?: { id: string; label: string }[];
  idempotencyKey: string; exchangeId?: string;
};
export type InboundEvent = {
  channel: ChannelAdapter["id"]; externalUserId: string; externalMessageId: string; at: string;
  kind: "text" | "voice" | "image" | "sticker" | "button" | "reaction" | "read" | "follow" | "unfollow" | "blocked" | "dtmf";
  payload: { text?: string; buttonId?: string; mediaUrl?: string; mime?: string; durationMs?: number; reaction?: string; digit?: string };
};
```

Deviations recorded per adapter in `architecture/02-technical-architecture-v2.md` §6.
