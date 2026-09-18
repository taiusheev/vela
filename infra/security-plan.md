# Security plan

18 September 2026 · decision L11 (`plan/materials/pilot/legal-memo.md`, C21) · Taiwan's Personal Data Protection Act, Article 27(1), and its Enforcement Rules, Article 12; the Ministry of Digital Affairs regulation 數位經濟相關產業個人資料檔案安全維護管理辦法, where it applies (memo Q5) · owner: the founder; the co-founder keeps it true to the code · **next review: 17 March 2027**

One page on how Vela protects personal data in the pilot, in proportion to a free pilot run by one person (Rules Article 12: 「具有適當比例為原則」). Research, not legal advice: whether the ministry regulation reaches the pilot, and whether this plan meets it, are for a lawyer (memo lawyer question 8). The details live in the documents linked.

## What is protected

- **Family content:** asks, answers, voice notes, photos, transcripts, translations, summaries, replies, weekly reads. The words of answers are kept 30 days for everyone, including words about health; health mentions, and a flag's category and quote, are kept only with the person's written consent, and then also for 30 days (ADR-27).
- **Identities and links:** names, greetings, time zones, Telegram ids, invite tokens; nearby contacts' names, and their numbers once they said yes.
- **Proofs:** consent records and deletion proofs, kept 5 years without anyone's words, name or number (ADR-28).
- **Access:** the admin access log, account sign-ins, and every secret (bot tokens, API keys, connection strings).

Every category, where it lives and how long: [`plan/materials/pilot/data-map.md`](../plan/materials/pilot/data-map.md).

## Measures (Rules Article 12, second paragraph)

| Measure | What exists | Still missing |
|---|---|---|
| 1. People and resources | The founder is responsible and does every task that touches real data; the co-founder builds with synthetic data only | No second person who can act if the founder is unreachable |
| 2. Scope of the data | The data map; the sub-processor list ([`sub-processors.md`](sub-processors.md)) | — |
| 3. Risk assessment | The legal memo and its status table; the data map's gaps; the decision records | A review of risks whenever a new kind of data arrives (memory in sprint 5) |
| 4. Incidents: prevention, notice, response | [`runbooks/incident.md`](runbooks/incident.md) (the breach rule in force, the 72-hour report where the regulation applies); [`runbooks/silence-drill.md`](runbooks/silence-drill.md); the outside watchdog ([`README.md`](README.md), section 6); [`runbooks/secrets-rotation.md`](runbooks/secrets-rotation.md) | — |
| 5. Collection, processing and use | Consent before anything starts (the consent script, the onboarding order, "Who can join"); health words asked separately; every admin view and action logged; by-hand changes only through [`runbooks/data-requests.md`](runbooks/data-requests.md); nothing kept that is not meant for Vela in the family group | — |
| 6. Data security and people | Least privilege by account (below); multi-factor authentication on every account; Cloudflare Access on the whole admin Worker, which also verifies the token itself (ADR-22, ADR-26); a separate Cloudflare account and a separate Neon project (`vela-staging`) for staging; deploy secrets only in GitHub environments, production behind the founder's approval (ADR-23); TLS to every provider, and encryption at rest by Neon and Cloudflare R2; database CHECKs that keep numbers only with a yes, forget consent subjects before a deletion, and hash no personal value in a deletion proof | Field-level encryption of content (architecture §13, decided before launch) |
| 7. Awareness and training | The rules in this folder's README ("Rule zero", "Access rules"), which the co-founder follows and the founder re-reads at each review | — |
| 8. Devices | The founder's laptop and phone: password manager, authenticator app, screen lock; no production credential kept on the development machine | Founder task: confirm full-disk encryption is on for the laptop and the phone, and note the date here |
| 9. Audit | The admin access log, visible to a family on request; the quarterly restore drill ([`runbooks/restore-drill.md`](runbooks/restore-drill.md)); sub-processor checks every six months | A monthly read of the admin access log for views nobody remembers |
| 10. Records and evidence | `admin_access_log` and content-free `events`, 24 months; consent records and deletion proofs, 5 years; each by-hand request in the data-requests log; Cloudflare's audit log and Access logs | If the ministry regulation applies, its Article 16 asks for records of collection, processing and use for at least five years, longer than the 24 months the admin access log and events are kept: decide with counsel |
| 11. Continual improvement | A written review after every incident, with the test that would have caught it; this plan reviewed every six months | — |

Where the ministry regulation applies (memo Q5): this page is the written plan of its Article 3; its Article 8 report is in the incident runbook; its Article 10 notice of transfer regions is the privacy notice's "Where it is stored"; testing without real data (Article 11) is the rule that dev and staging hold only synthetic data and the golden set only anonymised text, with one exception: in the dogfooding week, a friend who is the kept-light member leaves their name, Telegram account and consent rows on staging, and nothing else real, until the week ends ([`README.md`](README.md), "Environments"); its Article 16 is row 10 above.

## Who holds which access

| Who | Holds | Never holds |
|---|---|---|
| **The founder** | Owner of every account (Cloudflare "Vela" and "Vela staging", Neon, Anthropic, Deepgram, Sentry, GitHub, the Telegram bots, Google Drive), each with a second factor; the only sign-in Cloudflare Access lets into the production admin page; the only person who reads production content (the admin page, or the Neon console, logged by hand); the only approver of a production deploy; the short-lived production setup token, deleted after its one run | — |
| **The co-founder** (an AI coding agent on the founder's machine) | Dev and staging, with synthetic data; the "Vela staging" token in `apps/worker/.env`; content-free production signals (events, daily counts, deploy status) | Production secrets, production connection strings, production content, the dogfooding week's real rows on staging, the founder's chat id |
| **GitHub Actions** | Environment secrets released only to the deploy job its environment's rules allow (`production`: `v*` tags, after the founder's approval); the watchdog holds no secret | Repository secrets (there are none) |
| **The Workers** | Their own secrets (`infra/README.md`, "Worker configuration names"); the pilot Worker has no Access secret, and the admin Worker no bot token or speech key | Any secret in a committed file |

## Logging, backups, deletion

- **Logging.** The Workers log event names, ids and error labels, never message content, transcripts, phone numbers or tokens (code design §2); Sentry is not connected, and when it is, it keeps events in the EU for at most 90 days with IP storage off.
- **Backups.** Neon's restore history (at most 6 hours on the Free plan; the founder decides on 7 days on Launch before the first family; Launch is the Neon organisation's plan, so it would bill `vela-staging` too, `infra/README.md` section 2). R2 media has no backup: a lost file loses one voice note or photo, which is deleted after 30 days anyway. Restore drill every quarter.
- **Deletion.** The nightly retention job applies the data map's rules; every deletion of a member or contact forgets their consent rows first; deletion proofs hash only the kind and id; by-hand deletions follow the data-requests runbook; deleted rows can remain in Neon's restore history for up to 7 days.

## Review

Every six months (next: 17 March 2027, with the secrets rotation), and also before the first family, before a new provider or a new kind of data (such as memory), after any Sev 1 incident, when the 2025 amendment of the Act takes effect, and before any public launch. Each review dates this page and updates the "Still missing" column.
